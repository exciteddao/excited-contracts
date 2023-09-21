// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";
import "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {InsuredVestingV1} from "../../contracts/insured-vesting-v1/InsuredVestingV1.sol";
import {MockERC20} from "../../contracts/test/MockERC20.sol";
import {Helper} from "./InsuredVestingV1.t.sol";

contract InsuredVestingV1Test_Claim is Test, Helper {
    function test_setDecisionClaimFundingToken_afterVesting() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        updateBalances();
        advanceDays(30);
        vm.startPrank(user1);
        insuredVesting.setDecision(true);
        insuredVesting.claim(user1);
        vm.stopPrank();
        assertDeltaBalances(vestedAmountProjectToken(30), 0, 0, vestedAmountFundingToken(30));
    }

    function test_setDecisionClaimFundingToken_beforeVesting() public {
        setAllocationAndAddFundingForUser1();
        vm.prank(user1);
        insuredVesting.setDecision(true);
        activateAndReachStartTime();
        updateBalances();
        advanceDays(30);
        vm.prank(user1);
        insuredVesting.claim(user1);
        assertDeltaBalances(vestedAmountProjectToken(30), 0, 0, vestedAmountFundingToken(30));
    }

    function test_cannotSetDecisionIfNotFunded() public {
        setAllocationForUser1(1000);
        vm.prank(user1);
        vm.expectRevert(InsuredVestingV1.NoFundsAdded.selector);
        insuredVesting.setDecision(true);
    }

    function test_setDecisionIdempotency() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        updateBalances();
        advanceDays(30);
        vm.startPrank(user1);
        assertEq(shouldRefund(user1), false);
        insuredVesting.setDecision(true);
        assertEq(shouldRefund(user1), true);
        insuredVesting.setDecision(true);
        assertEq(shouldRefund(user1), true);

        insuredVesting.setDecision(false);
        assertEq(shouldRefund(user1), false);
        insuredVesting.setDecision(false);
        assertEq(shouldRefund(user1), false);

        vm.stopPrank();
    }

    function test_cannotSetDecisionIfEmergencyReleased() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        vm.prank(deployer);
        insuredVesting.emergencyRelease();
        vm.prank(user1);
        vm.expectRevert(InsuredVestingV1.EmergencyReleaseActive.selector);
        insuredVesting.setDecision(true);
    }

    /// Can claim multiple times, switching decision, over entire vesting period
    function test_claimTokensChangeDecision() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        updateBalances();

        assertEq(projectToken.balanceOf(user1), 0);
        assertEq(insuredVesting.projectTokenClaimableFor(user1), 0);

        advanceDays(11 * 30);
        vm.startPrank(user1);
        insuredVesting.claim(user1);
        assertDeltaBalances(0, vestedAmountFundingToken(11 * 30), vestedAmountProjectToken(11 * 30), 0);

        // Set decision, let 3 months pass and claim FUNDING_TOKEN (we're at month 14)
        advanceDays(3 * 30);
        insuredVesting.setDecision(true);
        insuredVesting.claim(user1);
        assertDeltaBalances(vestedAmountProjectToken(3 * 30), 0, 0, vestedAmountFundingToken(3 * 30));

        // Revert decision, let 3 months pass and claim FUNDING_TOKEN (we're at month 17)
        advanceDays(3 * 30);
        insuredVesting.setDecision(false);
        insuredVesting.claim(user1);
        assertDeltaBalances(0, vestedAmountFundingToken(3 * 30), vestedAmountProjectToken(3 * 30), 0);

        // Set decision again, let remaining time pass
        advanceDays(220);
        insuredVesting.setDecision(true);
        insuredVesting.claim(user1);
        assertDeltaBalances(vestedAmountProjectToken(220), 0, 0, vestedAmountFundingToken(220));
    }
}
