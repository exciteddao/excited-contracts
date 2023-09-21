// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";
import "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {VestingV1} from "../../contracts/vesting-v1/VestingV1.sol";
import {MockERC20} from "../../contracts/test/MockERC20.sol";

abstract contract Helper is Test {
    address public deployer;
    address public projectWallet;
    address public user;

    MockERC20 public projectToken;

    VestingV1 public vesting;

    function setUp() public {
        deployer = vm.addr(2);
        projectWallet = vm.addr(1);
        user = vm.addr(3);
        vm.prank(projectWallet);
        projectToken = new MockERC20(1000, "PROJ");

        vesting = new VestingV1(address(projectToken), 1000, projectWallet);
    }
}

contract ContractBTest is Test, Helper {
    function testFuzz_Activate(uint256 timestamp) public {
        vm.assume(timestamp < block.timestamp + 7776000);
        vm.startPrank(projectWallet);
        vesting.setAmount(user, 800);
        //vm.warp()

        projectToken.approve(address(vesting), 800);
        vesting.activate(block.timestamp + timestamp);
        console.logString("test");
    }
}
