// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ComplianceRegistry} from "../registry/ComplianceRegistry.sol";

/// @title OpenShareToken
/// @notice One fungible token per ISIN (1 token = 1 share). Mint/burn only by OpenShareCore.
///         Transfer rules are enforced in `_update` (D16).
contract OpenShareToken is ERC20 {
    bytes32 public immutable assetId;
    address public immutable core;
    ComplianceRegistry public immutable compliance;

    error OnlyCore();
    error TransferNotAllowed(address from, address to);

    constructor(string memory name_, string memory symbol_, bytes32 assetId_, address core_, address compliance_)
        ERC20(name_, symbol_)
    {
        assetId = assetId_;
        core = core_;
        compliance = ComplianceRegistry(compliance_);
    }

    modifier onlyCore() {
        if (msg.sender != core) revert OnlyCore();
        _;
    }

    function mint(address to, uint256 amount) external onlyCore {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyCore {
        _burn(from, amount);
    }

    /// @notice Moves a holder's tokens into Core's redemption escrow without a separate approval.
    function escrowFrom(address holder, uint256 amount) external onlyCore {
        _transfer(holder, core, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Core moving tokens into or out of redemption escrow is a protocol operation, not a holder transfer,
        // but the counterparty must still not be blocked.
        address a = from == core ? address(0) : from;
        address b = to == core ? address(0) : to;
        if (!compliance.canTransfer(assetId, a, b)) revert TransferNotAllowed(from, to);
        super._update(from, to, value);
    }
}
