// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ComplianceRegistry
/// @notice Holder denylist and per-asset pauses. Enforced by OpenShareToken on every transfer (D16).
contract ComplianceRegistry is AccessControl {
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    mapping(address => bool) public isBlocked;
    mapping(bytes32 => bool) public mintPaused;
    mapping(bytes32 => bool) public transfersPaused;

    event Blocked(address indexed account, bool blocked);
    event PauseChanged(bytes32 indexed assetId, bool mintPaused, bool transfersPaused);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
    }

    function setBlocked(address account, bool blocked) external onlyRole(COMPLIANCE_ROLE) {
        isBlocked[account] = blocked;
        emit Blocked(account, blocked);
    }

    function setMintPaused(bytes32 assetId, bool paused) external onlyRole(COMPLIANCE_ROLE) {
        mintPaused[assetId] = paused;
        emit PauseChanged(assetId, paused, transfersPaused[assetId]);
    }

    function setTransfersPaused(bytes32 assetId, bool paused) external onlyRole(COMPLIANCE_ROLE) {
        transfersPaused[assetId] = paused;
        emit PauseChanged(assetId, mintPaused[assetId], paused);
    }

    /// @notice Whether a holder-initiated transfer is allowed. Mint (from=0) and burn (to=0) skip the pause check
    ///         but still check that the non-zero party is not blocked.
    function canTransfer(bytes32 assetId, address from, address to) external view returns (bool) {
        bool isMintOrBurn = from == address(0) || to == address(0);
        if (!isMintOrBurn && transfersPaused[assetId]) return false;
        if (from != address(0) && isBlocked[from]) return false;
        if (to != address(0) && isBlocked[to]) return false;
        return true;
    }
}
