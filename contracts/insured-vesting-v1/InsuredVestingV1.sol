// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address, IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// when owner calls activate, the contract will:
// - transfer the necessary amount of tokens required to cover all funded tokens
// - set the vesting clock to start at the specified time (no more than 90 days in the future)
// - lock the contract for any further allowed allocations settings
// - lock the contract for any further fundings
contract InsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable FUNDING_TOKEN;
    IERC20 public immutable PROJECT_TOKEN;
    uint256 public immutable FUNDING_TOKEN_TO_PROJECT_TOKEN_RATE;
    uint256 public immutable VESTING_DURATION_SECONDS;
    uint256 public constant MAX_START_TIME_FROM_NOW = 3 * 30 days;

    bool public emergencyReleased = false;
    address public projectWallet;

    uint256 public vestingStartTime;
    uint256 public totalFundingTokenFunded;

    enum ClaimDecision {
        PROJECT_TOKEN,
        FUNDING_TOKEN
    }

    struct UserVesting {
        // Actual FUNDING_TOKEN amount funded by user
        uint256 fundingTokenFunded;
        // Investment allocation, set by owner
        uint256 fundingTokenAllocation;
        // Whether the user wants to claim PROJECT_TOKEN or claim back FUNDING_TOKEN
        ClaimDecision claimDecision;
        // Amount of FUNDING_TOKEN claimed by user (PROJECT_TOKEN is computed from that)
        uint256 fundingTokenClaimed;
    }

    mapping(address => UserVesting) public userVestings;

    // --- Events ---
    event UserClaimed(address indexed target, uint256 fundingTokenAmount, uint256 projectTokenAmount);
    event UserEmergencyClaimed(address indexed target, uint256 fundingTokenAmount);
    event ProjectClaimed(address indexed target, uint256 fundingTokenAmount, uint256 projectTokenAmount);
    event AllowedAllocationSet(address indexed target, uint256 amount);
    event FundsAdded(address indexed target, uint256 amount);
    event EmergencyRelease();
    event DecisionChanged(address indexed target, ClaimDecision decision);
    event AmountRecovered(address indexed token, uint256 tokenAmount, uint256 etherAmount);
    event ProjectWalletAddressChanged(address indexed oldAddress, address indexed newAddress);
    event VestingStarted(uint256 projectTokenTransferredToContract);

    // --- Errors ---
    error ZeroAddress();
    error AlreadyActivated();
    error VestingNotStarted();
    error AllowedAllocationExceeded(uint256 amount);
    error NothingToClaim();
    error NoFundsAdded();
    error EmergencyReleased();
    error EmergencyNotReleased();
    error OnlyOwnerOrSender();
    error StartTimeTooLate(uint256 vestingStartTime, uint256 maxStartTime);
    error StartTimeIsInPast(uint256 vestingStartTime);

    // --- Modifiers ---
    modifier onlyBeforeActivation() {
        if (vestingStartTime != 0) revert AlreadyActivated();
        _;
    }

    modifier onlyOwnerOrSender(address target) {
        if (!(msg.sender == owner() || msg.sender == target)) revert OnlyOwnerOrSender();
        _;
    }

    modifier onlyIfNotEmergencyReleased() {
        if (emergencyReleased) revert EmergencyReleased();
        _;
    }

    constructor(
        address _fundingToken,
        address _projectToken,
        address _projectWallet,
        uint256 _fundingTokenToProjectTokenRate,
        uint256 _vestingDurationSeconds
    ) {
        FUNDING_TOKEN = IERC20(_fundingToken);
        PROJECT_TOKEN = IERC20(_projectToken);

        VESTING_DURATION_SECONDS = _vestingDurationSeconds;
        // how many Project tokens you get per each 1 Funding token
        FUNDING_TOKEN_TO_PROJECT_TOKEN_RATE = _fundingTokenToProjectTokenRate; // 7 PROJECT_TOKEN per 1 USD -> 1e12 * 7

        /*
            TODO(audit) - use precision 1e18
            TODO(audti) - PROJECT_TOKENS_TO_FUNDING_TOKENS_RATE (other way around)

            PRECISION = 1e58
            RATE = 14_000_000
            (1e18 and 1e6)

            14 cents per PROJECT_TOKEN
         */

        projectWallet = _projectWallet;
    }

    // --- User functions ---
    function addFunds(uint256 amount) external onlyBeforeActivation onlyIfNotEmergencyReleased {
        if ((userVestings[msg.sender].fundingTokenAllocation - userVestings[msg.sender].fundingTokenFunded) < amount) revert AllowedAllocationExceeded(amount);

        userVestings[msg.sender].fundingTokenFunded += amount;
        totalFundingTokenFunded += amount;
        FUNDING_TOKEN.safeTransferFrom(msg.sender, address(this), amount);

        emit FundsAdded(msg.sender, amount);
    }

    function claim(address target) external onlyOwnerOrSender(target) onlyIfNotEmergencyReleased {
        if (vestingStartTime == 0) revert VestingNotStarted();

        UserVesting storage userStatus = userVestings[target];
        if (userStatus.fundingTokenFunded == 0) revert NoFundsAdded();

        uint256 claimableFundingToken = fundingTokenClaimableFor(target);
        if (claimableFundingToken == 0) revert NothingToClaim();
        userStatus.fundingTokenClaimed += claimableFundingToken;

        uint256 claimableProjectToken = claimableFundingToken * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATE;

        // TODO consider using ternary conditions for readability
        if (userStatus.claimDecision == ClaimDecision.PROJECT_TOKEN) {
            PROJECT_TOKEN.safeTransfer(target, claimableProjectToken);
            FUNDING_TOKEN.safeTransfer(projectWallet, claimableFundingToken);

            emit UserClaimed(target, 0, claimableProjectToken);
            emit ProjectClaimed(target, claimableFundingToken, 0);
        } else {
            PROJECT_TOKEN.safeTransfer(projectWallet, claimableProjectToken);
            FUNDING_TOKEN.safeTransfer(target, claimableFundingToken);

            emit UserClaimed(target, claimableFundingToken, 0);
            emit ProjectClaimed(target, 0, claimableProjectToken);
        }
    }

    // TODO(audit) - two setters, each for one of the two decisions
    // decision1 - PROJECT_TOKENS
    // decision2 - REFUND_FUNDING_TOKENS
    function toggleDecision() external {
        if (userVestings[msg.sender].fundingTokenFunded == 0) revert NoFundsAdded();
        userVestings[msg.sender].claimDecision = userVestings[msg.sender].claimDecision == ClaimDecision.PROJECT_TOKEN
            ? ClaimDecision.FUNDING_TOKEN
            : ClaimDecision.PROJECT_TOKEN;

        emit DecisionChanged(msg.sender, userVestings[msg.sender].claimDecision);
    }

    // --- Owner functions ---

    function setAllowedAllocation(address target, uint256 _fundingTokenAllocation) external onlyOwner onlyBeforeActivation onlyIfNotEmergencyReleased {
        // Update user allocation
        userVestings[target].fundingTokenAllocation = _fundingTokenAllocation;

        // Refund user if they have funded more than the new allocation
        if (userVestings[target].fundingTokenFunded > _fundingTokenAllocation) {
            uint256 _fundingTokenToRefund = userVestings[target].fundingTokenFunded - _fundingTokenAllocation;
            userVestings[target].fundingTokenFunded = _fundingTokenAllocation;
            totalFundingTokenFunded -= _fundingTokenToRefund;
            FUNDING_TOKEN.safeTransfer(target, _fundingTokenToRefund);
        }

        emit AllowedAllocationSet(target, _fundingTokenAllocation);
    }

    // TODO(audit) - change similar to VestingV1
    // TODO(audit) - consider whether an additional onlyBeforeVestingStarted is needed)
    function activate() external onlyOwner onlyBeforeActivation {
        if (totalFundingTokenFunded == 0) revert NoFundsAdded();
        vestingStartTime = block.timestamp;

        uint256 totalRequiredProjectToken = totalFundingTokenFunded * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATE;
        uint256 delta = totalRequiredProjectToken - Math.min(PROJECT_TOKEN.balanceOf(address(this)), totalRequiredProjectToken);

        PROJECT_TOKEN.safeTransferFrom(projectWallet, address(this), delta);

        emit VestingStarted(delta);
    }

    // TODO - revisit this with Tal
    function setProjectAddress(address newProject) external onlyOwner {
        if (newProject == address(0)) revert ZeroAddress();

        address oldProjectAddress = projectWallet;
        projectWallet = newProject;

        emit ProjectWalletAddressChanged(oldProjectAddress, newProject);
    }

    // --- Emergency functions ---
    // Used to allow users to claim back FUNDING_TOKEN if anything goes wrong
    function emergencyRelease() external onlyOwner onlyIfNotEmergencyReleased {
        emergencyReleased = true;
        emit EmergencyRelease();
    }

    /*
    TODO(audit)
    
    two roles -> foundation and project

    1. add modifiers for project
    2. add project address to uninsured

    Vesting(uninsured):
        - dao (owner) 
            - recover
        - project 
            - setAmount
            - claimOnBehalf
            - activate
            - setProjectWalletAddress (non-revocable)

    InsuredVesting:
        - dao
            - emergencyRelease
            - recover
        - project
            - claimOnBehalf
            - emergencyClaimOnBehalf
            - setAllowedAllocation?
            - setProjectWalletAddress (non-revocable)
     */
    function emergencyClaim(address target) external onlyOwnerOrSender(target) {
        UserVesting storage userStatus = userVestings[target];
        if (!emergencyReleased) revert EmergencyNotReleased();
        if (userStatus.fundingTokenFunded == 0) revert NoFundsAdded();

        uint256 toClaim = userStatus.fundingTokenFunded - userStatus.fundingTokenClaimed;
        userStatus.fundingTokenClaimed += toClaim;
        FUNDING_TOKEN.safeTransfer(target, toClaim);

        emit UserEmergencyClaimed(target, toClaim);
    }

    // TODO(audit) - separate to recoverEth as in VestingV1
    function recover(address tokenAddress) external onlyOwner {
        // Return any balance of the token that's not projectToken
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));
        // // in case of PROJECT_TOKEN, we also need to retain the total locked amount in the contract

        if (tokenAddress == address(PROJECT_TOKEN) && !emergencyReleased) {
            tokenBalanceToRecover -= Math.min(totalFundingTokenFunded * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATE, tokenBalanceToRecover);
        }

        if (tokenAddress == address(FUNDING_TOKEN)) {
            tokenBalanceToRecover -= Math.min(totalFundingTokenFunded, tokenBalanceToRecover);
        }

        IERC20(tokenAddress).safeTransfer(projectWallet, tokenBalanceToRecover);

        uint256 etherToRecover = address(this).balance;
        Address.sendValue(payable(projectWallet), etherToRecover);

        emit AmountRecovered(tokenAddress, tokenBalanceToRecover, etherToRecover);
    }

    // --- View functions ---
    // TODO(audit) - view functions as in VestingV1

    function fundingTokenVestedFor(address target) public view returns (uint256) {
        if (vestingStartTime == 0) return 0;

        UserVesting storage targetStatus = userVestings[target];
        return Math.min(targetStatus.fundingTokenFunded, ((block.timestamp - vestingStartTime) * targetStatus.fundingTokenFunded) / VESTING_DURATION_SECONDS);
    }

    function fundingTokenClaimableFor(address target) public view returns (uint256) {
        return fundingTokenVestedFor(target) - userVestings[target].fundingTokenClaimed;
    }
}
