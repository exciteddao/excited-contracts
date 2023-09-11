// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable as OwnerRole} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProjectRole} from "../roles/ProjectRole.sol";
import {Address, IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// when project calls activate, the contract will:
// - transfer the necessary amount of tokens required to cover all funded tokens
// - set the vesting clock to start at the specified time (no more than 90 days in the future)
// - lock allocations (project cannot add or update allocations anymore)
// - lock funding (users cannot send more funding tokens to the contract)
contract InsuredVestingV1 is OwnerRole, ProjectRole {
    using SafeERC20 for IERC20;

    // Protection mechanism for limiting the start time to a relatively close date in the future
    // This is to prevent the project from locking up tokens for a long time in the future, mostly in case of human error
    uint256 public constant MAX_START_TIME_FROM_NOW = 3 * 30 days;

    // An arbitrary precision number used for token rate calculations, including any decimal differences that may exist
    // between funding and project tokens:
    // 1e(FUNDING_TOKEN_DECIMALS) * PRECISION / 1e(PROJECT_TOKEN_DECIMALS) * strikePrice
    //
    // For example, if each PROJECT TOKEN (18 decimals) costs 0.2 FUNDING TOKEN (6 decimals):
    // e.g., PROJECT_TOKEN_TO_FUNDING_TOKEN_RATE = 1e6 * 1e20 / 1e18 * 0.2 = 20_000_000
    uint256 public constant TOKEN_RATE_PRECISION = 1e20;

    // Set in constructor
    IERC20 public immutable FUNDING_TOKEN;
    IERC20 public immutable PROJECT_TOKEN;
    uint256 public immutable PROJECT_TOKEN_TO_FUNDING_TOKEN_RATE;
    uint256 public immutable VESTING_DURATION_SECONDS;

    bool public emergencyReleased = false;

    uint256 public vestingStartTime;
    uint256 public totalFundingTokenAmount; // todo better name this?
    uint256 public totalFundingTokenClaimed;

    struct UserVesting {
        // FUNDING_TOKEN amount transferred to contract by user
        uint256 fundingTokenAmount;
        // Upper bound of funding tokens that user is allowed to send
        uint256 fundingTokenAllocation;
        // Amount of FUNDING_TOKEN claimed by user (PROJECT_TOKEN is computed based on that)
        uint256 fundingTokenClaimed;
        // true - upon claiming, user will get FUNDING_TOKEN back, false - user will get PROJECT_TOKEN
        bool shouldRefund;
    }

    mapping(address => UserVesting) public userVestings;

    // --- Events ---
    event UserClaimed(address indexed target, uint256 fundingTokenAmount, uint256 projectTokenAmount);
    event UserEmergencyClaimed(address indexed target, uint256 fundingTokenAmount);
    event ProjectClaimed(address indexed target, uint256 fundingTokenAmount, uint256 projectTokenAmount);
    event AllocationSet(address indexed target, uint256 amount);
    event FundsAdded(address indexed target, uint256 amount);
    event EmergencyRelease();
    event DecisionChanged(address indexed target, bool shouldRefund);
    event TokenRecovered(address indexed token, uint256 tokenAmount);
    event EtherRecovered(uint256 etherAmount);
    event ProjectWalletAddressChanged(address indexed oldAddress, address indexed newAddress);
    event Activated(uint256 startTime, uint256 projectTokenTransferredToContract);

    // --- Errors ---
    error StartTimeTooDistant(uint256 vestingStartTime, uint256 maxStartTime);
    error StartTimeInPast(uint256 vestingStartTime);
    error ZeroAddress();
    error SameAddress(address oldAddress, address newAddress);
    error AllocationExceeded(uint256 amount);
    error NothingToClaim();
    error NoFundsAdded();
    error OnlyProjectOrSender();
    error AlreadyActivated();
    error VestingNotStarted();
    error EmergencyReleased();
    error EmergencyNotReleased();

    // --- Modifiers ---
    modifier onlyBeforeActivation() {
        if (isActivated()) revert AlreadyActivated();
        _;
    }

    modifier onlyProjectOrSender(address target) {
        if (!(msg.sender == projectWallet || msg.sender == target)) revert OnlyProjectOrSender();
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
        uint256 _projectTokenToFundingTokenRate,
        uint256 _vestingDurationSeconds
    ) ProjectRole(_projectWallet) {
        FUNDING_TOKEN = IERC20(_fundingToken);
        PROJECT_TOKEN = IERC20(_projectToken);

        VESTING_DURATION_SECONDS = _vestingDurationSeconds;
        PROJECT_TOKEN_TO_FUNDING_TOKEN_RATE = _projectTokenToFundingTokenRate;
    }

    // --- User functions ---
    function addFunds(uint256 amount) external onlyBeforeActivation onlyIfNotEmergencyReleased {
        if ((userVestings[msg.sender].fundingTokenAllocation - userVestings[msg.sender].fundingTokenAmount) < amount) revert AllocationExceeded(amount);

        userVestings[msg.sender].fundingTokenAmount += amount;
        totalFundingTokenAmount += amount;
        FUNDING_TOKEN.safeTransferFrom(msg.sender, address(this), amount);

        emit FundsAdded(msg.sender, amount);
    }

    function claim(address target) external onlyProjectOrSender(target) onlyIfNotEmergencyReleased {
        if (!isVestingStarted()) revert VestingNotStarted();

        UserVesting storage userStatus = userVestings[target];
        if (userStatus.fundingTokenAmount == 0) revert NoFundsAdded();

        uint256 claimableFundingToken = fundingTokenClaimableFor(target);
        uint256 claimableProjectToken = projectTokenClaimableFor(target);

        if (claimableFundingToken == 0) revert NothingToClaim();
        userStatus.fundingTokenClaimed += claimableFundingToken;
        totalFundingTokenClaimed += claimableFundingToken;

        if (!userStatus.shouldRefund) {
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

    function setDecision(bool _shouldRefund) external {
        if (userVestings[msg.sender].fundingTokenAmount == 0) revert NoFundsAdded();
        if (userVestings[msg.sender].shouldRefund == _shouldRefund) return;
        userVestings[msg.sender].shouldRefund = _shouldRefund;

        emit DecisionChanged(msg.sender, _shouldRefund);
    }

    // --- Project functions ---
    function setAllocation(address target, uint256 _fundingTokenAllocation) external onlyProject onlyBeforeActivation onlyIfNotEmergencyReleased {
        // Update user allocation
        userVestings[target].fundingTokenAllocation = _fundingTokenAllocation;

        // Refund user if they have funded more than the new allocation
        if (userVestings[target].fundingTokenAmount > _fundingTokenAllocation) {
            uint256 _fundingTokenToRefund = userVestings[target].fundingTokenAmount - _fundingTokenAllocation;
            userVestings[target].fundingTokenAmount = _fundingTokenAllocation;
            totalFundingTokenAmount -= _fundingTokenToRefund;
            FUNDING_TOKEN.safeTransfer(target, _fundingTokenToRefund);
        }

        emit AllocationSet(target, _fundingTokenAllocation);
    }

    function activate(uint256 _vestingStartTime) external onlyProject onlyBeforeActivation {
        if (_vestingStartTime > (block.timestamp + MAX_START_TIME_FROM_NOW))
            revert StartTimeTooDistant(_vestingStartTime, block.timestamp + MAX_START_TIME_FROM_NOW);
        if (_vestingStartTime < block.timestamp) revert StartTimeInPast(_vestingStartTime);
        if (totalFundingTokenAmount == 0) revert NoFundsAdded();
        vestingStartTime = _vestingStartTime;

        uint256 totalRequiredProjectToken = fundingTokenToProjectToken(totalFundingTokenAmount);
        uint256 delta = totalRequiredProjectToken - Math.min(PROJECT_TOKEN.balanceOf(address(this)), totalRequiredProjectToken);

        PROJECT_TOKEN.safeTransferFrom(projectWallet, address(this), delta);

        emit Activated(vestingStartTime, delta);
    }

    // --- Emergency functions ---
    // Used to allow users to claim back FUNDING_TOKEN if anything goes wrong
    function emergencyRelease() external onlyOwner onlyIfNotEmergencyReleased {
        emergencyReleased = true;
        emit EmergencyRelease();
    }

    function emergencyClaim(address target) external onlyProjectOrSender(target) {
        UserVesting storage userStatus = userVestings[target];
        if (!emergencyReleased) revert EmergencyNotReleased();
        if (userStatus.fundingTokenAmount == 0) revert NoFundsAdded();

        uint256 toClaim = userStatus.fundingTokenAmount - userStatus.fundingTokenClaimed;
        userStatus.fundingTokenClaimed += toClaim;
        totalFundingTokenClaimed += toClaim;
        FUNDING_TOKEN.safeTransfer(target, toClaim);

        emit UserEmergencyClaimed(target, toClaim);
    }

    function recoverToken(address tokenAddress) external onlyOwner {
        // Return any balance of the token that's not projectToken
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));

        // in case of PROJECT_TOKEN, we also need to retain the total locked amount in the contract
        if (tokenAddress == address(PROJECT_TOKEN) && !emergencyReleased) {
            uint256 projectTokensAccountedFor = fundingTokenToProjectToken(totalFundingTokenAmount - totalFundingTokenClaimed);
            if (projectTokensAccountedFor >= tokenBalanceToRecover) revert NothingToClaim();
            tokenBalanceToRecover -= projectTokensAccountedFor;
        }

        if (tokenAddress == address(FUNDING_TOKEN)) {
            if (totalFundingTokenAmount - totalFundingTokenClaimed >= tokenBalanceToRecover) revert NothingToClaim();
            tokenBalanceToRecover -= totalFundingTokenAmount - totalFundingTokenClaimed;
        }

        IERC20(tokenAddress).safeTransfer(projectWallet, tokenBalanceToRecover);

        emit TokenRecovered(tokenAddress, tokenBalanceToRecover);
    }

    function recoverEther() external onlyOwner {
        uint256 etherToRecover = address(this).balance;
        Address.sendValue(payable(projectWallet), etherToRecover);

        emit EtherRecovered(etherToRecover);
    }

    // --- View functions ---
    function isActivated() public view returns (bool) {
        return vestingStartTime != 0;
    }

    function isVestingStarted() public view returns (bool) {
        return isActivated() && vestingStartTime <= block.timestamp;
    }

    function fundingTokenToProjectToken(uint256 fundingTokenAmount) public view returns (uint256) {
        return (fundingTokenAmount * TOKEN_RATE_PRECISION) / PROJECT_TOKEN_TO_FUNDING_TOKEN_RATE;
    }

    function fundingTokenVestedFor(address target) public view returns (uint256) {
        if (!isVestingStarted()) return 0;

        UserVesting storage targetStatus = userVestings[target];
        return Math.min(targetStatus.fundingTokenAmount, ((block.timestamp - vestingStartTime) * targetStatus.fundingTokenAmount) / VESTING_DURATION_SECONDS);
    }

    function fundingTokenClaimableFor(address target) public view returns (uint256) {
        return fundingTokenVestedFor(target) - userVestings[target].fundingTokenClaimed;
    }

    function projectTokenVestedFor(address target) public view returns (uint256) {
        return fundingTokenToProjectToken(fundingTokenVestedFor(target));
    }

    function projectTokenClaimableFor(address target) public view returns (uint256) {
        return fundingTokenToProjectToken(fundingTokenClaimableFor(target));
    }
}
