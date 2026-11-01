// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Role} from "../libraries/Types.sol";

/// @title RoleRegistry
/// @notice One human (World ID nullifier) -> one role -> one wallet. SPEC §8.3 (D15).
/// @dev World ID has no verifier on the target chain, so a backend verifies the IDKit proof and signs an
///      EIP-712 RoleAttestation. The nullifier stays consumed forever, even if the wallet's role is revoked.
contract RoleRegistry is AccessControl, EIP712 {
    bytes32 public constant WORLD_ATTESTOR_ROLE = keccak256("WORLD_ATTESTOR_ROLE");
    bytes32 public constant ROLE_ATTESTATION_TYPEHASH =
        keccak256("RoleAttestation(address wallet,uint8 role,uint256 nullifierHash,uint64 expiresAt)");

    struct RoleAttestation {
        address wallet;
        uint8 role;
        uint256 nullifierHash;
        uint64 expiresAt;
    }

    mapping(address => Role) public roleOf;
    mapping(uint256 => Role) public nullifierRole;
    mapping(uint256 => address) public nullifierWallet;

    event RoleRegistered(address indexed wallet, Role role, uint256 indexed nullifierHash);
    event RoleRevoked(address indexed wallet, Role role);

    error AttestationExpired();
    error InvalidRole();
    error WrongWallet();
    error BadSignature();
    error HumanAlreadyRegistered();
    error WalletAlreadyRegistered();

    constructor(address admin) EIP712("OpenShareRoles", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function register(RoleAttestation calldata att, bytes calldata sig) external {
        if (block.timestamp > att.expiresAt) revert AttestationExpired();
        if (att.role != uint8(Role.Minter) && att.role != uint8(Role.Broker)) revert InvalidRole();
        if (att.wallet != msg.sender) revert WrongWallet();
        if (nullifierRole[att.nullifierHash] != Role.None) revert HumanAlreadyRegistered();
        if (roleOf[att.wallet] != Role.None) revert WalletAlreadyRegistered();

        address signer = ECDSA.recover(hashAttestation(att), sig);
        if (!hasRole(WORLD_ATTESTOR_ROLE, signer)) revert BadSignature();

        Role role = Role(att.role);
        nullifierRole[att.nullifierHash] = role;
        nullifierWallet[att.nullifierHash] = att.wallet;
        roleOf[att.wallet] = role;
        emit RoleRegistered(att.wallet, role, att.nullifierHash);
    }

    /// @notice Admin revocation. The nullifier remains consumed so the human cannot re-register.
    function revoke(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Role r = roleOf[wallet];
        roleOf[wallet] = Role.None;
        emit RoleRevoked(wallet, r);
    }

    function hashAttestation(RoleAttestation calldata att) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ROLE_ATTESTATION_TYPEHASH, att.wallet, att.role, att.nullifierHash, att.expiresAt))
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function isMinter(address a) external view returns (bool) {
        return roleOf[a] == Role.Minter;
    }

    function isBroker(address a) external view returns (bool) {
        return roleOf[a] == Role.Broker;
    }
}
