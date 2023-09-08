// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("MOCKUSDC", "MOCKUSDC") {
        _mint(msg.sender, 1e6 * 1e9);
    }

    function decimals() public view virtual override returns (uint8) {
        return 9;
    }
}
