// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";
import "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {InsuredVestingV1} from "../../contracts/insured-vesting-v1/InsuredVestingV1.sol";
import {MockERC20} from "../../contracts/test/MockERC20.sol";

abstract contract Helper is Test {
    address public deployer;
    address public projectWallet;
    address public user;

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
        user = vm.addr(3);
        vm.label(deployer, "deployer");
        vm.label(projectWallet, "projectWallet");
        vm.label(user, "user");

        vm.startPrank(projectWallet);
        projectToken = new MockERC20(1_000_000_000, "PROJ");
        fundingToken = new MockERC20(1_000_000_000, "FUND");
        vm.label(address(projectToken), "projectToken");
        vm.label(address(fundingToken), "fundingToken");
        fundingToken.transfer(user, 100_000_000);

        insuredVesting = new InsuredVestingV1(
            address(fundingToken),
            address(projectToken),
            VESTING_DURATION_SECONDS,
            FUNDING_TOKEN_AMOUNT_IN,
            PROJECT_TOKEN_AMOUNT_OUT,
            projectWallet
        );
        vm.stopPrank();
    }

    function activateAndReachStartTime() public {
        vm.startPrank(projectWallet);
        // Approve the entire allocated amount
        projectToken.approve(address(insuredVesting), insuredVesting.fundingTokenToProjectToken(insuredVesting.fundingTokenTotalAmount()));

        uint256 startTime = block.timestamp + 3 days;
        insuredVesting.activate(startTime);
        vm.warp(startTime);
        vm.stopPrank();
    }

    function setAllocationAndAddFundingForUser1() public {
        vm.prank(projectWallet);

        insuredVesting.setFundingTokenAllocation(user, FUNDING_PER_USER);
        vm.startPrank(user);
        fundingToken.approve(address(insuredVesting), FUNDING_PER_USER);
        insuredVesting.addFunds(FUNDING_PER_USER);
        vm.stopPrank();
    }

    function advanceDays(uint256 _days) public {
        vm.warp(block.timestamp + _days * 1 days);
    }

    function updateBalances() public {
        lastKnownBalances[user][address(projectToken)] = projectToken.balanceOf(user);
        lastKnownBalances[user][address(fundingToken)] = fundingToken.balanceOf(user);
        lastKnownBalances[projectWallet][address(projectToken)] = projectToken.balanceOf(projectWallet);
        lastKnownBalances[projectWallet][address(fundingToken)] = fundingToken.balanceOf(projectWallet);
    }

    function vestedAmountProjectToken(uint256 _days) public pure returns (uint256) {
        return (vestedAmountFundingToken(_days) * uint256(PROJECT_TOKEN_AMOUNT_OUT)) / uint256(FUNDING_TOKEN_AMOUNT_IN);
    }

    function vestedAmountFundingToken(uint256 _days) public pure returns (uint256) {
        return (_days * FUNDING_PER_USER) / uint256(VESTING_DURATION_DAYS);
    }

    function assertDeltaProjectTokenForUser(uint256 amount) public {
        assertEq(projectToken.balanceOf(user), lastKnownBalances[user][address(projectToken)] + amount);
    }

    /*
    assertDeltaBalances(projProjToken, projFundingToken, userProjToken, userFundingToken)

    --
    assertDeltaUserBalances(projectToken, fundingToken)
    assertDeltaProjectBalances(projectToken, fundingToken)
    */

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
            projectToken.balanceOf(user),
            lastKnownBalances[user][address(projectToken)] + userProjectTokenAmount,
            MAX_DRIFT,
            "projectToken balance of user not equal to expected amount"
        );
        // FUNDING TOKEN BALANCE OF USER
        assertApproxEqAbs(
            fundingToken.balanceOf(user),
            lastKnownBalances[user][address(fundingToken)] + userFundingTokenAmount,
            MAX_DRIFT,
            "fundingToken balance of user not equal to expected amount"
        );

        updateBalances();
    }
}

contract InsuredVestingV1Test is Test, Helper {
    function setUp() public override {
        console.log("setUp from func");
        Helper.setUp();
    }

    /// Can claim multiple times, switching decision, over entire vesting period
    function test_claimTokensChangeDecision() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        updateBalances();

        assertEq(projectToken.balanceOf(user), 0);
        assertEq(insuredVesting.projectTokenClaimableFor(user), 0);

        advanceDays(11 * 30);
        vm.startPrank(user);
        insuredVesting.claim(user);
        assertDeltaBalances(0, vestedAmountFundingToken(11 * 30), vestedAmountProjectToken(11 * 30), 0);

        // Set decision, let 3 months pass and claim FUNDING_TOKEN (we're at month 14)
        advanceDays(3 * 30);
        insuredVesting.setDecision(true);
        insuredVesting.claim(user);
        assertDeltaBalances(vestedAmountProjectToken(3 * 30), 0, 0, vestedAmountFundingToken(3 * 30));

        // Revert decision, let 3 months pass and claim FUNDING_TOKEN (we're at month 17)
        advanceDays(3 * 30);
        insuredVesting.setDecision(false);
        insuredVesting.claim(user);
        assertDeltaBalances(0, vestedAmountFundingToken(3 * 30), vestedAmountProjectToken(3 * 30), 0);

        // Set decision again, let remaining time pass
        advanceDays(220);
        insuredVesting.setDecision(true);
        insuredVesting.claim(user);
        assertDeltaBalances(vestedAmountProjectToken(220), 0, 0, vestedAmountFundingToken(220));
    }
}
