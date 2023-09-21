// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";
import "forge-std/console.sol";

import {Helper} from "./Helper.sol";

contract Claim is Test, Helper {
    /// @notice Test that a user can claim tokens proportional to amount of seconds passed
    function testFuzz_canClaimTokens(uint256 _days) public {
        // If claimable amount is 0, then the claim function will revert
        vm.assume(_days > 0);
        vm.assume(_days < 1e6);
        console.log("%s days passed", _days);
        setAmountForUser1();
        approveProjectTokenToVesting();
        activateAndReachStartTime();
        advanceDays(_days);
        vm.prank(user1);
        vesting.claim(address(user1));
        assertUserDeltaBalance(vestedAmount(_days));
    }

    /// @notice Test that tokens do not vest before the start time is reached
    function test_doesNotVestBeforeStartTime() public {
        setAmountForUser1();
        approveProjectTokenToVesting();
        vm.prank(projectWallet);
        vesting.activate(block.timestamp + 3 days);
        advanceDays(1);
        assertEq(vesting.totalVestedFor(address(user1)), 0);
        advanceDays(2);
        assertEq(vesting.totalVestedFor(address(user1)), 0);
        advanceDays(1);
        assertApproxEqAbs(vesting.totalVestedFor(address(user1)), (1 days * TOKENS_PER_USER) / VESTING_DURATION_SECONDS, 5);
    }

    /// @notice Test that vesting begins immediately if activated with current timestamp
    function test_startsVestingWhenActivatedWithCurrentTimestamp() public {
        setAmountForUser1();
        approveProjectTokenToVesting();
        vm.prank(projectWallet);
        vesting.activate(block.timestamp + 1);
        advanceDays(1);
        vm.prank(user1);
        vesting.claim(address(user1));
        assertUserDeltaBalance(vestedAmount(1));
    }

    /// @notice Test that a `Claimed` event is emitted when a user claims tokens
    function test_successfulClaimEmitsEvent() public {
        setAmountForUser1();
        approveProjectTokenToVesting();
        vm.prank(projectWallet);
        vesting.activate(block.timestamp + 1);
        advanceDays(1);

        vm.expectEmit(true, true, false, true);
        emit Claimed(address(user1), vestedAmount(1), false);

        vm.prank(user1);
        vesting.claim(address(user1));
    }

    /// @notice Test a user cannot double claim for same period of time
    function test_cannotDoubleClaim(uint8 _days) public {
        vm.assume(_days > 0);
        vm.assume(_days < 1000);
        setAmountForUser1();
        approveProjectTokenToVesting();
        vm.prank(projectWallet);
        vesting.activate(block.timestamp + 1);
        advanceDays(_days);
        vm.startPrank(user1);
        vesting.claim(address(user1));
        assertUserDeltaBalance(vestedAmount(_days));
        console.log("Expecting claim to revert with `NothingToClaim`");
        vm.expectRevert(abi.encodeWithSelector(NothingToClaim.selector));
        vesting.claim(address(user1));
    }

    /// @notice Test that a user cannot claim tokens before starting period even when activated
    function test_activatedCannotClaimBeforeStartingPeriod() public {
        setAmountForUser1();
        approveProjectTokenToVesting();
        vm.prank(projectWallet);
        vesting.activate(block.timestamp + 3 days);
        advanceDays(1);
        vm.startPrank(projectWallet);
        vm.expectRevert(abi.encodeWithSelector(VestingNotStarted.selector));
        vesting.claim(address(user1));
        assertEq(vesting.totalVestedFor(address(user1)), 0, "User should not have vested tokens");
    }

    /// @notice Test that a user cannot claim tokens before starting period when not activated
    function test_notActivatedCannotClaimBeforeStartingPeriod() public {
        setAmountForUser1();
        vm.startPrank(projectWallet);
        vm.expectRevert(abi.encodeWithSelector(VestingNotStarted.selector));
        vesting.claim(address(user1));
        assertEq(vesting.totalVestedFor(address(user1)), 0, "User should not have vested tokens");
    }

    /// @notice Test that ineligible users (ie. not been whitelisted via `setAmount`) cannot claim tokens
    function test_cannotClaimIfNotEligible() public {
        setAmountForUser2();
        approveProjectTokenToVesting();
        activateAndReachStartTime();
        advanceDays(85);
        vm.expectRevert(abi.encodeWithSelector(NothingToClaim.selector));
        vm.prank(user1);
        vesting.claim(address(user1));
        assertEq(vesting.totalVestedFor(address(user1)), 0, "User should not have vested tokens as not entitled");
    }

    /// @notice Test that the project can claim tokens on behalf of a user (tokens still go to user)
    function test_projectCanClaimOnBehalfOfUser() public {
        setAmountForUser1();
        approveProjectTokenToVesting();
        activateAndReachStartTime();
        advanceDays(399);
        vm.prank(projectWallet);
        vesting.claim(address(user1));
        assertUserDeltaBalance(vestedAmount(399));
    }

    /// @notice Test that only user or project can claim
    function test_onlyUserOrProjectCanClaim() public {
        setAmountForUser1();
        approveProjectTokenToVesting();
        activateAndReachStartTime();
        advanceDays(712);
        vm.startPrank(user2);
        vm.expectRevert(abi.encodeWithSelector(OnlyProjectOrSender.selector));
        vesting.claim(address(user1));
        assertUserDeltaBalance(0);
    }

    /// @notice Test multiple users can each claim their vested tokens
    function test_multipleUsersCanClaimTheirTokens() public {
        setAmountForUser1();
        setAmountForUser2();
        approveProjectTokenToVesting();
        activateAndReachStartTime();
        advanceDays(VESTING_DURATION_DAYS);
        vm.prank(user1);
        vesting.claim(address(user1));
        assertEq(projectToken.balanceOf(address(user1)), TOKENS_PER_USER);
        vm.prank(user2);
        vesting.claim(address(user2));
        assertEq(projectToken.balanceOf(address(user2)), TOKENS_PER_USER);
    }

    /// @notice Extra project token balance does not affect claimable amount
    function test_extraProjectTokenBalanceDoesNotAffectClaimableAmount() public {
        setAmountForUser1();
        approveProjectTokenToVesting();
        activateAndReachStartTime();
        advanceDays(VESTING_DURATION_DAYS);
        vm.prank(projectWallet);
        projectToken.transfer(address(vesting), 500_000);
        vm.prank(user1);
        vesting.claim(address(user1));
        assertEq(projectToken.balanceOf(address(user1)), TOKENS_PER_USER);
    }
}

contract ClaimForEntirePeriod is Test, Helper {
    /// @notice Test that a user can claim tokens for the entire period
    function test_claimForEntirePeriod() public {
        setAmountForUser1();
        approveProjectTokenToVesting();
        activateAndReachStartTime();
        advanceDays(VESTING_DURATION_DAYS);
        vm.prank(user1);
        vesting.claim(address(user1));
        assertEq(projectToken.balanceOf(address(user1)), TOKENS_PER_USER);
    }

    // @notice Test that a user can claim tokens for the entire period, even if the amount is increased before vesting
    function test_claimForEntirePeriodIncreaseAmount() public {
        setAmountForUser1();
        approveProjectTokenToVesting();
        vm.prank(projectWallet);
        vesting.setAmount(user1, TOKENS_PER_USER * 3);
        activateAndReachStartTime();
        advanceDays(VESTING_DURATION_DAYS);
        vm.prank(user1);
        vesting.claim(address(user1));
        assertEq(projectToken.balanceOf(address(user1)), TOKENS_PER_USER * 3);
    }

    /// @notice Test that a user can claim tokens for the entire period, even if the amount is decreased before vesting
    function test_claimForEntirePeriodDecreaseAmount() public {
        setAmountForUser1();
        approveProjectTokenToVesting();
        vm.prank(projectWallet);
        vesting.setAmount(user1, TOKENS_PER_USER / 4);
        activateAndReachStartTime();
        advanceDays(VESTING_DURATION_DAYS);
        vm.prank(user1);
        vesting.claim(address(user1));
        assertEq(projectToken.balanceOf(address(user1)), TOKENS_PER_USER / 4);
    }

    /// @notice Test that a user can claim tokens for the entire period, even when the tokens have long since fully vested
    function test_claimForEntirePeriodAfterFullyVested() public {
        setAmountForUser1();
        approveProjectTokenToVesting();
        activateAndReachStartTime();
        advanceDays(VESTING_DURATION_DAYS * 2);
        vm.prank(user1);
        vesting.claim(address(user1));
        assertEq(projectToken.balanceOf(address(user1)), TOKENS_PER_USER);
    }
}
