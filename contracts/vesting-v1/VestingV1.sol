// SPDX-License-Identifier: MIT
pragma solidity 0.8.19; // TODO(audit) choose the "correct" (i.e. stable/secure) version.

import {Ownable as OwnerRole} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProjectRole} from "../roles/ProjectRole.sol";
import {Address, IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// TODO(audit) - add a a general comment on what the contract does
// TODO(audit) - explain roles and their capabilities, which is revocable (also explain "user" role)

// when project calls activate(), the contract will:
// - transfer the necessary amount of project tokens required to cover user vestings, to fund itself
// - set the vesting clock to start at the specified time (but no more than 90 days in the future)
// - lock amounts (project cannot add or update token vesting amounts for users anymore)
contract VestingV1 is OwnerRole, ProjectRole {
    using SafeERC20 for IERC20;

    // Prevent project from locking up tokens for a long time in the future, mostly in case of human error
    uint256 public constant MAX_START_TIME_FROM_NOW = 3 * 30 days;

    // Set in constructor
    IERC20 public immutable PROJECT_TOKEN;
    uint256 public immutable VESTING_DURATION_SECONDS;

    // TODO(audit) - add comment explaining emergency release (make sure it says that users still get their tokens)
    bool public emergencyReleased = false;

    uint256 public vestingStartTime;
    uint256 public totalAmount;
    uint256 public totalClaimed;

    struct UserVesting {
        uint256 amount; // TODO(audit) explain this isn't remaining amount, but initial/etc.
        uint256 claimed;
    }

    mapping(address => UserVesting) public userVestings;

    // --- Events ---
    event AmountSet(address indexed target, uint256 amount); // TODO(audit) - add old amount
    event Activated(uint256 tokensTransferred);
    event Claimed(address indexed target, uint256 amount); // TODO(audit) - isClaimedByProject
    event EmergencyRelease(); // TODO(audit) - rename to past tense
    event EmergencyClaimed(address indexed target, uint256 amount, bool indexed isClaimedByProject);
    event TokenRecovered(address indexed token, uint256 amount);
    event EtherRecovered(uint256 amount);

    // --- Errors ---
    error StartTimeTooDistant(uint256 vestingStartTime, uint256 maxStartTime);
    error StartTimeInPast(uint256 vestingStartTime);
    error OnlyProjectOrSender();
    error NotActivated();
    error VestingNotStarted();
    error AlreadyActivated();
    error NothingToClaim();
    error TotalAmountZero();
    error EmergencyReleased(); // TODO(audit) - rename (avoid conflict with event)
    error EmergencyNotReleased(); // TODO(audit) - NotEmergencyReleased

    // --- Modifiers ---
    modifier onlyBeforeActivation() {
        if (isActivated()) revert AlreadyActivated();
        _;
    }

    modifier onlyProjectOrSender(address target) {
        if (!(msg.sender == projectWallet || msg.sender == target)) revert OnlyProjectOrSender();
        _;
    }

    constructor(address _projectToken, uint256 _vestingDurationSeconds, address _projectWallet) ProjectRole(_projectWallet) {
        PROJECT_TOKEN = IERC20(_projectToken);
        VESTING_DURATION_SECONDS = _vestingDurationSeconds; // TODO(audit) reconsider check no more than 10yrs
    }

    // --- User only functions ---
    function claim(address user) external onlyProjectOrSender(user) {
        if (!isVestingStarted()) revert VestingNotStarted();
        uint256 claimable = claimableFor(user);
        if (claimable == 0) revert NothingToClaim();

        userVestings[user].claimed += claimable;
        totalClaimed += claimable;
        PROJECT_TOKEN.safeTransfer(user, claimable);

        emit Claimed(user, claimable);
    }

    // --- Project only functions ---
    function setAmount(address user, uint256 newAmount) external onlyProject onlyBeforeActivation {
        uint256 amount = userVestings[user].amount;

        if (newAmount > amount) {
            totalAmount += (newAmount - amount);
        } else {
            totalAmount -= (amount - newAmount);
        }

        userVestings[user].amount = newAmount;

        emit AmountSet(user, newAmount);
    }

    function activate(uint256 _vestingStartTime) external onlyProject onlyBeforeActivation {
        if (_vestingStartTime > (block.timestamp + MAX_START_TIME_FROM_NOW))
            revert StartTimeTooDistant(_vestingStartTime, block.timestamp + MAX_START_TIME_FROM_NOW);

        if (_vestingStartTime < block.timestamp) revert StartTimeInPast(_vestingStartTime);

        if (totalAmount == 0) revert TotalAmountZero();

        vestingStartTime = _vestingStartTime;

        // TODO(audit) - remove delta capability and just transfer totalAmount (also applies to InsuredVesingV1)
        //               add a test that ensures that recover would work in that case
        uint256 delta = totalAmount - Math.min(PROJECT_TOKEN.balanceOf(address(this)), totalAmount);
        PROJECT_TOKEN.safeTransferFrom(msg.sender, address(this), delta);

        emit Activated(delta);
    }

    // --- Emergency functions ---
    // TODO(Audit) - ensure with legal/compliance we're ok without an emergency lever to release all tokens here
    function emergencyRelease() external onlyOwner {
        if (emergencyReleased) revert EmergencyReleased();
        // If not activated, the contract does not hold any tokens, so there's nothing to release
        if (!isActivated()) revert NotActivated();

        emergencyReleased = true;
        emit EmergencyRelease();
    }

    function emergencyClaim(address user) external onlyProjectOrSender(user) {
        if (!emergencyReleased) revert EmergencyNotReleased();

        UserVesting storage userStatus = userVestings[user];
        uint256 claimable = userStatus.amount - userStatus.claimed;
        if (claimable == 0) revert NothingToClaim();

        userStatus.claimed += claimable;
        totalClaimed += claimable;
        PROJECT_TOKEN.safeTransfer(user, claimable);

        emit EmergencyClaimed(user, claimable, msg.sender == projectWallet);
    }

    function recoverToken(address tokenAddress) external onlyOwner {
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));

        // Recover only project tokens that were sent by accident (tokens allocated to users will NOT be recovered)
        if (tokenAddress == address(PROJECT_TOKEN)) {
            if (totalAmount - totalClaimed >= tokenBalanceToRecover) revert NothingToClaim();
            tokenBalanceToRecover -= totalAmount - totalClaimed;
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

    function totalVestedFor(address user) public view returns (uint256) {
        if (!isVestingStarted()) return 0;
        UserVesting memory userVesting = userVestings[user];
        return Math.min(((block.timestamp - vestingStartTime) * userVesting.amount) / VESTING_DURATION_SECONDS, userVesting.amount);
    }

    function claimableFor(address user) public view returns (uint256) {
        return totalVestedFor(user) - userVestings[user].claimed;
    }
}
