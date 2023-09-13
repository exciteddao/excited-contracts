// SPDX-License-Identifier: MIT
pragma solidity 0.8.19; // TODO(audit) decide on version as in VestingV1

import {Ownable as OwnerRole} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProjectRole} from "../roles/ProjectRole.sol";
import {Address, IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// This contract distributes a project's tokens to users, proportionally over a specified period of time, such that tokens are vested
// based on the amount of funding token (e.g. USDC) sent by the user, and the exchange rate as specified by PROJECT_TOKEN_TO_FUNDING_TOKEN_RATE.
// Funding tokens are fully insured, such that at any point in time, a user can set their decision to be refunded with any (unclaimed) funding tokens.

// Roles:
// - Owner: Can accelerate (emergency release) vesting in case of a critical bug; can help the project recover tokens (including overfunded project or funding tokens) and ether sent to the contract by mistake.
//          This role is revocable.
// - Project: Can set the allocation of funding token that users can send to the contract; can activate (initiate vesting); can claim on behalf of users (users still get their tokens in this case).
// - User: Can fund the contract according to their allocation; can claim their tokens once the vesting period has started; can set their decision to be refunded with funding tokens instead of project tokens.

// When project calls activate(), the contract will:
// - Transfer the necessary amount of tokens required to cover all funded tokens.
// - Set the vesting clock to start at the specified time (no more than 90 days in the future).
// - Lock allocations (project cannot add or update allocations anymore).
// - Lock funding (users cannot send more funding tokens to the contract).
contract InsuredVestingV1 is OwnerRole, ProjectRole {
    using SafeERC20 for IERC20;

    // Prevent project from locking up tokens for a long time in the future, mostly in case of human error.
    uint256 public constant MAX_START_TIME_FROM_NOW = 3 * 30 days;

    uint256 public constant MAX_VESTING_DURATION_SECONDS = 10 * 365 days;

    // Set in constructor
    IERC20 public immutable FUNDING_TOKEN;
    IERC20 public immutable PROJECT_TOKEN;
    uint256 public immutable FUNDING_TOKEN_AMOUNT_IN;
    uint256 public immutable PROJECT_TOKEN_AMOUNT_OUT;
    uint256 public immutable VESTING_DURATION_SECONDS;

    // When the contract is emergency released, users can claim all their unclaimed FUNDING_TOKEN immediately (get a refund),
    // (the project can also claim on behalf of users. Users still get their tokens in this case).
    // This ignores the user decision and treats all users as if they had decided to be refunded (cancels the rest of the deal).
    bool public isEmergencyReleased = false;

    uint256 public vestingStartTime;
    uint256 public fundingTokenTotalAmount; // total amount of funding tokens funded by users
    uint256 public fundingTokenTotalClaimed;

    // All variables are based on FUNDING_TOKEN
    // PROJECT_TOKEN calculations are done by converting from FUNDING_TOKEN, using PROJECT_TOKEN_AMOUNT_OUT/FUNDING_TOKEN_AMOUNT_IN
    struct UserVesting {
        // Upper bound of FUNDING_TOKEN that user is allowed to send to the contract (set by project)
        uint256 fundingTokenAllocation;
        // total FUNDING_TOKEN amount transferred to contract by user
        uint256 fundingTokenAmount;
        // Amount of FUNDING_TOKEN claimed by user
        uint256 fundingTokenClaimed;
        // true - upon claiming, user will get FUNDING_TOKEN back, false - user will get PROJECT_TOKEN
        bool shouldRefund;
    }

    mapping(address => UserVesting) public userVestings;

    // --- Events ---
    event AllocationSet(address indexed user, uint256 fundingTokenAmount, uint256 fundingTokenPreviousAmount, uint256 fundingTokenRefundedAmount);
    event FundsAdded(address indexed user, uint256 fundingTokenAmount);
    event Activated();

    event TokensClaimed(address indexed user, uint256 fundingTokenAmount, uint256 projectTokenAmount, bool indexed isInitiatedByProject);
    event RefundClaimed(address indexed user, uint256 fundingTokenAmount, uint256 projectTokenAmount, bool indexed isInitiatedByProject);

    event DecisionSet(address indexed user, bool indexed shouldRefund);
    event EmergencyReleased();
    event EmergencyRefunded(address indexed user, bool indexed isInitiatedByProject, uint256 fundingTokenAmount);
    event TokenRecovered(address indexed token, uint256 amount);
    event EtherRecovered(uint256 amount);

    // --- Errors ---
    error VestingDurationTooLong(uint256 vestingPeriodSeconds);
    error StartTimeTooDistant(uint256 vestingStartTime, uint256 maxStartTime);
    error StartTimeInPast(uint256 vestingStartTime);
    error OnlyProjectOrSender();
    error AllocationExceeded(uint256 fundingTokenRemainingAllocation);
    error NoFundsAdded();
    error VestingNotStarted();
    error AlreadyActivated();
    error NothingToClaim();
    error EmergencyReleaseActive();
    error NotEmergencyReleased();

    // --- Modifiers ---
    modifier onlyBeforeActivation() {
        if (isActivated()) revert AlreadyActivated();
        _;
    }

    modifier onlyProjectOrSender(address user) {
        if (!(msg.sender == projectWallet || msg.sender == user)) revert OnlyProjectOrSender();
        _;
    }

    modifier onlyIfNotEmergencyReleased() {
        if (isEmergencyReleased) revert EmergencyReleaseActive();
        _;
    }

    constructor(
        address _fundingToken,
        address _projectToken,
        uint256 _vestingDurationSeconds,
        uint256 _fundingTokenAmountIn,
        uint256 _projectTokenAmountOut,
        address _projectWallet
    ) ProjectRole(_projectWallet) {
        if (_vestingDurationSeconds > MAX_VESTING_DURATION_SECONDS) revert VestingDurationTooLong(_vestingDurationSeconds);

        FUNDING_TOKEN = IERC20(_fundingToken);
        PROJECT_TOKEN = IERC20(_projectToken);
        FUNDING_TOKEN_AMOUNT_IN = _fundingTokenAmountIn;
        PROJECT_TOKEN_AMOUNT_OUT = _projectTokenAmountOut;
        VESTING_DURATION_SECONDS = _vestingDurationSeconds;
    }

    // --- User only functions ---
    function addFunds(uint256 amount) external onlyBeforeActivation onlyIfNotEmergencyReleased {
        UserVesting storage userVesting = userVestings[msg.sender];
        uint256 remainingAllocation = userVesting.fundingTokenAllocation - userVesting.fundingTokenAmount;
        if (amount > remainingAllocation) revert AllocationExceeded(remainingAllocation);

        userVesting.fundingTokenAmount += amount;
        fundingTokenTotalAmount += amount;
        FUNDING_TOKEN.safeTransferFrom(msg.sender, address(this), amount);

        emit FundsAdded(msg.sender, amount);
    }

    // TODO(audit) block if emergency (reason why - it may contradict the global refund decision that's been taken by emergency release)
    function claim(address user) external onlyProjectOrSender(user) {
        if (!isVestingStarted()) revert VestingNotStarted();

        UserVesting storage userVesting = userVestings[user];
        if (userVesting.fundingTokenAmount == 0) revert NoFundsAdded();

        uint256 fundingTokenClaimable = fundingTokenClaimableFor(user);
        if (fundingTokenClaimable == 0) revert NothingToClaim();

        userVesting.fundingTokenClaimed += fundingTokenClaimable;
        fundingTokenTotalClaimed += fundingTokenClaimable;

        uint256 projectTokenClaimable = fundingTokenToProjectToken(fundingTokenClaimable);

        if (!userVesting.shouldRefund) {
            PROJECT_TOKEN.safeTransfer(user, projectTokenClaimable);
            FUNDING_TOKEN.safeTransfer(projectWallet, fundingTokenClaimable);

            emit TokensClaimed(user, fundingTokenClaimable, projectTokenClaimable, msg.sender == projectWallet);
        } else {
            PROJECT_TOKEN.safeTransfer(projectWallet, projectTokenClaimable);
            FUNDING_TOKEN.safeTransfer(user, fundingTokenClaimable);

            emit RefundClaimed(user, fundingTokenClaimable, projectTokenClaimable, msg.sender == projectWallet);
        }
    }

    // TODO(audit) - block if emergency released
    function setDecision(bool _shouldRefund) external {
        UserVesting storage userVesting = userVestings[msg.sender];
        if (userVesting.fundingTokenAmount == 0) revert NoFundsAdded();
        if (userVesting.shouldRefund == _shouldRefund) return;
        userVesting.shouldRefund = _shouldRefund;

        emit DecisionSet(msg.sender, _shouldRefund);
    }

    // --- Project only functions ---
    function setFundingTokenAllocation(address user, uint256 newAllocation) external onlyProject onlyBeforeActivation onlyIfNotEmergencyReleased {
        UserVesting storage userVesting = userVestings[user];
        uint256 fundingTokenPreviousAllocation = userVesting.fundingTokenAllocation;
        userVesting.fundingTokenAllocation = newAllocation;

        uint256 amountToRefund = 0;

        // Refund user if they have funded more than the new allocation
        if (userVesting.fundingTokenAmount > newAllocation) {
            // Note: it is required that userVesting.fundingTokenClaimed is 0. This is guaranteed by requiring both onlyBeforeActivation && onlyIfNotEmergencyReleased
            amountToRefund = userVesting.fundingTokenAmount - newAllocation;
            userVesting.fundingTokenAmount -= amountToRefund;
            fundingTokenTotalAmount -= amountToRefund;
            FUNDING_TOKEN.safeTransfer(user, amountToRefund);
        }

        emit AllocationSet(user, newAllocation, fundingTokenPreviousAllocation, amountToRefund);
    }

    // TODO(audit) - block if emergency released
    function activate(uint256 _vestingStartTime) external onlyProject onlyBeforeActivation {
        if (_vestingStartTime > (block.timestamp + MAX_START_TIME_FROM_NOW))
            revert StartTimeTooDistant(_vestingStartTime, block.timestamp + MAX_START_TIME_FROM_NOW);

        if (_vestingStartTime < block.timestamp) revert StartTimeInPast(_vestingStartTime);

        if (fundingTokenTotalAmount == 0) revert NoFundsAdded();

        vestingStartTime = _vestingStartTime;

        PROJECT_TOKEN.safeTransferFrom(projectWallet, address(this), fundingTokenToProjectToken(fundingTokenTotalAmount));

        emit Activated();
    }

    // --- Emergency functions ---
    // It is possible to emergency release prior to activation, because users
    // may have already funded the contract
    function emergencyRelease() external onlyOwner onlyIfNotEmergencyReleased {
        isEmergencyReleased = true;
        emit EmergencyReleased();
    }

    function emergencyRefund(address user) external onlyProjectOrSender(user) {
        if (!isEmergencyReleased) revert NotEmergencyReleased();

        UserVesting storage userVesting = userVestings[user];
        if (userVesting.fundingTokenAmount == 0) revert NoFundsAdded();

        uint256 claimable = userVesting.fundingTokenAmount - userVesting.fundingTokenClaimed;

        // TODO(audit) - add: if (claimable == 0) revert NothingToClaim();

        userVesting.fundingTokenClaimed += claimable;
        fundingTokenTotalClaimed += claimable;
        FUNDING_TOKEN.safeTransfer(user, claimable);

        // PROJECT_TOKEN is not refunded to the project here, to reduce revert risk surface
        // The project can recover the tokens by calling recoverToken(), which takes
        // being emergency released into account.

        emit EmergencyRefunded(user, msg.sender == projectWallet, claimable);
    }

    function recoverToken(address tokenAddress) external onlyOwner {
        uint256 tokenBalanceToRecover = IERC20(tokenAddress).balanceOf(address(this));

        // in case of PROJECT_TOKEN, we also need to retain the total locked amount in the contract
        if (tokenAddress == address(PROJECT_TOKEN) && !isEmergencyReleased) {
            uint256 totalOwed = fundingTokenToProjectToken(fundingTokenTotalAmount - fundingTokenTotalClaimed);
            if (totalOwed >= tokenBalanceToRecover) revert NothingToClaim();
            tokenBalanceToRecover -= totalOwed;
        }

        if (tokenAddress == address(FUNDING_TOKEN)) {
            uint256 totalOwed = fundingTokenTotalAmount - fundingTokenTotalClaimed;
            if (totalOwed >= tokenBalanceToRecover) revert NothingToClaim();
            tokenBalanceToRecover -= totalOwed;
        }

        IERC20(tokenAddress).safeTransfer(projectWallet, tokenBalanceToRecover);

        emit TokenRecovered(tokenAddress, tokenBalanceToRecover);
    }

    // Recovers the native token of the chain
    function recoverEther() external onlyOwner {
        uint256 etherToRecover = address(this).balance;
        Address.sendValue(payable(projectWallet), etherToRecover);

        emit EtherRecovered(etherToRecover);
    }

    // --- View functions ---
    function isActivated() public view returns (bool) {
        return vestingStartTime != 0;
    }

    function isVestingStarted() public view returns (bool) {
        return isActivated() && vestingStartTime <= block.timestamp;
    }

    // FUNDING_TOKEN_AMOUNT_IN and PROJECT_TOKEN_AMOUNT_OUT are to resemble DEX-style exchange rates and can hold any arbitrary amount
    // Meaning that for the given FUNDING_TOKEN_AMOUNT_IN, you would get PROJECT_TOKEN_AMOUNT_OUT
    // e.g. FUNDING_TOKEN_AMOUNT_IN (6 decimals) = 0.2*1e6 = 200_000
    //      PROJECT_TOKEN_AMOUNT_OUT (18 decimals) = 1e18
    //      which means, for every 0.2 of funding token, you get 1 of project token
    function fundingTokenToProjectToken(uint256 fundingTokenAmount) public view returns (uint256) {
        return (fundingTokenAmount * PROJECT_TOKEN_AMOUNT_OUT) / FUNDING_TOKEN_AMOUNT_IN;
    }

    function fundingTokenVestedFor(address user) public view returns (uint256) {
        if (!isVestingStarted()) return 0;
        UserVesting memory userVesting = userVestings[user];
        return Math.min(((block.timestamp - vestingStartTime) * userVesting.fundingTokenAmount) / VESTING_DURATION_SECONDS, userVesting.fundingTokenAmount);
    }

    function fundingTokenClaimableFor(address user) public view returns (uint256) {
        return fundingTokenVestedFor(user) - userVestings[user].fundingTokenClaimed;
    }

    function projectTokenVestedFor(address user) external view returns (uint256) {
        return fundingTokenToProjectToken(fundingTokenVestedFor(user));
    }

    function projectTokenClaimableFor(address user) external view returns (uint256) {
        return fundingTokenToProjectToken(fundingTokenClaimableFor(user));
    }
}
