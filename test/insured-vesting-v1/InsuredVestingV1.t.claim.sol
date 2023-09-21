// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";
import "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {InsuredVestingV1} from "../../contracts/insured-vesting-v1/InsuredVestingV1.sol";
import {MockERC20} from "../../contracts/test/MockERC20.sol";
import {Helper} from "./InsuredVestingV1.t.sol";

contract InsuredVestingV1Test_Claim is Test, Helper {
    event TokensClaimed(address indexed user, uint256 fundingTokenAmount, uint256 projectTokenAmount, bool indexed isInitiatedByProject);
    event RefundClaimed(address indexed user, uint256 fundingTokenAmount, uint256 projectTokenAmount, bool indexed isInitiatedByProject);

    function test_cannotClaimIfEmergencyReleased() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        vm.prank(deployer);
        insuredVesting.emergencyRelease();
        vm.prank(user1);
        vm.expectRevert(InsuredVestingV1.EmergencyReleaseActive.selector);
        insuredVesting.claim(user1);
    }

    function test_emitEvents() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();

        advanceDays(10);
        vm.expectEmit(true, true, true, false);
        emit TokensClaimed(user1, vestedAmountFundingToken(10), vestedAmountProjectToken(10), false);
        vm.prank(user1);
        insuredVesting.claim(user1);

        advanceDays(10);
        vm.expectEmit(true, true, true, false);
        emit TokensClaimed(user1, vestedAmountFundingToken(10), vestedAmountProjectToken(10), true);
        vm.prank(projectWallet);
        insuredVesting.claim(user1);

        vm.prank(user1);
        insuredVesting.setDecision(true);

        advanceDays(10);
        vm.expectEmit(true, true, true, false);
        emit RefundClaimed(user1, vestedAmountFundingToken(10), vestedAmountProjectToken(10), false);
        vm.prank(user1);
        insuredVesting.claim(user1);

        advanceDays(10);
        vm.expectEmit(true, true, true, false);
        emit RefundClaimed(user1, vestedAmountFundingToken(10), vestedAmountProjectToken(10), true);
        vm.prank(projectWallet);
        insuredVesting.claim(user1);
    }

    function testFuzz_updatedAllocations(uint32 newAllocation) public {
        vm.assume(newAllocation > 1000 && newAllocation < FUNDING_PER_USER);
        setAllocationAndAddFundingForUser1();
        setAllocationForUser1(newAllocation);
        activateAndReachStartTime();
        advanceDays(30);
        updateBalances();
        vm.prank(user1);
        insuredVesting.claim(user1);
        assertDeltaBalances(0, vestedAmountFundingToken(30, newAllocation), vestedAmountProjectToken(30, newAllocation), 0);
    }

    function test_cannotClaimIfNotProjectOrUser() public {
        address[] memory invalidUsers = new address[](3);
        invalidUsers[0] = address(0);
        invalidUsers[1] = deployer;
        invalidUsers[2] = user2;

        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();

        for (uint256 i = 0; i < invalidUsers.length; i++) {
            vm.prank(invalidUsers[i]);
            vm.expectRevert(InsuredVestingV1.OnlyProjectOrSender.selector);
            insuredVesting.claim(user1);
        }
    }

    function test_projectClaimsOnBehalf() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        advanceDays(30);
        updateBalances();
        vm.prank(projectWallet);
        insuredVesting.claim(user1);
        assertDeltaBalances(0, vestedAmountFundingToken(30), vestedAmountProjectToken(30), 0);
    }

    function test_moreThanEntireDuration() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        advanceDays(VESTING_DURATION_DAYS * 2);
        updateBalances();
        vm.prank(user1);
        insuredVesting.claim(user1);
        assertDeltaBalances(0, vestedAmountFundingToken(VESTING_DURATION_DAYS), vestedAmountProjectToken(VESTING_DURATION_DAYS), 0);
    }

    function test_entireDuration() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        advanceDays(VESTING_DURATION_DAYS);
        updateBalances();
        vm.prank(user1);
        insuredVesting.claim(user1);
        assertDeltaBalances(0, vestedAmountFundingToken(VESTING_DURATION_DAYS), vestedAmountProjectToken(VESTING_DURATION_DAYS), 0);
    }

    function test_nothingToClaimIfNotFunded() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        advanceDays(30);
        vm.prank(user2);
        vm.expectRevert(InsuredVestingV1.NoFundsAdded.selector);
        insuredVesting.claim(user2);
    }

    function testFuzz_nothingToClaimBeforeActivation(uint32 daysPassed) public {
        setAllocationAndAddFundingForUser1();
        console.log("daysPassed", daysPassed);
        advanceDays(daysPassed);
        vm.prank(user1);
        vm.expectRevert(InsuredVestingV1.VestingNotStarted.selector);
        insuredVesting.claim(user1);
    }

    /// Tokens do not vest before start time
    function test_nothingToClaimBeforeStartTime() public {
        setAllocationAndAddFundingForUser1();
        activate();
        advanceDays(1);
        assertEq(insuredVesting.fundingTokenVestedFor(user1), 0);
        vm.prank(user1);
        vm.expectRevert(InsuredVestingV1.VestingNotStarted.selector);
        insuredVesting.claim(user1);
        advanceDays(3);
        assertEq(insuredVesting.fundingTokenVestedFor(user1), vestedAmountFundingToken(1));
    }

    function test_cannotDoubleClaim() public {
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        updateBalances();
        advanceDays(45);
        vm.prank(user1);
        insuredVesting.claim(user1);
        assertDeltaBalances(0, vestedAmountFundingToken(45), vestedAmountProjectToken(45), 0);
        vm.prank(user1);
        vm.expectRevert(InsuredVestingV1.NothingToClaim.selector);
        insuredVesting.claim(user1);
    }

    function test_partialAllocation() public {
        setAllocationForUser1(FUNDING_PER_USER);
        addFundingFromUser1(FUNDING_PER_USER / 3);
        activateAndReachStartTime();
        advanceDays(20);
        updateBalances();
        vm.prank(user1);
        insuredVesting.claim(user1);
        assertDeltaBalances(0, vestedAmountFundingToken(20) / 3, vestedAmountProjectToken(20) / 3, 0);
    }

    function testFuzz_multipleUsers(uint256 percentage) public {
        vm.assume(percentage > 0 && percentage <= 100);

        uint256 amount = (FUNDING_PER_USER * percentage) / 100;
        for (uint256 i = 10; i < 20; i++) {
            address _user = vm.addr(i);
            vm.startPrank(projectWallet);
            insuredVesting.setFundingTokenAllocation(_user, amount);
            fundingToken.transfer(_user, amount);
            vm.stopPrank();

            vm.startPrank(_user);
            fundingToken.approve(address(insuredVesting), amount);
            insuredVesting.addFunds(amount);
            vm.stopPrank();
        }
        activateAndReachStartTime();
        advanceDays(30);

        for (uint256 i = 10; i < 20; i++) {
            address _user = vm.addr(i);
            vm.prank(_user);
            insuredVesting.claim(_user);
            assertEq(insuredVesting.fundingTokenVestedFor(_user), vestedAmountFundingToken(30, amount));
        }
    }

    function test_multipleFundings() public {
        vm.prank(projectWallet);
        insuredVesting.setFundingTokenAllocation(user1, FUNDING_PER_USER);
        vm.startPrank(user1);
        fundingToken.approve(address(insuredVesting), FUNDING_PER_USER);
        insuredVesting.addFunds(FUNDING_PER_USER / 4);
        advanceDays(30);
        insuredVesting.addFunds(FUNDING_PER_USER / 4);
        advanceDays(30);
        insuredVesting.addFunds(FUNDING_PER_USER / 4);
        advanceDays(30);
        insuredVesting.addFunds(FUNDING_PER_USER / 4);
        advanceDays(30);
        vm.stopPrank();
        activateAndReachStartTime();
        advanceDays(6);
        updateBalances();
        vm.prank(user1);
        insuredVesting.claim(user1);
        assertDeltaBalances(0, vestedAmountFundingToken(6), vestedAmountProjectToken(6), 0);
    }

    function test_immediateStartTime() public {
        setAllocationAndAddFundingForUser1();
        activateImmediately();
        updateBalances();
        advanceDays(1);
        vm.prank(user1);
        insuredVesting.claim(user1);
        assertDeltaBalances(0, vestedAmountFundingToken(1), vestedAmountProjectToken(1), 0);
    }

    /// Claim tokens proportionally to time passed
    function testFuzz_claim(uint256 _days) public {
        vm.assume(_days > 0 && _days <= VESTING_DURATION_DAYS);
        console.log(_days);
        setAllocationAndAddFundingForUser1();
        activateAndReachStartTime();
        advanceDays(_days);
        updateBalances();
        vm.prank(user1);
        insuredVesting.claim(user1);
        assertDeltaBalances(0, vestedAmountFundingToken(_days), vestedAmountProjectToken(_days), 0);
    }
}
