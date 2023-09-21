// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";

import {Helper} from "./Helper.sol";

contract ProjectRole is Test, Helper {
    address public differentProjectWallet;

    function setUp() public override {
        Helper.setUp();
        differentProjectWallet = vm.addr(5);
        vm.label(differentProjectWallet, "differentProjectWallet");
    }

    /// @notice Test that only projectWallet can transfer project role to another address
    function test_onlyProjectWalletCanTransfer() public {
        assertEq(projectWallet, vesting.projectWallet());
        vm.prank(projectWallet);
        vesting.transferProjectRole(differentProjectWallet);
        assertEq(differentProjectWallet, vesting.projectWallet());
    }

    /// @notice Test that project role can only be transferred to a non-zero address
    function test_cannotTransferToZeroAddress() public {
        vm.prank(projectWallet);
        vm.expectRevert("ProjectRole: new project wallet is the zero address");
        vesting.transferProjectRole(address(0));
        assertEq(projectWallet, vesting.projectWallet());
    }

    /// @notice Project role permissions should be available to new project wallet address after role transfer
    function test_newProjectWalletHasProjectRolePermissions() public {
        setAmountForUser2();
        approveProjectTokenToVesting();
        activateAndReachStartTime();
        advanceDays(1);
        assertEq(projectWallet, vesting.projectWallet());
        vm.prank(projectWallet);
        vesting.transferProjectRole(differentProjectWallet);
        assertEq(differentProjectWallet, vesting.projectWallet());
        vm.prank(differentProjectWallet);
        vesting.claim(user2);
    }

    /// @notice Old project wallet should not have project role permissions after role transfer
    function test_oldProjectWalletDoesNotHaveProjectRolePermissions() public {
        setAmountForUser2(1000);
        approveProjectTokenToVesting();
        vm.prank(projectWallet);
        vesting.transferProjectRole(differentProjectWallet);
        vm.expectRevert("ProjectRole: caller is not the project wallet");
        vesting.activate(block.timestamp + 1);
    }

    /// @notice Old project wallet should not be able to transfer project role after role transfer
    function test_oldProjectWalletCannotTransferProjectRole() public {
        vm.startPrank(projectWallet);
        vesting.transferProjectRole(differentProjectWallet);
        assertEq(differentProjectWallet, vesting.projectWallet());
        vm.expectRevert("ProjectRole: caller is not the project wallet");
        vesting.transferProjectRole(differentProjectWallet);
    }
}
