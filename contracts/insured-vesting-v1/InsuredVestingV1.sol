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

    IERC20 public immutable usdc;
    IERC20 public immutable xctd;
    uint256 public immutable usdcToXctdRate;
    uint256 public immutable periodCount;

    // Changeable by owner
    address public project;
    bool public emergencyRelease = false;

    // Changeable by owner until start time has arrived
    uint256 public startTime = 0;

    uint256 public totalXctdAllocated = 0;

    mapping(address => VestingStatus) public vestingStatus;

    enum ClaimDecision {
        TOKENS,
        USDC
    }

    struct VestingStatus {
        uint256 lastPeriodClaimed;
        // Actual USDC amount funded by user
        uint256 usdcFunded;
        // Investment allocation, set by owner
        uint256 usdcAllocation;
        // Whether the user wants to claim XCTD or claim back USDC
        ClaimDecision claimDecision;
        // Amount of USDC and XCTD claimed by user
        uint256 usdcClaimed;
        uint256 xctdClaimed;
    }

    // Events
    event UserClaimed(address indexed target, uint256 indexed period, uint256 numberOfPeriodsClaimed, uint256 usdcAmount, uint256 xctdAmount, bool isEmergency);
    event ProjectClaimed(
        address indexed target,
        uint256 indexed period,
        uint256 numberOfPeriodsClaimed,
        uint256 usdcAmount,
        uint256 xctdAmount,
        bool isEmergency
    );
    event AllocationAdded(address indexed target, uint256 amount);
    event FundsAdded(address indexed target, uint256 amount);
    event StartTimeSet(uint256 timestamp);
    event EmergencyRelease();
    event DecisionChanged(address indexed target, ClaimDecision decision);
    event AmountRecovered(address indexed token, uint256 tokenAmount, uint256 etherAmount);

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
        vestingStatus[target].usdcAllocation += _usdcAllocation;
        totalXctdAllocated += _usdcAllocation * usdcToXctdRate;

        emit AllocationAdded(target, _usdcAllocation);
    }

    function addFunds(uint256 amount) public {
        if (startTime != 0 && block.timestamp > startTime) revert("vesting already started");
        if ((vestingStatus[msg.sender].usdcAllocation - vestingStatus[msg.sender].usdcFunded) < amount) revert("amount exceeds allocation");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        vestingStatus[msg.sender].usdcFunded += amount;

        emit FundsAdded(msg.sender, amount);
    }

    function claim(address target) public {
        VestingStatus storage userStatus = vestingStatus[target];
        uint256 _vestingPeriodsPassed = vestingPeriodsPassed();
        uint256 periodsToClaim = _vestingPeriodsPassed - userStatus.lastPeriodClaimed;

        require(!emergencyRelease, "emergency released");
        require(_vestingPeriodsPassed > 0, "vesting has not started");
        require(periodsToClaim > 0, "already claimed until vesting period");

        // require(period >= 1 && period <= periodCount, "invalid period");
        // require(period <= _vestingPeriodsPassed, "period not reached");
        // require(!userStatus.claimedForPeriod[period], "already claimed");
        require(userStatus.usdcFunded > 0, "no funds added");

        uint256 usdcToTransfer;
        uint256 xctdToTransfer;

        if (_vestingPeriodsPassed == periodCount) {
            usdcToTransfer = (userStatus.usdcFunded - userStatus.usdcClaimed);
            xctdToTransfer = (userStatus.usdcFunded * usdcToXctdRate - userStatus.xctdClaimed);
        } else {
            uint256 multiplier = _vestingPeriodsPassed - userStatus.lastPeriodClaimed;
            usdcToTransfer = (multiplier * (userStatus.usdcFunded)) / periodCount;
            xctdToTransfer = (multiplier * (userStatus.usdcFunded * usdcToXctdRate)) / periodCount;
        }

        userStatus.usdcClaimed += usdcToTransfer;
        userStatus.xctdClaimed += xctdToTransfer;
        userStatus.lastPeriodClaimed = _vestingPeriodsPassed;

        if (userStatus.claimDecision == ClaimDecision.TOKENS) {
            xctd.safeTransfer(target, xctdToTransfer);
            usdc.safeTransfer(project, usdcToTransfer);

            emit UserClaimed(target, _vestingPeriodsPassed, periodsToClaim, 0, xctdToTransfer, false);
            emit ProjectClaimed(target, _vestingPeriodsPassed, periodsToClaim, usdcToTransfer, 0, false);
        } else {
            xctd.safeTransfer(project, xctdToTransfer);
            usdc.safeTransfer(target, usdcToTransfer);

            emit UserClaimed(target, _vestingPeriodsPassed, periodsToClaim, usdcToTransfer, 0, false);
            emit ProjectClaimed(target, _vestingPeriodsPassed, periodsToClaim, 0, xctdToTransfer, false);
        }
    }

    function vestingPeriodsPassed() public view returns (uint256) {
        if (startTime == 0) return 0;
        if (block.timestamp < startTime) return 0;
        return uint256((block.timestamp - startTime) / 30 days);
    }

    function setStartTime(uint256 _startTime) public onlyOwner {
        if (startTime != 0 && block.timestamp > startTime) revert("vesting already started");
        if (_startTime < block.timestamp) revert("cannot set start time in the past");
        startTime = _startTime;

        emit StartTimeSet(_startTime);
    }

    function setProjectAddress(address _project) public onlyOwner {
        project = _project;
    }

    function toggleDecision() public {
        vestingStatus[msg.sender].claimDecision = vestingStatus[msg.sender].claimDecision == ClaimDecision.TOKENS ? ClaimDecision.USDC : ClaimDecision.TOKENS;

        emit DecisionChanged(msg.sender, vestingStatus[msg.sender].claimDecision);
    }

    // Used to allow users to claim back USDC if anything goes wrong
    function emergencyReleaseVesting() public onlyOwner {
        emergencyRelease = true;
        emit EmergencyRelease();
    }

    function emergencyClaim(address target) public {
        VestingStatus storage userStatus = vestingStatus[target];

        require(emergencyRelease, "emergency not released");
        require(userStatus.usdcFunded > 0, "no funds added");
        // check that lastperiodclaimed!=periodcount

        uint256 periodsClaimed = periodCount - userStatus.lastPeriodClaimed;
        userStatus.lastPeriodClaimed = periodCount;

        uint256 usdcToTransfer = (userStatus.usdcFunded - userStatus.usdcClaimed);
        uint256 xctdToTransfer = (userStatus.usdcFunded * usdcToXctdRate - userStatus.xctdClaimed);

        userStatus.usdcClaimed += usdcToTransfer;
        userStatus.xctdClaimed += xctdToTransfer;

        xctd.safeTransfer(project, xctdToTransfer);
        usdc.safeTransfer(target, usdcToTransfer);

        emit UserClaimed(target, periodCount, periodsClaimed, usdcToTransfer, 0, true);
        emit ProjectClaimed(target, periodCount, periodsClaimed, 0, xctdToTransfer, true);
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

        uint256 etherToRecover = address(this).balance;
        Address.sendValue(payable(owner()), etherToRecover);

        emit AmountRecovered(tokenAddress, tokenBalanceToRecover, etherToRecover);
    }
}
