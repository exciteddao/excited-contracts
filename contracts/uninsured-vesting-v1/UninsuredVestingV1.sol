// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract UninsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    struct VestingStatus {
        mapping(uint256 => bool) claimed;
        uint256 amount;
        uint256 totalClaimed;
    }

    mapping(address => VestingStatus) public vestingStatuses;

    IERC20 immutable xctd;
    uint256 immutable periodCount;

    uint256 startTime = 0;
    uint256 amountAssigned = 0;

    event Claimed(uint256 indexed period, address indexed target, uint256 amount);

    constructor(address _xctd, uint _periods) {
        xctd = IERC20(_xctd);
        periodCount = _periods;
    }

    function claim(address target, uint256 period) public {
        if (period < 1 || period > periodCount) revert("invalid period");
        if (period > vestingPeriodsPassed()) revert("period not reached");
        if (vestingStatuses[target].claimed[period]) revert("already claimed");

        uint256 amount = vestingStatuses[target].amount / periodCount;

        // last period, ensure remainder gets sent
        if (period == periodCount) {
            amount = vestingStatuses[target].amount - vestingStatuses[target].totalClaimed;
        }

        vestingStatuses[target].totalClaimed += amount;
        vestingStatuses[target].claimed[period] = true;

        xctd.transfer(target, amount);
        emit Claimed(period, target, amount);
    }

    function vestingPeriodsPassed() public view returns (uint256) {
        if (startTime == 0) return 0;
        if (block.timestamp < startTime) return 0;
        return uint256((block.timestamp - startTime) / 30 days);
    }

    function setStartTime(uint256 timestamp) public onlyOwner {
        if (startTime != 0 && block.timestamp > startTime) revert("vesting already started");
        startTime = timestamp;
    }

    function addAmount(address target, uint256 amount) public onlyOwner {
        if (startTime != 0 && block.timestamp > startTime) revert("vesting already started");
        vestingStatuses[target].amount += amount;
        amountAssigned += amount;
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
        Address.sendValue(payable(owner()), address(this).balance);
    }
}
