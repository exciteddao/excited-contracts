// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";

contract InsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    uint256 constant MIN_USDC_TO_FUND = 10 * 1e6; // 10 USDC

    IERC20 public immutable usdc;
    IERC20 public immutable xctd;
    uint256 public immutable usdcToXctdRate;
    address public immutable project;

    uint256 constant DURATION = 2 * 365 days;

    // Changeable by owner
    bool public emergencyRelease = false;

    uint256 public startTime;
    uint256 public totalUsdcFunded = 0;

    mapping(address => UserVesting) public userVestings;

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

    // Events
    event UserClaimed(address indexed target, uint256 usdcAmount, uint256 xctdAmount, bool isEmergency);
    event ProjectClaimed(address indexed target, uint256 usdcAmount, uint256 xctdAmount, bool isEmergency);
    event AllocationSet(address indexed target, uint256 amount);
    event FundsAdded(address indexed target, uint256 amount);
    event EmergencyRelease();
    event DecisionChanged(address indexed target, ClaimDecision decision);
    event AmountRecovered(address indexed token, uint256 tokenAmount, uint256 etherAmount);

    // Errors
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

    modifier onlyBeforeVesting() {
        if (startTime != 0 && block.timestamp > startTime) revert VestingAlreadyStarted();
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

    function setAllocation(address target, uint256 _usdcAllocation) external onlyOwner onlyBeforeVesting {
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

    function addFunds(uint256 amount) public onlyBeforeVesting {
        if ((userVestings[msg.sender].usdcAllocation - userVestings[msg.sender].usdcFunded) < amount) revert AllocationExceeded(amount);
        if (amount < MIN_USDC_TO_FUND) revert InsufficientFunds(amount, MIN_USDC_TO_FUND);

        userVestings[msg.sender].usdcFunded += amount;
        totalUsdcFunded += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit FundsAdded(msg.sender, amount);
    }

    function totalVestedFor(address target) public view returns (uint256) {
        if (startTime == 0 || block.timestamp < startTime) return 0;
        UserVesting storage targetStatus = userVestings[target];
        return Math.min(targetStatus.usdcFunded, ((block.timestamp - startTime) * targetStatus.usdcFunded) / DURATION);
    }

    function claimableFor(address target) public view returns (uint256) {
        uint256 totalClaimed = userVestings[target].usdcClaimed;
        uint256 totalVested = totalVestedFor(target);

        if (totalClaimed >= totalVested) return 0;

        return totalVested - totalClaimed;
    }

    function claim(address target) public {
        if (startTime == 0 || block.timestamp < startTime) revert VestingNotStarted();

        UserVesting storage userStatus = userVestings[target];
        if (userStatus.usdcFunded == 0) revert NoFundsAdded();

        uint256 claimableUsdc = claimableFor(target);

        if (emergencyRelease) revert EmergencyReleased();
        if (claimableUsdc == 0) revert NothingToClaim();

        uint256 claimableXctd = claimableUsdc * usdcToXctdRate;

        userStatus.usdcClaimed += claimableUsdc;

        if (userStatus.claimDecision == ClaimDecision.TOKENS) {
            xctd.safeTransfer(target, claimableXctd);
            usdc.safeTransfer(project, claimableUsdc);

            emit UserClaimed(target, 0, claimableXctd, false);
            emit ProjectClaimed(target, claimableUsdc, 0, false);
        } else {
            xctd.safeTransfer(project, claimableXctd);
            usdc.safeTransfer(target, claimableUsdc);

            emit UserClaimed(target, claimableUsdc, 0, false);
            emit ProjectClaimed(target, 0, claimableXctd, false);
        }
    }

    // TODO: consider the case where this never gets called, but USDC funds are locked in the contract
    function activate() external onlyOwner onlyBeforeVesting {
        if (totalUsdcFunded == 0) revert NoFundsAdded();
        startTime = block.timestamp;

        // TODO msg.sender or project?
        uint256 totalRequiredXctd = totalUsdcFunded * usdcToXctdRate;
        uint256 delta = totalRequiredXctd - Math.min(xctd.balanceOf(address(this)), totalRequiredXctd);
        xctd.safeTransferFrom(msg.sender, address(this), delta);
    }

    function toggleDecision() public {
        userVestings[msg.sender].claimDecision = userVestings[msg.sender].claimDecision == ClaimDecision.TOKENS ? ClaimDecision.USDC : ClaimDecision.TOKENS;

        emit DecisionChanged(msg.sender, userVestings[msg.sender].claimDecision);
    }

    // TODO: freeze/unfreeze by owner?

    // Used to allow users to claim back USDC if anything goes wrong
    function emergencyReleaseVesting() public onlyOwner {
        emergencyRelease = true;

        emit EmergencyRelease();
    }

    // TODO does this give too much power to the owner - being able to effectively cancel the agreement?
    function emergencyClaim(address target) public {
        // UserVesting storage userStatus = userVestings[target];
        // if (!emergencyRelease) revert EmergencyNotReleased();
        // if (userStatus.usdcFunded == 0) revert NoFundsAdded();
        // // check that lastperiodclaimed!=periodcount
        // uint256 periodsClaimed = PERIOD_COUNT - userStatus.lastPeriodClaimed;
        // userStatus.lastPeriodClaimed = PERIOD_COUNT;
        // uint256 usdcToTransfer = (userStatus.usdcFunded - userStatus.usdcClaimed);
        // uint256 xctdToTransfer = (userStatus.usdcFunded * usdcToXctdRate - userStatus.xctdClaimed);
        // userStatus.usdcClaimed += usdcToTransfer;
        // userStatus.xctdClaimed += xctdToTransfer;
        // xctd.safeTransfer(project, xctdToTransfer);
        // usdc.safeTransfer(target, usdcToTransfer);
        // emit UserClaimed(target, PERIOD_COUNT, periodsClaimed, usdcToTransfer, 0, true);
        // emit ProjectClaimed(target, PERIOD_COUNT, periodsClaimed, 0, xctdToTransfer, true);
    }

    // TODO shouldnt be able to claim usdc
    function recover(address tokenAddress) external onlyOwner {
        // Return any balance of the token that's not xctd
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));
        // // in case of XCTD, we also need to retain the total locked amount in the contract
        if (tokenAddress == address(xctd)) {
            tokenBalanceToRecover -= Math.min(totalUsdcFunded * usdcToXctdRate, tokenBalanceToRecover);
        }

        IERC20(tokenAddress).safeTransfer(owner(), tokenBalanceToRecover);

        // in case of ETH, transfer the balance as well
        Address.sendValue(payable(owner()), address(this).balance);

        uint256 etherToRecover = address(this).balance;
        Address.sendValue(payable(owner()), etherToRecover);

        emit AmountRecovered(tokenAddress, tokenBalanceToRecover, etherToRecover);
    }
}
