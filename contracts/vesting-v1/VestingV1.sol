// SPDX-License-Identifier: MIT
pragma solidity 0.8.19; // TODO(audit) choose the "correct" (i.e. stable/secure) version.

import {Ownable as OwnerRole} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProjectRole} from "../roles/ProjectRole.sol";
import {Address, IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// This contract distributes a project's tokens to users proportionally over a specified period of time, such that tokens are vested.

// Roles:
// - Owner: Can accelerate (emergency release) vesting in case of a critical bug;
//          can help the project recover tokens (including overfunded project tokens) and ether sent to the contract by mistake.
//          This role is revocable.
// - Project: Can set the amount of tokens to be distributed to each user;
//            can activate (initiate vesting); can claim on behalf of users (users still get their tokens in this case).
// - User: can claim their vested tokens, once the vesting period has started.

// When project calls activate(), the contract will:
// - Transfer the necessary amount of project tokens required to cover user vestings, to fund itself.
// - Set the vesting clock to start at the specified time (but no more than 90 days in the future).
// - Lock amounts (project cannot add or update token vesting amounts for users anymore).
contract VestingV1 is OwnerRole, ProjectRole {
    using SafeERC20 for IERC20;

    // Prevent project from locking up tokens for a long time in the future, mostly in case of human error
    uint256 public constant MAX_START_TIME_FROM_NOW = 3 * 30 days;

    uint256 public constant MAX_VESTING_DURATION_SECONDS = 10 * 365 days;

    // Set in constructor
    IERC20 public immutable PROJECT_TOKEN;
    uint256 public immutable VESTING_DURATION_SECONDS;

    // When the contract is emergency released, users can claim all their unclaimed tokens immediately,
    // (the project can also claim on behalf of users. users still get their tokens in this case)
    bool public isEmergencyReleased = false;

    uint256 public vestingStartTime;
    uint256 public totalAmount;
    uint256 public totalClaimed;

    struct UserVesting {
        uint256 amount; // total amount of tokens to be vested for the user
        uint256 claimed;
    }

    mapping(address => UserVesting) public userVestings;

    // --- Events ---
    event AmountSet(address indexed user, uint256 newAmount, uint256 oldAmount);
    event Activated();
    event Claimed(address indexed user, uint256 amount, bool indexed isInitiatedByProject);
    event EmergencyReleased();
    event EmergencyClaimed(address indexed user, uint256 amount, bool indexed isInitiatedByProject);
    event TokenRecovered(address indexed token, uint256 amount);
    event EtherRecovered(uint256 amount);

    // --- Errors ---
    error VestingDurationTooLong(uint256 vestingPeriodSeconds);
    error StartTimeTooDistant(uint256 vestingStartTime, uint256 maxStartTime);
    error StartTimeInPast(uint256 vestingStartTime);
    error OnlyProjectOrSender();
    error NotActivated();
    error VestingNotStarted();
    error AlreadyActivated();
    error NothingToClaim();
    error TotalAmountZero();
    error EmergencyReleaseActive();
    error NotEmergencyReleased();

    // --- Modifiers ---
    modifier onlyBeforeActivation() {
        if (isActivated()) revert AlreadyActivated();
        _;
    }

    modifier onlyProjectOrSender(address user) {
        if (!(msg.sender == projectWallet || msg.sender == user)) revert OnlyProjectOrSender();
        _;
    }

    constructor(address _projectToken, uint256 _vestingDurationSeconds, address _projectWallet) ProjectRole(_projectWallet) {
        if (_vestingDurationSeconds > MAX_VESTING_DURATION_SECONDS) revert VestingDurationTooLong(_vestingDurationSeconds);

        PROJECT_TOKEN = IERC20(_projectToken);
        VESTING_DURATION_SECONDS = _vestingDurationSeconds;
    }

    // --- User only functions ---
    function claim(address user) external onlyProjectOrSender(user) {
        if (!isVestingStarted()) revert VestingNotStarted();
        uint256 claimable = claimableFor(user);
        if (claimable == 0) revert NothingToClaim();

        userVestings[user].claimed += claimable;
        totalClaimed += claimable;
        PROJECT_TOKEN.safeTransfer(user, claimable);

        emit Claimed(user, claimable, msg.sender == projectWallet);
    }

    // --- Project only functions ---
    function setAmount(address user, uint256 newAmount) external onlyProject onlyBeforeActivation {
        uint256 oldAmount = userVestings[user].amount;

        if (newAmount > oldAmount) {
            totalAmount += (newAmount - oldAmount);
        } else {
            totalAmount -= (oldAmount - newAmount);
        }

        userVestings[user].amount = newAmount;

        emit AmountSet(user, newAmount, oldAmount);
    }

    function activate(uint256 _vestingStartTime) external onlyProject onlyBeforeActivation {
        if (_vestingStartTime > (block.timestamp + MAX_START_TIME_FROM_NOW))
            revert StartTimeTooDistant(_vestingStartTime, block.timestamp + MAX_START_TIME_FROM_NOW);

        if (_vestingStartTime < block.timestamp) revert StartTimeInPast(_vestingStartTime);

        if (totalAmount == 0) revert TotalAmountZero();

        vestingStartTime = _vestingStartTime;

        PROJECT_TOKEN.safeTransferFrom(projectWallet, address(this), totalAmount);

        emit Activated();
    }

    // --- Emergency functions ---
    // TODO(Audit) - ensure with legal/compliance we're ok without an emergency lever to release all tokens here
    function emergencyRelease() external onlyOwner {
        if (isEmergencyReleased) revert EmergencyReleaseActive();
        // If not activated, the contract does not hold any tokens, so there's nothing to release
        if (!isActivated()) revert NotActivated();

        isEmergencyReleased = true;
        emit EmergencyReleased();
    }

    function emergencyClaim(address user) external onlyProjectOrSender(user) {
        if (!isEmergencyReleased) revert NotEmergencyReleased();

        UserVesting storage userVesting = userVestings[user];
        uint256 claimable = userVesting.amount - userVesting.claimed;
        if (claimable == 0) revert NothingToClaim();

        userVesting.claimed += claimable;
        totalClaimed += claimable;
        PROJECT_TOKEN.safeTransfer(user, claimable);

        emit EmergencyClaimed(user, claimable, msg.sender == projectWallet);
    }

    function recoverToken(address tokenAddress) external onlyOwner {
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));

        // Recover only project tokens that were sent by accident (tokens allocated to users will NOT be recovered)
        if (tokenAddress == address(PROJECT_TOKEN)) {
            uint256 totalOwed = totalAmount - totalClaimed;
            if (totalOwed >= tokenBalanceToRecover) revert NothingToClaim();
            tokenBalanceToRecover -= totalOwed;
        }

        IERC20(tokenAddress).safeTransfer(projectWallet, tokenBalanceToRecover);

        emit TokenRecovered(tokenAddress, tokenBalanceToRecover);
    }

    // Recovers the native token of the chain
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

    function totalVestedFor(address user) public view returns (uint256) {
        if (!isVestingStarted()) return 0;
        UserVesting memory userVesting = userVestings[user];
        return Math.min(((block.timestamp - vestingStartTime) * userVesting.amount) / VESTING_DURATION_SECONDS, userVesting.amount);
    }

    function claimableFor(address user) public view returns (uint256) {
        return totalVestedFor(user) - userVestings[user].claimed;
    }
}
