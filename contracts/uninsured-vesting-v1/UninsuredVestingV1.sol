// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";

/*
- consider moving to by-second resolution, this removes the need to handle remainders
- move to addition instead of divison
- switch to if-revert custom errors
*/

contract UninsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    struct UserVesting {
        uint256 lastPeriodClaimed;
        uint256 amount;
        uint256 totalClaimed;
    }

    mapping(address => UserVesting) public userVestings;

    IERC20 immutable xctd;
    uint256 immutable periodCount;

    uint256 startTime;
    uint256 amountAssigned = 0;

    error AlreadyStarted();

    event Claimed(uint256 indexed period, address indexed target, uint256 amount);
    event AmountAdded(address indexed target, uint256 amount);
    event StartTimeSet(uint256 timestamp);
    event AmountRecovered(address indexed token, uint256 tokenAmount, uint256 etherAmount);

    constructor(address _xctd, uint _periods, uint256 _startTime) {
        xctd = IERC20(_xctd);
        require(_startTime > block.timestamp + 7 days, "startTime must be more than 7 days from now");
        require(_periods >= 3, "periodCount must be at least 3");
        startTime = _startTime;
        periodCount = _periods;
    }

    function claim(address target) public {
        UserVesting storage targetStatus = userVestings[target];
        uint256 _vestingPeriodsPassed = vestingPeriodsPassed();
        uint256 periodsToClaim = _vestingPeriodsPassed - targetStatus.lastPeriodClaimed;

        require(_vestingPeriodsPassed > 0, "vesting has not started");
        require(periodsToClaim > 0, "already claimed until vesting period");

        uint256 amount;

        // last period, ensure remainder gets sent
        if (_vestingPeriodsPassed == periodCount) {
            amount = targetStatus.amount - targetStatus.totalClaimed;
        } else {
            amount = (targetStatus.amount * periodsToClaim) / periodCount;
        }

        targetStatus.totalClaimed += amount;
        targetStatus.lastPeriodClaimed = _vestingPeriodsPassed;

        xctd.safeTransfer(target, amount);
        emit Claimed(_vestingPeriodsPassed, target, amount);
    }

    function vestingPeriodsPassed() public view returns (uint256) {
        if (block.timestamp < startTime) return 0;
        // + 1 means that once start time has been reached, a vesting period had already passed
        return Math.min(uint256((block.timestamp - startTime) / 30 days) + 1, periodCount);
    }

    // TODO - should be removed unless explicitly asked by product. introduces a problem,
    // because owner can delay indefinitely.
    function setStartTime(uint256 newStartTime) public onlyOwner {
        if (block.timestamp > startTime) revert("vesting already started");
        if (newStartTime < block.timestamp) revert("cannot set start time in the past");
        startTime = newStartTime;
        emit StartTimeSet(newStartTime);
    }

    // TODO - refactor to "setAmount"
    function addAmount(address target, uint256 amount) public onlyOwner {
        if (block.timestamp > startTime) revert AlreadyStarted();
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
