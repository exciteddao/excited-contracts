// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";

/* 
Internal Audit:
- tests
- refactor
- line by line
- 7th september, most blocks are 4-7 september
- compare to other vesting contracts (open zeppelin)

TODO:
- Linear
- Multiplying rather than dividing
- Battle tested options contract (look at RibbonFinance, Opyn, Hegic, GMX, etc)
*/

contract InsuredVestingV1 is Ownable {
    using SafeERC20 for IERC20;

    uint256 constant MIN_USDC_TO_FUND = 10 * 1e6; // 10 USDC
    uint256 constant PERIOD_DURATION = 30 days;

    IERC20 public immutable usdc;
    IERC20 public immutable xctd;
    uint256 public immutable usdcToXctdRate;
    uint256 public immutable periodCount;

    // Changeable by owner
    address public project;
    bool public emergencyRelease = false;

    // Changeable by owner until start time has arrived
    uint256 public startTime;

    uint256 public totalXctdAllocated = 0;

    mapping(address => UserVesting) public userVestings;

    enum ClaimDecision {
        TOKENS,
        USDC
    }

    struct UserVesting {
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

    // in real life: 80*1e12 = $0.0125 XCTD
    constructor(address _usdc, address _xctd, address _project, uint _periods, uint256 _usdcToXctdRate, uint256 _startTime) {
        usdc = IERC20(_usdc);
        xctd = IERC20(_xctd);
        require(_usdcToXctdRate > 10 ** (ERC20(_xctd).decimals() - ERC20(_usdc).decimals()), "minimum rate is 1 USDC:XCTD");
        require(_usdcToXctdRate < 10_000 * 1e12, "maximum rate is 10000 USDC:XCTD"); // TODO remove
        require(_startTime > block.timestamp + 7 days, "startTime must be more than 7 days from now");
        require(_periods >= 3, "periodCount must be at least 3");
        usdcToXctdRate = _usdcToXctdRate;
        project = _project;
        startTime = _startTime;
        periodCount = _periods;
    }

    function getNextVestingPeriodTimestamp() public view returns (uint256) {
        // TODO: think if we can make this more intuitive
        // Reason we're not using vestingPeriodsPassed+1 is because at startTime, vesting period 1 alread passed
        return startTime + vestingPeriodsPassed() * PERIOD_DURATION;
    }

    // TODO should we change this to a "set" functionality instead
    // if we do, naively totalXctdAllocated would be wrong and we should add a test for that
    function addAllocation(address target, uint256 _usdcAllocation) public onlyOwner {
        require(block.timestamp < startTime, "vesting already started");
        userVestings[target].usdcAllocation += _usdcAllocation;
        totalXctdAllocated += _usdcAllocation * usdcToXctdRate;

        emit AllocationAdded(target, _usdcAllocation);
    }

    function addFunds(uint256 amount) public {
        require(block.timestamp < startTime, "vesting already started");
        require((userVestings[msg.sender].usdcAllocation - userVestings[msg.sender].usdcFunded) >= amount, "amount exceeds allocation");
        require(amount > MIN_USDC_TO_FUND, "amount must be greater than 10 USDC");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        userVestings[msg.sender].usdcFunded += amount;

        emit FundsAdded(msg.sender, amount);
    }

    function claim(address target) public {
        UserVesting storage userStatus = userVestings[target];
        uint256 _vestingPeriodsPassed = vestingPeriodsPassed();
        uint256 periodsToClaim = _vestingPeriodsPassed - userStatus.lastPeriodClaimed;

        require(!emergencyRelease, "emergency released");
        require(_vestingPeriodsPassed > 0, "vesting has not started");
        require(periodsToClaim > 0, "already claimed until vesting period");
        require(userStatus.usdcFunded > 0, "no funds added");

        uint256 usdcToTransfer;
        uint256 xctdToTransfer;

        if (_vestingPeriodsPassed == periodCount) {
            usdcToTransfer = (userStatus.usdcFunded - userStatus.usdcClaimed);
            xctdToTransfer = (userStatus.usdcFunded * usdcToXctdRate - userStatus.xctdClaimed);
        } else {
            usdcToTransfer = (periodsToClaim * (userStatus.usdcFunded)) / periodCount;
            xctdToTransfer = (periodsToClaim * (userStatus.usdcFunded * usdcToXctdRate)) / periodCount;
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
        // Start time not reached - no periods have passed
        if (block.timestamp < startTime) return 0;
        // Calculate the number of full 30-day periods that have passed
        uint256 fullPeriodsPassed = (block.timestamp - startTime) / PERIOD_DURATION;
        // We add 1 because one vesting period is considered passed at the start time
        uint256 totalPeriodsPassed = fullPeriodsPassed + 1;
        // Use min to ensure that we don't return a number greater than the total number of periods
        return Math.min(totalPeriodsPassed, periodCount);
    }

    function setStartTime(uint256 newStartTime) public onlyOwner {
        require(block.timestamp < startTime, "vesting already started");
        require(newStartTime > block.timestamp, "start time has to be in the future");
        startTime = newStartTime;

        emit StartTimeSet(newStartTime);
    }

    // TODO (product decision): should this be set in constructor?
    function setProjectAddress(address _project) public onlyOwner {
        project = _project;
    }

    function toggleDecision() public {
        userVestings[msg.sender].claimDecision = userVestings[msg.sender].claimDecision == ClaimDecision.TOKENS ? ClaimDecision.USDC : ClaimDecision.TOKENS;

        emit DecisionChanged(msg.sender, userVestings[msg.sender].claimDecision);
    }

    // TODO: freeze/unfreeze by owner?

    // Used to allow users to claim back USDC if anything goes wrong
    function emergencyReleaseVesting() public onlyOwner {
        emergencyRelease = true;
        emit EmergencyRelease();
    }

    // TODO does this give too much power to the owner - being able to effectively cancel the agreement?
    function emergencyClaim(address target) public {
        UserVesting storage userStatus = userVestings[target];

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

    // TODO shouldnt be able to claim usdc
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
