// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address, IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// TODO(Audit) comment - Rename to VestingV1
contract UninsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    // TODO(Audit) comment - rename "PROJECT_TOKEN" (FUNDING_TOKEN for insured)
    IERC20 public immutable XCTD;
    uint256 public immutable VESTING_DURATION_SECONDS;

    uint256 public startTime;
    uint256 public totalAllocated;

    struct UserVesting {
        uint256 amount;
        uint256 totalClaimed;
    }

    mapping(address => UserVesting) public userVestings;

    // --- Events ---
    event Claimed(address indexed target, uint256 amount);
    event AmountSet(address indexed target, uint256 amount);
    event StartTimeSet(uint256 timestamp);
    event AmountRecovered(address indexed token, uint256 tokenAmount, uint256 etherAmount);

    // --- Errors ---
    error StartTimeTooSoon(uint256 startTime, uint256 minStartTime);
    error StartTimeNotInFuture(uint256 newStartTime);
    error VestingNotStarted();
    error VestingAlreadyStarted();
    error NothingToClaim();
    error NoAllocationsAdded();
    error OnlyOwnerOrSender();

    // --- Modifiers ---
    modifier onlyBeforeActivation() {
        if (startTime != 0) revert VestingAlreadyStarted();
        _;
    }

    constructor(address _xctd, uint256 _vestingDurationSeconds) {
        XCTD = IERC20(_xctd);
        VESTING_DURATION_SECONDS = _vestingDurationSeconds;
    }

    // --- User functions ---
    function claim(address target) external {
        // TODO ensure that we indeed want to apply this restriction (to enable vaults / auto-compounding)
        if (!(msg.sender == owner() || msg.sender == target)) revert OnlyOwnerOrSender();
        if (startTime == 0) revert VestingNotStarted();
        uint256 claimable = claimableFor(target);
        if (claimable == 0) revert NothingToClaim();

        userVestings[target].totalClaimed += claimable;
        XCTD.safeTransfer(target, claimable);

        emit Claimed(target, claimable);
    }

    // --- Owner functions ---
    function setAmount(address target, uint256 amount) external onlyOwner onlyBeforeActivation {
        uint256 currentAmountForUser = userVestings[target].amount;

        if (amount > currentAmountForUser) {
            totalAllocated += (amount - currentAmountForUser);
        } else {
            totalAllocated -= (currentAmountForUser - amount);
        }

        userVestings[target].amount = amount;

        emit AmountSet(target, amount);
    }

    // TODO(Audit) comment - activate should get startTime as a parameter, contract would be locked for further investments
    // there will be 2 points of time (add this explanation to header of contract):
    // - activate - locks further allocations and transfers token to contract
    // - startTime - vesting starts. TODO(Audit) - rename to vestingStartTime
    // - startTime should be MAX more than 3 months
    function activate() external onlyOwner onlyBeforeActivation {
        if (totalAllocated == 0) revert NoAllocationsAdded();

        startTime = block.timestamp;
        uint256 delta = totalAllocated - Math.min(XCTD.balanceOf(address(this)), totalAllocated);
        XCTD.safeTransferFrom(msg.sender, address(this), delta);

        emit StartTimeSet(startTime);
    }

    // --- Emergency functions ---
    // TODO(Audit) - ensure with legal/compliance we're ok without an emergency lever to release all tokens here

    // TODO(Audit) separate to recoverEther and recoverTokens
    function recover(address tokenAddress) external onlyOwner {
        // Return any balance of the token that's not XCTD
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));

        // Recover only project tokens that were sent by accident (tokens assigned to investors will NOT be recovered)
        if (tokenAddress == address(XCTD)) {
            tokenBalanceToRecover -= Math.min(totalAllocated, tokenBalanceToRecover);
        }

        IERC20(tokenAddress).safeTransfer(owner(), tokenBalanceToRecover);

        // in case of ETH, transfer the balance as well
        uint256 etherToRecover = address(this).balance;
        Address.sendValue(payable(owner()), etherToRecover);

        emit AmountRecovered(tokenAddress, tokenBalanceToRecover, etherToRecover);
    }

    // --- View functions ---
    // TODO(Audit) add - isActivated, getVestingStartTime, isVestingStarted

    // TODO(Audit) - emergency release to investors

    function totalVestedFor(address target) public view returns (uint256) {
        // TODO(Audit) fix this to take a startTime that hasn't arrived yet into account
        if (startTime == 0) return 0;
        UserVesting storage targetStatus = userVestings[target];
        return Math.min(targetStatus.amount, ((block.timestamp - startTime) * targetStatus.amount) / VESTING_DURATION_SECONDS);
    }

    function claimableFor(address target) public view returns (uint256) {
        uint256 totalClaimed = userVestings[target].totalClaimed;
        uint256 totalVested = totalVestedFor(target);

        return totalVested - totalClaimed;
    }
}
