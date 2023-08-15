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

 transferOwnership(address newOwner)


 Contract Whitelist:
 add(address whitelisted, amount uint256)
 setDecision(decision bool) // true for token, false for usdc
 */

contract VestingV1 is Ownable {
    using SafeERC20 for IERC20;

    IERC20 immutable usdc;
    IERC20 immutable xctd;
    address project;
    uint256 periods;
    uint256 usdcToXctdRate;
    uint256 startTime;

    mapping(address => uint256) public fundings;
    mapping(address => mapping(uint256 => bool)) public claims;

    constructor(address _usdc, address _xctd, address _project, uint _periods, uint256 _usdcToXctdRate) {
        usdc = IERC20(_usdc);
        xctd = IERC20(_xctd);
        periods = _periods;
        usdcToXctdRate = _usdcToXctdRate;
        project = _project;
    }

    function addFunds(uint256 amount) public {
        usdc.transferFrom(msg.sender, address(this), amount);
        fundings[msg.sender] += amount;
        // check if in whitelist
        // check if amount matches allocation
    }

    function claim(address target, uint256 period) public {
        // todo wrong periods - 0, 25, etc
        if (period > vestingPeriod()) revert("period not reached");
        if (claims[target][period]) {
            revert("already claimed");
        }
        claims[target][period] = true;
        xctd.transfer(target, (fundings[target] * usdcToXctdRate) / periods);
        usdc.transfer(project, fundings[target] / periods);
    }

    function vestingPeriod() public view returns (uint256) {
        if (startTime == 0) return 0;
        if (block.timestamp < startTime) return 0;
        return uint256((block.timestamp - startTime) / 30 days);
    }

    function setStartTime(uint256 timestamp) public onlyOwner {
        startTime = timestamp;
    }
}
