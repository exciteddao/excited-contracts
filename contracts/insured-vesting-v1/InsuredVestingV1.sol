// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";

contract InsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    uint256 constant MIN_USDC_TO_FUND = 10 * 1e6; // 10 USDC - todo - related to decimals
    uint256 constant DURATION = 2 * 365 days;

    IERC20 public immutable usdc;
    IERC20 public immutable xctd;
    uint256 public immutable usdcToXctdRate;

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

    // --- Errors ---
    error ZeroAddress();
    error VestingAlreadyStarted();
    error VestingNotStarted();
    error UsdcToXctdRateTooLow(uint256 usdcToXctdRate);
    error AllocationExceeded(uint256 amount);
    error InsufficientFunds(uint256 amount, uint256 minAmount);
    error NothingToClaim();
    error NoFundsAdded();
    error EmergencyReleased();
    error EmergencyNotReleased();
    error OnlyOwnerOrSender();

    // --- Modifiers ---
    modifier onlyBeforeVesting() {
        if (startTime != 0 && block.timestamp > startTime) revert VestingAlreadyStarted();
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
        usdc = IERC20(_usdc);
        xctd = IERC20(_xctd);

        if (_usdcToXctdRate < 10 ** (ERC20(_xctd).decimals() - ERC20(_usdc).decimals())) revert UsdcToXctdRateTooLow(_usdcToXctdRate);
        if (_project == address(0)) revert ZeroAddress();

        usdcToXctdRate = _usdcToXctdRate;
        project = _project;
    }

    // --- User functions ---
    function addFunds(uint256 amount) public onlyBeforeVesting onlyIfNotEmergencyReleased {
        if ((userVestings[msg.sender].usdcAllocation - userVestings[msg.sender].usdcFunded) < amount) revert AllocationExceeded(amount);
        if (amount < MIN_USDC_TO_FUND) revert InsufficientFunds(amount, MIN_USDC_TO_FUND);

        userVestings[msg.sender].usdcFunded += amount;
        totalUsdcFunded += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit FundsAdded(msg.sender, amount);
    }

    function claim(address target) public onlyOwnerOrSender(target) onlyIfNotEmergencyReleased {
        if (startTime == 0 || block.timestamp < startTime) revert VestingNotStarted();

        UserVesting storage userStatus = userVestings[target];
        if (userStatus.usdcFunded == 0) revert NoFundsAdded();

        uint256 claimableUsdc = claimableFor(target);
        if (claimableUsdc == 0) revert NothingToClaim();

        uint256 claimableXctd = claimableUsdc * usdcToXctdRate;
        userStatus.usdcClaimed += claimableUsdc;

        if (userStatus.claimDecision == ClaimDecision.TOKENS) {
            xctd.safeTransfer(target, claimableXctd);
            usdc.safeTransfer(project, claimableUsdc);

            emit UserClaimed(target, 0, claimableXctd);
            emit ProjectClaimed(target, claimableUsdc, 0);
        } else {
            xctd.safeTransfer(project, claimableXctd);
            usdc.safeTransfer(target, claimableUsdc);

            emit UserClaimed(target, claimableUsdc, 0);
            emit ProjectClaimed(target, 0, claimableXctd);
        }
    }

    // TODO only be able to toggle if you have an allocation
    function toggleDecision() public {
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
            usdc.safeTransfer(target, _usdcToRefund);
        }

        emit AllocationSet(target, _usdcAllocation);
    }

    function activate() external onlyOwner onlyBeforeVesting {
        if (totalUsdcFunded == 0) revert NoFundsAdded();
        startTime = block.timestamp;

        uint256 totalRequiredXctd = totalUsdcFunded * usdcToXctdRate;
        uint256 delta = totalRequiredXctd - Math.min(xctd.balanceOf(address(this)), totalRequiredXctd);

        xctd.safeTransferFrom(project, address(this), delta);
    }

    function setProjectAddress(address newProject) external onlyOwner {
        if (newProject == address(0)) revert ZeroAddress();

        address oldProjectAddress = project;
        project = newProject;

        emit ProjectAddressChanged(oldProjectAddress, newProject);
    }

    // --- Emergency functions ---
    // Used to allow users to claim back USDC if anything goes wrong
    function emergencyRelease() public onlyOwner onlyIfNotEmergencyReleased {
        emergencyReleased = true;
        emit EmergencyRelease();
    }

    function emergencyClaim(address target) public onlyOwnerOrSender(target) {
        UserVesting storage userStatus = userVestings[target];
        if (!emergencyReleased) revert EmergencyNotReleased();
        if (userStatus.usdcFunded == 0) revert NoFundsAdded();

        uint256 toClaim = userStatus.usdcFunded - userStatus.usdcClaimed;
        userStatus.usdcClaimed += toClaim;
        usdc.safeTransfer(target, toClaim);

        emit UserEmergencyClaimed(target, toClaim);
    }

    function recover(address tokenAddress) external onlyOwner {
        // Return any balance of the token that's not xctd
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));
        // // in case of XCTD, we also need to retain the total locked amount in the contract

        if (tokenAddress == address(xctd) && !emergencyReleased) {
            tokenBalanceToRecover -= Math.min(totalUsdcFunded * usdcToXctdRate, tokenBalanceToRecover);
        }

        if (tokenAddress == address(usdc)) {
            tokenBalanceToRecover -= Math.min(totalUsdcFunded, tokenBalanceToRecover);
        }

        IERC20(tokenAddress).safeTransfer(project, tokenBalanceToRecover);

        // in case of ETH, transfer the balance as well
        Address.sendValue(payable(project), address(this).balance);

        // TODO why twice..?
        uint256 etherToRecover = address(this).balance;
        Address.sendValue(payable(project), etherToRecover);

        emit AmountRecovered(tokenAddress, tokenBalanceToRecover, etherToRecover);
    }

    // --- View functions ---
    function totalVestedFor(address target) public view returns (uint256) {
        if (startTime == 0 || block.timestamp < startTime) return 0;
        UserVesting storage targetStatus = userVestings[target];
        return Math.min(targetStatus.usdcFunded, ((block.timestamp - startTime) * targetStatus.usdcFunded) / DURATION);
    }

    function claimableFor(address target) public view returns (uint256) {
        uint256 totalClaimed = userVestings[target].usdcClaimed;
        uint256 totalVested = totalVestedFor(target);

        // todo can this happen?
        if (totalClaimed >= totalVested) return 0;

        return totalVested - totalClaimed;
    }
}
