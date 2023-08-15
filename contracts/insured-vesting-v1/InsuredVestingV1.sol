// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 Expected interface:

 Contract Vesting:
 
 constructor(address xctdToken, address whitelistContract)
 setTokenToUsdRate(uint256) adminOnly
 
 // throws if not enough unallocated tokens
 withdrawTokens(uint256 amount) adminOnly
 
 // claims for investor, either usdc or token, according to current decision
 // claims for project according to decision
 // maintains a map of target=>period=>claimed. obviously throws if already claimed or if period hasn't arrived yet
 claim(address target, period uint256) 

 // START: throw if already started
 addTokens(uint256 amount) adminOnly
 setInsuranceRate(uint256 percentage) adminOnly
 setVestingPeriodCount(uint256 number) adminOnly
 setVestingFrequency(uint256 number) adminOnly
 setStartBlock(uint256 block) adminOnly
 addFunds(uint256 amount) // USDC. Throws if not in whitelist or does not match allocation
 // END: throw if already started
 */

contract InsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    IERC20 immutable usdc;
    IERC20 immutable xctd;
    address project;
    uint256 periodCount;
    uint256 usdcToXctdRate;
    uint256 startTime = 0;
    uint256 totalXctdAllocated = 0;

    enum Decision {
        TOKENS,
        USDC
    }

    struct VestingStatus {
        mapping(uint256 => bool) claimed;
        uint256 usdcFunded;
        uint256 allocation;
        Decision decision;
    }

    mapping(address => VestingStatus) public vestingStatuses;

    constructor(address _usdc, address _xctd, address _project, uint _periods, uint256 _usdcToXctdRate) {
        usdc = IERC20(_usdc);
        xctd = IERC20(_xctd);
        periodCount = _periods;
        usdcToXctdRate = _usdcToXctdRate;
        project = _project;
    }

    function addAllocation(address target, uint256 allocation) public onlyOwner {
        if (startTime != 0 && block.timestamp > startTime) revert("vesting already started");
        vestingStatuses[target].allocation += allocation;
        totalXctdAllocated += allocation * usdcToXctdRate;
    }

    function addFunds(uint256 amount) public {
        if (startTime != 0 && block.timestamp > startTime) revert("vesting already started");
        if ((vestingStatuses[msg.sender].allocation - vestingStatuses[msg.sender].usdcFunded) < amount) revert("amount exceeds allocation");
        usdc.transferFrom(msg.sender, address(this), amount);
        vestingStatuses[msg.sender].usdcFunded += amount;
    }

    function claim(address target, uint256 period) public {
        if (period < 1 || period > periodCount) revert("invalid period");
        if (period > vestingPeriodsPassed()) revert("period not reached");
        if (vestingStatuses[target].claimed[period]) revert("already claimed");

        vestingStatuses[target].claimed[period] = true;

        uint256 usdcToTransfer = (vestingStatuses[target].usdcFunded) / periodCount;
        uint256 xctdToTransfer = usdcToTransfer * usdcToXctdRate;

        if (vestingStatuses[target].decision == Decision.TOKENS) {
            xctd.transfer(target, xctdToTransfer);
            usdc.transfer(project, usdcToTransfer);
        } else {
            xctd.transfer(project, xctdToTransfer);
            usdc.transfer(target, usdcToTransfer);
        }
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

    function toggleDecision() public {
        vestingStatuses[msg.sender].decision = vestingStatuses[msg.sender].decision == Decision.TOKENS ? Decision.USDC : Decision.TOKENS;
    }

    function recover(address tokenAddress) external onlyOwner {
        // Return any balance of the token that's not xctd
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));
        // // in case of XCTD, we also need to retain the total locked amount in the contract
        if (tokenAddress == address(xctd)) {
            tokenBalanceToRecover -= totalXctdAllocated;
        }

        IERC20(tokenAddress).safeTransfer(owner(), tokenBalanceToRecover);

        // in case of ETH, transfer the balance as well
        Address.sendValue(payable(owner()), address(this).balance);
    }
}
