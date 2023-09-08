// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockXCXC is ERC20 {
    constructor() ERC20("MOCKXCXC", "MOCKXCXC") {
        _mint(msg.sender, 1e6 * 1e18);
    }
}
