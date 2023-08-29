// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";

/*
- consider moving to by-second resolution, this removes the need to handle remainders
- move to addition instead of divison
*/

contract UninsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    uint256 constant PERIOD_DURATION = 30 days;
    uint8 constant PERIOD_COUNT = 24;

    struct UserVesting {
        uint256 lastPeriodClaimed;
        uint256 amount;
        uint256 totalClaimed;
    }

    mapping(address => UserVesting) public userVestings;

    IERC20 immutable xctd;

    uint256 startTime;
    uint256 amountAssigned = 0;

    // Events
    event Claimed(uint256 indexed period, address indexed target, uint256 amount);
    event AmountAdded(address indexed target, uint256 amount);
    event StartTimeSet(uint256 timestamp);
    event AmountRecovered(address indexed token, uint256 tokenAmount, uint256 etherAmount);

    // Errors
    error StartTimeTooSoon(uint256 startTime, uint256 minStartTime);
    error StartTimeNotInFuture(uint256 newStartTime);
    error VestingNotStarted();
    error VestingAlreadyStarted();
    error NothingToClaim();

    constructor(address _xctd, uint256 _startTime) {
        xctd = IERC20(_xctd);

        if (_startTime < block.timestamp + 7 days) revert StartTimeTooSoon(_startTime, block.timestamp + 7 days);

        startTime = _startTime;
    }

    function getPeriodCount() public pure returns (uint8) {
        return PERIOD_COUNT;
    }

    function claim(address target) public {
        UserVesting storage targetStatus = userVestings[target];
        uint256 _vestingPeriodsPassed = vestingPeriodsPassed();
        uint256 periodsToClaim = _vestingPeriodsPassed - targetStatus.lastPeriodClaimed;

        if (_vestingPeriodsPassed == 0) revert VestingNotStarted();
        if (periodsToClaim == 0) revert NothingToClaim();

        uint256 amount;

        // last period, ensure remainder gets sent
        if (_vestingPeriodsPassed == PERIOD_COUNT) {
            amount = targetStatus.amount - targetStatus.totalClaimed;
        } else {
            amount = (targetStatus.amount * periodsToClaim) / PERIOD_COUNT;
        }

        targetStatus.totalClaimed += amount;
        targetStatus.lastPeriodClaimed = _vestingPeriodsPassed;

        xctd.safeTransfer(target, amount);

        emit Claimed(_vestingPeriodsPassed, target, amount);
    }

    function vestingPeriodsPassed() public view returns (uint256) {
        if (block.timestamp < startTime) return 0;
        // + 1 means that once start time has been reached, a vesting period had already passed
        return Math.min(uint256((block.timestamp - startTime) / PERIOD_DURATION) + 1, PERIOD_COUNT);
    }

    // TODO - should be removed unless explicitly asked by product. introduces a problem,
    // because owner can delay indefinitely.
    function setStartTime(uint256 newStartTime) public onlyOwner {
        if (block.timestamp > startTime) revert VestingAlreadyStarted();
        if (newStartTime < block.timestamp) revert StartTimeNotInFuture(newStartTime);

        startTime = newStartTime;

        emit StartTimeSet(newStartTime);
    }

    // TODO - refactor to "setAmount"
    function addAmount(address target, uint256 amount) public onlyOwner {
        if (block.timestamp > startTime) revert VestingAlreadyStarted();

        userVestings[target].amount += amount;
        amountAssigned += amount;

        emit AmountAdded(target, amount);
    }

    function recover(address tokenAddress) external onlyOwner {
        // Return any balance of the token that's not xctd
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));
        // // in case of XCTD, we also need to retain the total locked amount in the contract
        if (tokenAddress == address(xctd)) {
            tokenBalanceToRecover -= amountAssigned;
        }

        IERC20(tokenAddress).safeTransfer(owner(), tokenBalanceToRecover);

        // in case of ETH, transfer the balance as well
        uint256 etherToRecover = address(this).balance;
        Address.sendValue(payable(owner()), etherToRecover);

        emit AmountRecovered(tokenAddress, tokenBalanceToRecover, etherToRecover);
    }
}
