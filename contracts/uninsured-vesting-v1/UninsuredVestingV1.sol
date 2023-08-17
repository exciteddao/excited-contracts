// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";

contract UninsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    struct VestingStatus {
        uint256 lastPeriodClaimed;
        uint256 amount;
        uint256 totalClaimed;
    }

    mapping(address => VestingStatus) public vestingStatuses;

    IERC20 immutable xctd;
    uint256 immutable periodCount;

    uint256 startTime = 0;
    uint256 amountAssigned = 0;

    event Claimed(uint256 indexed period, address indexed target, uint256 amount);
    event AmountAdded(address indexed target, uint256 amount);
    event StartTimeSet(uint256 timestamp);
    event AmountRecovered(address indexed token, uint256 tokenAmount, uint256 etherAmount);

    constructor(address _xctd, uint _periods) {
        xctd = IERC20(_xctd);
        periodCount = _periods;
    }

    function claim(address target) public {
        VestingStatus storage targetStatus = vestingStatuses[target];
        uint256 _vestingPeriodsPassed = vestingPeriodsPassed();
        uint256 periodsToClaim = _vestingPeriodsPassed - targetStatus.lastPeriodClaimed;

        require(_vestingPeriodsPassed > 0, "vesting has not started");
        require(periodsToClaim > 0, "already claimed until vesting period");

        uint256 amount;

        // last period, ensure remainder gets sent
        if (_vestingPeriodsPassed == periodCount) {
            amount = targetStatus.amount - targetStatus.totalClaimed;
        } else {
            amount = targetStatus.amount / periodCount;
        }

        targetStatus.totalClaimed += amount;
        targetStatus.lastPeriodClaimed = _vestingPeriodsPassed;

        xctd.safeTransfer(target, amount);
        emit Claimed(_vestingPeriodsPassed, target, amount);
    }

    function vestingPeriodsPassed() public view returns (uint256) {
        if (startTime == 0) return 0;
        if (block.timestamp < startTime) return 0;
        // + 1 means that once start time has been reached, a vesting period had already passed
        return Math.min(uint256((block.timestamp - startTime) / 30 days) + 1, periodCount);
    }

    function setStartTime(uint256 _startTime) public onlyOwner {
        if (startTime != 0 && block.timestamp > startTime) revert("vesting already started");
        if (_startTime < block.timestamp) revert("cannot set start time in the past");
        startTime = _startTime;
        emit StartTimeSet(_startTime);
    }

    function addAmount(address target, uint256 amount) public onlyOwner {
        if (startTime != 0 && block.timestamp > startTime) revert("vesting already started");
        vestingStatuses[target].amount += amount;
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
