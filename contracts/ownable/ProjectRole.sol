// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }
}

/**
 * @dev Taken from OpenZeppelin Contracts (access/Ownable.sol).
 * Represents the project owner entity of a given project.
 */
abstract contract ProjectRole is Context {
    address private _projectWallet;

    event ProjectRoleTransferred(address indexed previousProjectWallet, address indexed newProjectWallet);

    constructor(address newProjectWallet) {
        _transferProjectRole(newProjectWallet);
    }

    modifier onlyProject() {
        require(projectWallet() == _msgSender(), "ProjectRole: caller is not the project wallet");
        _;
    }

    function projectWallet() public view virtual returns (address) {
        return _projectWallet;
    }

    function transferProjectRole(address newProjectWallet) public virtual onlyProject {
        require(newProjectWallet != address(0), "ProjectRole: new project wallet is the zero address");
        _transferProjectRole(newProjectWallet);
    }

    function _transferProjectRole(address newProjectWallet) internal virtual {
        address oldProjectWallet = _projectWallet;
        _projectWallet = newProjectWallet;
        emit ProjectRoleTransferred(oldProjectWallet, newProjectWallet);
    }
}
