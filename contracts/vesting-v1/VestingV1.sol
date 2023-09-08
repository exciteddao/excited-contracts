// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProjectRole} from "../ownable/ProjectRole.sol";
import {Address, IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// when project calls activate, the contract will:
// - transfer the necessary amount of tokens required to cover all allocations
// - set the vesting clock to start at the specified time (no more than 90 days in the future)
// - lock the contract for any further allocations
contract VestingV1 is Ownable, ProjectRole {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_START_TIME_FROM_NOW = 3 * 30 days;

    IERC20 public immutable PROJECT_TOKEN;
    uint256 public immutable VESTING_DURATION_SECONDS;

    bool public emergencyReleased = false;

    uint256 public vestingStartTime;
    uint256 public totalAllocated;

    struct UserVesting {
        uint256 amount;
        uint256 totalClaimed;
    }

    mapping(address => UserVesting) public userVestings;

    // --- Events ---
    event Claimed(address indexed target, uint256 amount);
    event AmountSet(address indexed target, uint256 amount);
    event Activated(uint256 timestamp, uint256 tokensTransferred);
    event EmergencyRelease();
    event UserEmergencyClaimed(address indexed target, uint256 projectTokenAmount);
    event TokenRecovered(address indexed token, uint256 tokenAmount);
    event EtherRecovered(uint256 etherAmount);

    // --- Errors ---
    error StartTimeTooLate(uint256 vestingStartTime, uint256 maxStartTime);
    error StartTimeIsInPast(uint256 vestingStartTime);
    error VestingNotStarted();
    error NothingToClaim();
    error NoAllocationsAdded();
    error OnlyProjectOrSender();
    error AlreadyActivated();
    error NotActivated();
    error EmergencyReleased();
    error EmergencyNotReleased();

    // --- Modifiers ---
    modifier onlyBeforeActivation() {
        if (isActivated()) revert AlreadyActivated();
        _;
    }

    modifier onlyIfNotEmergencyReleased() {
        if (emergencyReleased) revert EmergencyReleased();
        _;
    }

    modifier onlyProjectOrSender(address target) {
        if (!(msg.sender == projectWallet || msg.sender == target)) revert OnlyProjectOrSender();
        _;
    }

    constructor(address _projectToken, uint256 _vestingDurationSeconds, address _projectWallet) ProjectRole(_projectWallet) {
        PROJECT_TOKEN = IERC20(_projectToken);
        VESTING_DURATION_SECONDS = _vestingDurationSeconds;
    }

    // --- Investor functions ---
    function claim(address target) external onlyProjectOrSender(target) onlyIfNotEmergencyReleased {
        // TODO ensure that we indeed want to apply this restriction (to enable vaults / auto-compounding)
        if (!isVestingStarted()) revert VestingNotStarted();
        uint256 claimable = claimableFor(target);
        if (claimable == 0) revert NothingToClaim();

        userVestings[target].totalClaimed += claimable;
        PROJECT_TOKEN.safeTransfer(target, claimable);

        emit Claimed(target, claimable);
    }

    // --- Project only functions ---
    function setAmount(address target, uint256 amount) external onlyProject onlyBeforeActivation {
        uint256 currentAmountForUser = userVestings[target].amount;

        if (amount > currentAmountForUser) {
            totalAllocated += (amount - currentAmountForUser);
        } else {
            totalAllocated -= (currentAmountForUser - amount);
        }

        userVestings[target].amount = amount;

        emit AmountSet(target, amount);
    }

    function activate(uint256 _vestingStartTime) external onlyProject onlyBeforeActivation {
        if (_vestingStartTime > (block.timestamp + MAX_START_TIME_FROM_NOW))
            revert StartTimeTooLate(_vestingStartTime, block.timestamp + MAX_START_TIME_FROM_NOW);
        if (_vestingStartTime < block.timestamp) revert StartTimeIsInPast(_vestingStartTime);
        if (totalAllocated == 0) revert NoAllocationsAdded();

        vestingStartTime = _vestingStartTime;
        uint256 delta = totalAllocated - Math.min(PROJECT_TOKEN.balanceOf(address(this)), totalAllocated);
        PROJECT_TOKEN.safeTransferFrom(msg.sender, address(this), delta);

        emit Activated(vestingStartTime, delta);
    }

    // --- Emergency functions ---
    // TODO(Audit) - ensure with legal/compliance we're ok without an emergency lever to release all tokens here
    function emergencyRelease() external onlyOwner onlyIfNotEmergencyReleased {
        if (vestingStartTime == 0) revert NotActivated();
        emergencyReleased = true;
        emit EmergencyRelease();
    }

    function emergencyClaim(address target) external onlyProjectOrSender(target) {
        UserVesting storage userStatus = userVestings[target];
        if (!emergencyReleased) revert EmergencyNotReleased();
        if (userStatus.amount == 0) revert NothingToClaim(); // TODO different error?

        uint256 toClaim = userStatus.amount - userStatus.totalClaimed;
        userStatus.totalClaimed += toClaim;
        PROJECT_TOKEN.safeTransfer(target, toClaim);

        emit UserEmergencyClaimed(target, toClaim);
    }

    function recoverToken(address tokenAddress) external onlyOwner {
        // Return any balance of the token that's not PROJECT_TOKEN
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));

        // Recover only project tokens that were sent by accident (tokens assigned to investors will NOT be recovered)
        if (tokenAddress == address(PROJECT_TOKEN)) {
            tokenBalanceToRecover -= Math.min(totalAllocated, tokenBalanceToRecover);
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

    function totalVestedFor(address target) public view returns (uint256) {
        if (!isVestingStarted()) return 0;
        UserVesting storage targetStatus = userVestings[target];
        return Math.min(targetStatus.amount, ((block.timestamp - vestingStartTime) * targetStatus.amount) / VESTING_DURATION_SECONDS);
    }

    function claimableFor(address target) public view returns (uint256) {
        uint256 totalClaimed = userVestings[target].totalClaimed;
        uint256 totalVested = totalVestedFor(target);

        return totalVested - totalClaimed;
    }
}
