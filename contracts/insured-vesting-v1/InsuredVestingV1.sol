// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address, IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract InsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    // TODO: move to deployscrip
    uint256 public constant DURATION = 2 * 365 days;

    IERC20 public immutable USDC;
    IERC20 public immutable XCTD;
    uint256 public immutable USDC_TO_XCTD_RATE;

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
    error UsdcToXctdRateTooLow(uint256 usdcToXctdRate);
    error AllocationExceeded(uint256 amount);
    error BelowMinFundingAmount(uint256 amount);
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

    // in real life: 80*1e12 = $0.0125 XCTD
    // TODO - do not use decimals()
    constructor(address _usdc, address _xctd, address _project, uint256 _usdcToXctdRate) {
        USDC = IERC20(_usdc);
        XCTD = IERC20(_xctd);

        // TODO: do these checks in deploy script rather than here
        if (_usdcToXctdRate < 10 ** (ERC20(_xctd).decimals() - ERC20(_usdc).decimals())) revert UsdcToXctdRateTooLow(_usdcToXctdRate);
        if (_project == address(0)) revert ZeroAddress();

        USDC_TO_XCTD_RATE = _usdcToXctdRate;
        project = _project;
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

        uint256 claimableXctd = claimableUsdc * USDC_TO_XCTD_RATE;

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

    function toggleDecision() external {
        if (userVestings[msg.sender].usdcFunded == 0) revert NoFundsAdded();
        userVestings[msg.sender].claimDecision = userVestings[msg.sender].claimDecision == ClaimDecision.TOKENS ? ClaimDecision.USDC : ClaimDecision.TOKENS;

        emit DecisionChanged(msg.sender, userVestings[msg.sender].claimDecision);
    }

    // --- Owner functions ---
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

    function activate() external onlyOwner onlyBeforeVesting {
        if (totalUsdcFunded == 0) revert NoFundsAdded();
        startTime = block.timestamp;

        uint256 totalRequiredXctd = totalUsdcFunded * USDC_TO_XCTD_RATE;
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

    function emergencyClaim(address target) external onlyOwnerOrSender(target) {
        UserVesting storage userStatus = userVestings[target];
        if (!emergencyReleased) revert EmergencyNotReleased();
        if (userStatus.usdcFunded == 0) revert NoFundsAdded();

        uint256 toClaim = userStatus.usdcFunded - userStatus.usdcClaimed;
        userStatus.usdcClaimed += toClaim;
        USDC.safeTransfer(target, toClaim);

        emit UserEmergencyClaimed(target, toClaim);
    }

    function recover(address tokenAddress) external onlyOwner {
        // Return any balance of the token that's not xctd
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));
        // // in case of XCTD, we also need to retain the total locked amount in the contract

        if (tokenAddress == address(XCTD) && !emergencyReleased) {
            tokenBalanceToRecover -= Math.min(totalUsdcFunded * USDC_TO_XCTD_RATE, tokenBalanceToRecover);
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
    function usdcVestedFor(address target) public view returns (uint256) {
        if (startTime == 0) return 0;

        UserVesting storage targetStatus = userVestings[target];
        return Math.min(targetStatus.usdcFunded, ((block.timestamp - startTime) * targetStatus.usdcFunded) / DURATION);
    }

    function usdcClaimableFor(address target) public view returns (uint256) {
        return usdcVestedFor(target) - userVestings[target].usdcClaimed;
    }
}
