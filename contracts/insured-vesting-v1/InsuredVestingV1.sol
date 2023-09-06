// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address, IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract InsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    uint256 TOKEN_RATE_PRECISION = 1e20;

    // TODO(Audit) comment - rename "PROJECT_TOKEN" (FUNDING_TOKEN for insured)
    IERC20 public immutable USDC;
    IERC20 public immutable XCTD;
    uint256 public immutable XCTD_TO_USDC_RATE; // TODO(audit) rename to PROJECT_TOKEN_TO_FUNDING_TOKEN_RATE
    uint256 public immutable VESTING_DURATION_SECONDS;

    bool public emergencyReleased = false;
    address public project;

    uint256 public startTime;
    uint256 public totalUsdcFunded;

    enum ClaimDecision {
        TOKENS,
        USDC
    }

    struct UserVesting {
        // Actual USDC amount funded by user
        uint256 usdcFunded;
        // Investment allocation, set by owner
        uint256 usdcAllocation;
        // Whether the user wants to claim XCTD or claim back USDC
        ClaimDecision claimDecision;
        // Amount of USDC claimed by user (XCTD is computed from that)
        uint256 usdcClaimed;
    }

    mapping(address => UserVesting) public userVestings;

    // --- Events ---
    event UserClaimed(address indexed target, uint256 usdcAmount, uint256 xctdAmount);
    event UserEmergencyClaimed(address indexed target, uint256 usdcAmount);
    event ProjectClaimed(address indexed target, uint256 usdcAmount, uint256 xctdAmount);
    event AllocationSet(address indexed target, uint256 amount);
    event FundsAdded(address indexed target, uint256 amount);
    event EmergencyRelease();
    event DecisionChanged(address indexed target, ClaimDecision decision);
    event AmountRecovered(address indexed token, uint256 tokenAmount, uint256 etherAmount);
    event ProjectAddressChanged(address indexed oldAddress, address indexed newAddress);
    event VestingStarted(uint256 xctdTransferredToContract);

    // --- Errors ---
    error ZeroAddress();
    error VestingAlreadyStarted();
    error VestingNotStarted();
    error AllocationExceeded(uint256 amount);
    error NothingToClaim();
    error NoFundsAdded();
    error EmergencyReleased();
    error EmergencyNotReleased();
    error OnlyOwnerOrSender();

    // --- Modifiers ---
    modifier onlyBeforeVesting() {
        if (startTime != 0) revert VestingAlreadyStarted();
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

    constructor(address _usdc, address _xctd, address _project, uint256 _xctdToUsdcRate, uint256 _vestingDurationSeconds) {
        USDC = IERC20(_usdc);
        XCTD = IERC20(_xctd);

        if (_project == address(0)) revert ZeroAddress(); // TODO(audit) - remove

        VESTING_DURATION_SECONDS = _vestingDurationSeconds;
        // how many Project tokens you get per each 1 Funding token
        XCTD_TO_USDC_RATE = _xctdToUsdcRate; // 7 XCTD per 1 USD -> 1e12 * 7

        project = _project; // TODO(audit) - rename to projectWallet
    }

    // --- User functions ---
    function addFunds(uint256 amount) external onlyBeforeVesting onlyIfNotEmergencyReleased {
        if ((userVestings[msg.sender].usdcAllocation - userVestings[msg.sender].usdcFunded) < amount) revert AllocationExceeded(amount);

        userVestings[msg.sender].usdcFunded += amount;
        totalUsdcFunded += amount;
        USDC.safeTransferFrom(msg.sender, address(this), amount);

        emit FundsAdded(msg.sender, amount);
    }

    function claim(address target) external onlyOwnerOrSender(target) onlyIfNotEmergencyReleased {
        if (startTime == 0) revert VestingNotStarted();

        UserVesting storage userStatus = userVestings[target];
        if (userStatus.usdcFunded == 0) revert NoFundsAdded();

        uint256 claimableUsdc = usdcClaimableFor(target);
        if (claimableUsdc == 0) revert NothingToClaim();
        userStatus.usdcClaimed += claimableUsdc;

        uint256 claimableXctd = usdcToXctd(claimableUsdc);

        // TODO consider using ternary conditions for readability
        if (userStatus.claimDecision == ClaimDecision.TOKENS) {
            XCTD.safeTransfer(target, claimableXctd);
            USDC.safeTransfer(project, claimableUsdc);

            emit UserClaimed(target, 0, claimableXctd);
            emit ProjectClaimed(target, claimableUsdc, 0);
        } else {
            XCTD.safeTransfer(project, claimableXctd);
            USDC.safeTransfer(target, claimableUsdc);

            emit UserClaimed(target, claimableUsdc, 0);
            emit ProjectClaimed(target, 0, claimableXctd);
        }
    }

    // TODO(audit) - two setters, each for one of the two decisions
    // decision1 - PROJECT_TOKENS
    // decision2 - REFUND_FUNDING_TOKENS
    function toggleDecision() external {
        if (userVestings[msg.sender].usdcFunded == 0) revert NoFundsAdded();
        userVestings[msg.sender].claimDecision = userVestings[msg.sender].claimDecision == ClaimDecision.TOKENS ? ClaimDecision.USDC : ClaimDecision.TOKENS;

        emit DecisionChanged(msg.sender, userVestings[msg.sender].claimDecision);
    }

    // --- Owner functions ---

    // TODO(audit) - rename to setAllowedAllocation
    function setAllocation(address target, uint256 _usdcAllocation) external onlyOwner onlyBeforeVesting onlyIfNotEmergencyReleased {
        // Update user allocation
        userVestings[target].usdcAllocation = _usdcAllocation;

        // Refund user if they have funded more than the new allocation
        if (userVestings[target].usdcFunded > _usdcAllocation) {
            uint256 _usdcToRefund = userVestings[target].usdcFunded - _usdcAllocation;
            userVestings[target].usdcFunded = _usdcAllocation;
            totalUsdcFunded -= _usdcToRefund;
            USDC.safeTransfer(target, _usdcToRefund);
        }

        emit AllocationSet(target, _usdcAllocation);
    }

    // TODO(audit) - change similar to VestingV1
    // TODO(audit) - rename onlyBeforeActivation (consider whether an additional onlyBeforeVestingStarted is needed)
    function activate() external onlyOwner onlyBeforeVesting {
        if (totalUsdcFunded == 0) revert NoFundsAdded();
        startTime = block.timestamp;

        uint256 totalRequiredXctd = usdcToXctd(totalUsdcFunded);
        uint256 delta = totalRequiredXctd - Math.min(XCTD.balanceOf(address(this)), totalRequiredXctd);

        XCTD.safeTransferFrom(project, address(this), delta);

        emit VestingStarted(delta);
    }

    // TODO - revisit this with Tal
    function setProjectAddress(address newProject) external onlyOwner {
        if (newProject == address(0)) revert ZeroAddress();

        address oldProjectAddress = project;
        project = newProject;

        emit ProjectAddressChanged(oldProjectAddress, newProject);
    }

    // --- Emergency functions ---
    // Used to allow users to claim back USDC if anything goes wrong
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
        if (userStatus.usdcFunded == 0) revert NoFundsAdded();

        uint256 toClaim = userStatus.usdcFunded - userStatus.usdcClaimed;
        userStatus.usdcClaimed += toClaim;
        USDC.safeTransfer(target, toClaim);

        emit UserEmergencyClaimed(target, toClaim);
    }

    // TODO(audit) - separate to recoverEth as in VestingV1
    function recover(address tokenAddress) external onlyOwner {
        // Return any balance of the token that's not xctd
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));
        // // in case of XCTD, we also need to retain the total locked amount in the contract

        if (tokenAddress == address(XCTD) && !emergencyReleased) {
            tokenBalanceToRecover -= Math.min(usdcToXctd(totalUsdcFunded), tokenBalanceToRecover);
        }

        if (tokenAddress == address(USDC)) {
            tokenBalanceToRecover -= Math.min(totalUsdcFunded, tokenBalanceToRecover);
        }

        IERC20(tokenAddress).safeTransfer(project, tokenBalanceToRecover);

        uint256 etherToRecover = address(this).balance;
        Address.sendValue(payable(project), etherToRecover);

        emit AmountRecovered(tokenAddress, tokenBalanceToRecover, etherToRecover);
    }

    // --- View functions ---
    // TODO(audit) - view functions as in VestingV1

    function usdcToXctd(uint256 usdc) public view returns (uint256) {
        return (usdc * TOKEN_RATE_PRECISION) / XCTD_TO_USDC_RATE;
    }

    function usdcVestedFor(address target) public view returns (uint256) {
        if (startTime == 0) return 0;

        UserVesting storage targetStatus = userVestings[target];
        return Math.min(targetStatus.usdcFunded, ((block.timestamp - startTime) * targetStatus.usdcFunded) / VESTING_DURATION_SECONDS);
    }

    function usdcClaimableFor(address target) public view returns (uint256) {
        return usdcVestedFor(target) - userVestings[target].usdcClaimed;
    }
}
