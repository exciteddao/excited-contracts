// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(uint256 amount, string memory symbol) ERC20(symbol, symbol) {
        _mint(msg.sender, amount);
    }
}
