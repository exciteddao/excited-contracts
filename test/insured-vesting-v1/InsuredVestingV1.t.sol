// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";
import "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {InsuredVestingV1} from "../../contracts/insured-vesting-v1/InsuredVestingV1.sol";
import {MockERC20} from "../../contracts/test/MockERC20.sol";

abstract contract GeneralHelper is Test {
    function advanceDays(uint256 _days) public {
        vm.warp(block.timestamp + _days * 1 days);
    }
}

abstract contract Helper is Test, GeneralHelper {
    address public deployer;
    address public projectWallet;
    address public user1;
    address public user2;

    uint256 public constant FUNDING_PER_USER = 10_000_000;
    uint256 public constant VESTING_DURATION_DAYS = 2 * 365;
    uint256 public constant VESTING_DURATION_SECONDS = VESTING_DURATION_DAYS * 1 days;
    uint256 public constant FUNDING_TOKEN_AMOUNT_IN = 1;
    uint256 public constant PROJECT_TOKEN_AMOUNT_OUT = 3;

    mapping(address => mapping(address => uint256)) public lastKnownBalances;

    MockERC20 public projectToken;
    MockERC20 public fundingToken;

    InsuredVestingV1 public insuredVesting;

    function setUp() public virtual {
        deployer = vm.addr(2);
        projectWallet = vm.addr(1);
        user1 = vm.addr(3);
        user2 = vm.addr(4);
        vm.label(deployer, "deployer");
        vm.label(projectWallet, "projectWallet");
        vm.label(user1, "user");

        vm.startPrank(projectWallet);
        projectToken = new MockERC20(1_000_000_000, "PROJ");
        fundingToken = new MockERC20(1_000_000_000, "FUND");
        vm.label(address(projectToken), "projectToken");
        vm.label(address(fundingToken), "fundingToken");
        fundingToken.transfer(user1, 100_000_000);
        vm.stopPrank();

        vm.prank(deployer);
        insuredVesting = new InsuredVestingV1(
            address(fundingToken),
            address(projectToken),
            VESTING_DURATION_SECONDS,
            FUNDING_TOKEN_AMOUNT_IN,
            PROJECT_TOKEN_AMOUNT_OUT,
            projectWallet
        );
    }

    function activateAndReachStartTime() public {
        activate();
        vm.warp(insuredVesting.vestingStartTime());
    }

    function activateImmediately() public {
        activate(block.timestamp);
    }

    function activate() public {
        activate(block.timestamp + 3 days);
    }

    function activate(uint256 startTime) public {
        vm.startPrank(projectWallet);
        // Approve the entire allocated amount
        projectToken.approve(address(insuredVesting), insuredVesting.fundingTokenToProjectToken(insuredVesting.fundingTokenTotalAmount()));

        insuredVesting.activate(startTime);
        vm.stopPrank();
    }

    function setAllocationAndAddFundingForUser1() public {
        setAllocationForUser1(FUNDING_PER_USER);
        addFundingFromUser1(FUNDING_PER_USER);
    }

    function setAllocationForUser1(uint256 amount) public {
        vm.prank(projectWallet);
        insuredVesting.setFundingTokenAllocation(user1, amount);
    }

    function addFundingFromUser1(uint256 amount) public {
        vm.startPrank(user1);
        fundingToken.approve(address(insuredVesting), amount);
        insuredVesting.addFunds(amount);
        vm.stopPrank();
    }

    function updateBalances() public {
        lastKnownBalances[user1][address(projectToken)] = projectToken.balanceOf(user1);
        lastKnownBalances[user1][address(fundingToken)] = fundingToken.balanceOf(user1);
        lastKnownBalances[projectWallet][address(projectToken)] = projectToken.balanceOf(projectWallet);
        lastKnownBalances[projectWallet][address(fundingToken)] = fundingToken.balanceOf(projectWallet);
    }

    function vestedAmountProjectToken(uint256 _days) public pure returns (uint256) {
        return vestedAmountProjectToken(_days, FUNDING_PER_USER);
    }

    function vestedAmountProjectToken(uint256 _days, uint256 amount) public pure returns (uint256) {
        return (vestedAmountFundingToken(_days, amount) * uint256(PROJECT_TOKEN_AMOUNT_OUT)) / uint256(FUNDING_TOKEN_AMOUNT_IN);
    }

    function vestedAmountFundingToken(uint256 _days) public pure returns (uint256) {
        return vestedAmountFundingToken(_days, FUNDING_PER_USER);
    }

    function vestedAmountFundingToken(uint256 _days, uint256 amount) public pure returns (uint256) {
        return (_days * amount) / uint256(VESTING_DURATION_DAYS);
    }

    function assertDeltaBalances(
        uint256 projectWalletProjectTokenAmount,
        uint256 projectWalletFundingTokenAmount,
        uint256 userProjectTokenAmount,
        uint256 userFundingTokenAmount
    ) public {
        uint256 MAX_DRIFT = 5;

        // PROJECT TOKEN BALANCE OF PROJECT WALLET
        assertApproxEqAbs(
            projectToken.balanceOf(projectWallet),
            lastKnownBalances[projectWallet][address(projectToken)] + projectWalletProjectTokenAmount,
            MAX_DRIFT,
            "projectToken balance of projectWallet not equal to expected amount"
        );
        // FUNDING TOKEN BALANCE OF PROJECT WALLET
        assertApproxEqAbs(
            fundingToken.balanceOf(projectWallet),
            lastKnownBalances[projectWallet][address(fundingToken)] + projectWalletFundingTokenAmount,
            MAX_DRIFT,
            "fundingToken balance of projectWallet not equal to expected amount"
        );
        // PROJECT TOKEN BALANCE OF USER
        assertApproxEqAbs(
            projectToken.balanceOf(user1),
            lastKnownBalances[user1][address(projectToken)] + userProjectTokenAmount,
            MAX_DRIFT,
            "projectToken balance of user not equal to expected amount"
        );
        // FUNDING TOKEN BALANCE OF USER
        assertApproxEqAbs(
            fundingToken.balanceOf(user1),
            lastKnownBalances[user1][address(fundingToken)] + userFundingTokenAmount,
            MAX_DRIFT,
            "fundingToken balance of user not equal to expected amount"
        );

        updateBalances();
    }

    function shouldRefund(address user) public view returns (bool) {
        (, , , bool _shouldRefund) = insuredVesting.userVestings(user);
        return _shouldRefund;
    }
}
