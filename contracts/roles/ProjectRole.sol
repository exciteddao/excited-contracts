// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Context} from "@openzeppelin/contracts/utils/Context.sol";

/**
 * @dev Taken from OpenZeppelin Contracts (access/Ownable.sol).
 * Represents the project owner entity of a given project.
 * The `renounce` functionality has been removed to prevent accidental revoking.
 */
abstract contract ProjectRole is Context {
    address public projectWallet;

    event ProjectRoleTransferred(address indexed previousProjectWallet, address indexed newProjectWallet);

    constructor(address newProjectWallet) {
        _transferProjectRole(newProjectWallet);
    }

    modifier onlyProject() {
        // solhint-disable-next-line reason-string, custom-errors
        require(projectWallet == _msgSender(), "ProjectRole: caller is not the project wallet");
        _;
    }

    function transferProjectRole(address newProjectWallet) public onlyProject {
        _transferProjectRole(newProjectWallet);
    }

    // TODO(audit) switch internal to private
    function _transferProjectRole(address newProjectWallet) internal {
        // solhint-disable-next-line reason-string, custom-errors
        require(newProjectWallet != address(0), "ProjectRole: new project wallet is the zero address");
        address oldProjectWallet = projectWallet;
        projectWallet = newProjectWallet;
        emit ProjectRoleTransferred(oldProjectWallet, newProjectWallet);
    }
}
