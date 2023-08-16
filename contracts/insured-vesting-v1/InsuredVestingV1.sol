// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

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

// TODO add more events (both contracts)
// TODO remainder of USDC + XCTD

contract InsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    IERC20 immutable usdc;
    IERC20 immutable xctd;
    address project;
    uint256 periodCount;
    uint256 usdcToXctdRate;
    uint256 startTime = 0;
    uint256 totalXctdAllocated = 0;

    enum ClaimDecision {
        TOKENS,
        USDC
    }

    struct VestingStatus {
        mapping(uint256 => bool) claimedForPeriod;
        uint256 usdcFunded;
        uint256 usdcAllocation;
        ClaimDecision claimDecision;
        uint256 usdcClaimed;
        uint256 xctdClaimed;
    }

    mapping(address => VestingStatus) public vestingStatuses;

    constructor(address _usdc, address _xctd, address _project, uint _periods, uint256 _usdcToXctdRate) {
        usdc = IERC20(_usdc);
        xctd = IERC20(_xctd);
        periodCount = _periods;
        usdcToXctdRate = _usdcToXctdRate;
        require(usdcToXctdRate > 1e12, "minimum rate is 1 USDC:XCTD");
        require(usdcToXctdRate < 100 * 1e12, "maximum rate is 100 USDC:XCTD");
        project = _project;
    }

    // TODO should we change this to a "set" functionality instead
    // if we do, naively totalXctdAllocated would be wrong and we should add a test for that
    function addAllocation(address target, uint256 _usdcAllocation) public onlyOwner {
        if (startTime != 0 && block.timestamp > startTime) revert("vesting already started");
        vestingStatuses[target].usdcAllocation += _usdcAllocation;
        totalXctdAllocated += _usdcAllocation * usdcToXctdRate;
    }

    function addFunds(uint256 amount) public {
        if (startTime != 0 && block.timestamp > startTime) revert("vesting already started");
        if ((vestingStatuses[msg.sender].usdcAllocation - vestingStatuses[msg.sender].usdcFunded) < amount) revert("amount exceeds allocation");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        vestingStatuses[msg.sender].usdcFunded += amount;
    }

    function claim(address target, uint256 period) public {
        VestingStatus storage userStatus = vestingStatuses[target];

        require(period >= 1 && period <= periodCount, "invalid period");
        require(period <= vestingPeriodsPassed(), "period not reached");
        require(!userStatus.claimedForPeriod[period], "already claimed");

        userStatus.claimedForPeriod[period] = true;

        uint256 usdcToTransfer = (userStatus.usdcFunded) / periodCount;
        uint256 xctdToTransfer = (userStatus.usdcFunded * usdcToXctdRate) / periodCount;

        if (period == periodCount) {
            usdcToTransfer = (userStatus.usdcFunded - userStatus.usdcClaimed);
            xctdToTransfer = (userStatus.usdcFunded * usdcToXctdRate - userStatus.xctdClaimed);
        }

        userStatus.usdcClaimed += usdcToTransfer;
        userStatus.xctdClaimed += xctdToTransfer;

        if (userStatus.claimDecision == ClaimDecision.TOKENS) {
            xctd.safeTransfer(target, xctdToTransfer);
            usdc.safeTransfer(project, usdcToTransfer);
        } else {
            xctd.safeTransfer(project, xctdToTransfer);
            usdc.safeTransfer(target, usdcToTransfer);
        }
    }

    function vestingPeriodsPassed() public view returns (uint256) {
        if (startTime == 0) return 0;
        if (block.timestamp < startTime) return 0;
        return uint256((block.timestamp - startTime) / 30 days);
    }

    function setStartTime(uint256 _startTime) public onlyOwner {
        // todo start time cannot be in the past
        if (startTime != 0 && block.timestamp > startTime) revert("vesting already started");
        startTime = _startTime;
    }

    function toggleDecision() public {
        vestingStatuses[msg.sender].claimDecision = vestingStatuses[msg.sender].claimDecision == ClaimDecision.TOKENS
            ? ClaimDecision.USDC
            : ClaimDecision.TOKENS;
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
