// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";
import "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {InsuredVestingV1} from "../../contracts/insured-vesting-v1/InsuredVestingV1.sol";
import {MockERC20} from "../../contracts/test/MockERC20.sol";
import {Helper} from "./InsuredVestingV1.t.sol";

contract InsuredVestingV1Test_Claim is Test, Helper {
    function testFuzz_addFunds(uint256 amount) public {
        vm.assume(amount > 0 && amount <= FUNDING_PER_USER);
        uint256 balanceBefore = fundingToken.balanceOf(user1);
        setAllocationForUser1(amount);
        addFundingFromUser1(amount);
        assertEq(fundingToken.balanceOf(address(insuredVesting)), amount);
        assertEq(fundingToken.balanceOf(user1), balanceBefore - amount);

        activateAndReachStartTime();
        advanceDays(VESTING_DURATION_DAYS);

        vm.prank(user1);
        insuredVesting.claim(user1);
        assertEq(projectToken.balanceOf(user1), vestedAmountProjectToken(VESTING_DURATION_DAYS, amount));
    }

    /// A corner case where the amount funded is so little, it's indivisible relative to the time passed
    function test_addFunds_smallAmounts_nothingToClaim() public {
        uint256 amount = 1;
        uint256 balanceBefore = fundingToken.balanceOf(user1);
        setAllocationForUser1(amount);
        addFundingFromUser1(amount);
        assertEq(fundingToken.balanceOf(address(insuredVesting)), amount);
        assertEq(fundingToken.balanceOf(user1), balanceBefore - amount);

        activateAndReachStartTime();
        advanceDays(30);

        vm.expectRevert(InsuredVestingV1.NothingToClaim.selector);
        vm.prank(user1);
        insuredVesting.claim(user1);
    }

    function test_addFunds_smallAmounts() public {
        uint256 amount = 100;
        uint256 balanceBefore = fundingToken.balanceOf(user1);
        setAllocationForUser1(amount);
        addFundingFromUser1(amount);
        assertEq(fundingToken.balanceOf(address(insuredVesting)), amount);
        assertEq(fundingToken.balanceOf(user1), balanceBefore - amount);

        activateAndReachStartTime();
        advanceDays(30);

        vm.prank(user1);
        insuredVesting.claim(user1);
        assertEq(projectToken.balanceOf(user1), vestedAmountProjectToken(30, amount));
    }

    function test_cannotFundIfNoAllocation() public {
        vm.expectRevert(InsuredVestingV1.AllocationExceeded.selector);
        vm.prank(user1);
        insuredVesting.addFunds(1);
    }
}

//       it("user cannot fund if does not have allocation", async () => {
//         const amount = await fundingToken.amount(FUNDING_PER_USER);
//         await expectRevert(async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }), `${Error.AllocationExceeded}(0)`);
//       });

//       it("user cannot add more funds than allocation, two attempts", async () => {
//         await setAllocationForUser1();
//         await addFundingFromUser1();
//         const amount = await fundingToken.amount(1);
//         await expectRevert(async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }), `${Error.AllocationExceeded}(0)`);
//       });

//       it("user cannot add more funds than allocation, single attempts", async () => {
//         await setAllocationForUser1();
//         const amount = await fundingToken.amount(FUNDING_PER_USER + 1);
//         await expectRevert(
//           async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }),
//           `${Error.AllocationExceeded}(${await fundingToken.amount(FUNDING_PER_USER)})`
//         );
//       });

//       it("cannot add funds after activation", async () => {
//         await setAllocationForUser1();
//         await addFundingFromUser1(FUNDING_PER_USER / 2);
//         await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
//         await expectRevert(async () => insuredVesting.methods.addFunds(1).send({ from: user1 }), Error.AlreadyActivated);
//       });

//       it("cannot add funds if emergency released", async () => {
//         await setAllocationForUser1();
//         await addFundingFromUser1(FUNDING_PER_USER / 2);
//         await insuredVesting.methods.emergencyRelease().send({ from: deployer });
//         await expectRevert(async () => insuredVesting.methods.addFunds(1).send({ from: user1 }), Error.EmergencyReleaseActive);
//       });

//       it("fails if user does not have enough balance", async () => {
//         const amount = FUNDING_PER_USER + 1;
//         await insuredVesting.methods.setFundingTokenAllocation(user1, await fundingToken.amount(amount)).send({ from: projectWallet });
//         await expectRevert(async () => insuredVesting.methods.addFunds(await fundingToken.amount(amount)).send({ from: user1 }), ERC_20_EXCEEDS_ALLOWANCE_USDC);
//       });
