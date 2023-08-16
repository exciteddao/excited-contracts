// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor(uint256 amount, string memory symbol) ERC20(symbol, symbol) {
        _mint(msg.sender, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
