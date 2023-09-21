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
}
