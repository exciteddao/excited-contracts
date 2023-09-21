// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";
import "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {VestingV1, VestingV1Events, VestingV1Errors} from "../../contracts/vesting-v1/VestingV1.sol";
import {MockERC20} from "../../contracts/test/MockERC20.sol";

abstract contract Helper is Test, VestingV1Events, VestingV1Errors {
    address public deployer;
    address public projectWallet;
    address public user1;
    address public user2;

    uint256 public constant TOKENS_PER_USER = 10_000_000;
    uint256 public constant VESTING_DURATION_DAYS = 2 * 365;
    uint256 public constant VESTING_DURATION_SECONDS = VESTING_DURATION_DAYS * 1 days;

    mapping(address => mapping(address => uint256)) public lastKnownBalances;

    MockERC20 public projectToken;

    VestingV1 public vesting;

    function setUp() public virtual {
        deployer = vm.addr(1);
        projectWallet = vm.addr(2);
        vm.label(deployer, "deployer");
        user1 = vm.addr(3);
        user2 = vm.addr(4);
        vm.label(projectWallet, "projectWallet");
        vm.label(user1, "user1");
        vm.label(user2, "user2");

        vm.startPrank(projectWallet);
        projectToken = new MockERC20(1_000_000_000, "PROJ");
        vm.label(address(projectToken), "projectToken");

        vesting = new VestingV1(address(projectToken), VESTING_DURATION_SECONDS, projectWallet);
        vm.stopPrank();
    }

    function activateAndReachStartTime() public {
        vm.startPrank(projectWallet);
        uint256 startTime = block.timestamp + 3 days;
        vesting.activate(startTime);
        vm.warp(startTime);
        vm.stopPrank();
    }

    function approveProjectTokenToVesting() public {
        vm.startPrank(projectWallet);
        projectToken.approve(address(vesting), 1_000_000_000);
        vm.stopPrank();
    }

    function approveProjectTokenToVesting(uint256 amount) public {
        vm.startPrank(projectWallet);
        projectToken.approve(address(vesting), amount);
        vm.stopPrank();
    }

    function setAmountForUser1() public {
        vm.prank(projectWallet);
        vesting.setAmount(user1, TOKENS_PER_USER);
    }

    function setAmountForUser1(uint256 amount) public {
        vm.prank(projectWallet);
        vesting.setAmount(user1, amount);
    }

    function setAmountForUser2() public {
        vm.prank(projectWallet);
        vesting.setAmount(user2, TOKENS_PER_USER);
    }

    function setAmountForUser2(uint256 amount) public {
        vm.prank(projectWallet);
        vesting.setAmount(user2, amount);
    }

    function advanceDays(uint256 _days) public {
        vm.warp(block.timestamp + _days * 1 days);
    }

    function updateBalances() public {
        lastKnownBalances[user1][address(projectToken)] = projectToken.balanceOf(user1);
    }

    function vestedAmount(uint256 _days) public pure returns (uint256) {
        if (_days > VESTING_DURATION_DAYS) {
            _days = VESTING_DURATION_DAYS;
        }
        return (_days * TOKENS_PER_USER) / VESTING_DURATION_DAYS;
    }

    function assertUserDeltaBalance(uint256 userProjectTokenAmount) public {
        uint256 MAX_DRIFT = 5;
        // PROJECT TOKEN BALANCE OF USER
        assertApproxEqAbs(
            projectToken.balanceOf(user1),
            lastKnownBalances[user1][address(projectToken)] + userProjectTokenAmount,
            MAX_DRIFT,
            "projectToken balance of user not equal to expected amount"
        );

        updateBalances();
    }
}
