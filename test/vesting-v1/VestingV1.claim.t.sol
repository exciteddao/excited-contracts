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
}
