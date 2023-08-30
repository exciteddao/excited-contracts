// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";

contract UninsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    struct UserVesting {
        uint256 amount;
        uint256 totalClaimed;
    }

    mapping(address => UserVesting) public userVestings;

    IERC20 immutable xctd;
    uint256 immutable DURATION = 2 * 365 days;

    uint256 startTime;
    // TODO: rename this / remove when we change recovery functionality
    uint256 amountAssigned = 0;

    // Events
    event Claimed(address indexed target, uint256 amount);
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

    // Read functions

    // TODO - should be removed unless explicitly asked by product. introduces a problem,
    // because owner can delay indefinitely.
    function setStartTime(uint256 newStartTime) public onlyOwner {
        if (block.timestamp > startTime) revert VestingAlreadyStarted();
        if (newStartTime < block.timestamp) revert StartTimeNotInFuture(newStartTime);

        startTime = newStartTime;

        emit StartTimeSet(newStartTime);
    }

    function totalVestedFor(address target) public view returns (uint256) {
        if (block.timestamp < startTime) return 0;
        UserVesting storage targetStatus = userVestings[target];
        return Math.min(targetStatus.amount, ((block.timestamp - startTime) * targetStatus.amount) / DURATION);
    }

    function claimableFor(address target) public view returns (uint256) {
        uint256 totalClaimed = userVestings[target].totalClaimed;
        uint256 totalVested = totalVestedFor(target);

        if (totalClaimed >= totalVested) return 0;

        return totalVested - totalClaimed;
    }

    function claim(address target) public {
        if (block.timestamp < startTime) revert VestingNotStarted();

        uint256 claimable = claimableFor(target);

        if (claimable == 0) revert NothingToClaim();

        userVestings[target].totalClaimed += claimable;
        xctd.safeTransfer(target, claimable);

        emit Claimed(target, claimable);
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
