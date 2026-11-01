// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IPledgeVerifier} from "../interfaces/IPledgeVerifier.sol";
import {PledgeFacts, Types} from "../libraries/Types.sol";

/// @title AttestedPledgeVerifier
/// @notice Verifies PledgeFacts signed (EIP-712) by a trusted attestor: the Kite API attestor or the mock attestor.
///         Each signer is bound to one kind, so a mock signer can never produce a "Kite" proof. SPEC §8.6 (D18).
contract AttestedPledgeVerifier is IPledgeVerifier, AccessControl, EIP712 {
    bytes32 public constant PLEDGE_FACTS_TYPEHASH = keccak256(
        "PledgeFacts(bytes32 pledgeRef,bytes32 assetId,uint64 quantity,bytes32 pledgorIdHash,bytes32 pledgeeIdHash,uint8 status,uint64 observedAt,address wallet,uint8 kind)"
    );

    /// signer => kind (0 = not an attestor)
    mapping(address => uint8) public attestorKind;

    event AttestorSet(address indexed signer, uint8 kind);

    error UnknownAttestor(address signer);
    error KindMismatch(uint8 signerKind, uint8 factsKind);
    error InvalidKind();

    constructor(address admin) EIP712("OpenSharePledgeAttestor", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @param kind Types.KIND_KITE or Types.KIND_MOCK. 0 removes the attestor.
    function setAttestor(address signer, uint8 kind) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (kind != 0 && kind != Types.KIND_KITE && kind != Types.KIND_MOCK) revert InvalidKind();
        attestorKind[signer] = kind;
        emit AttestorSet(signer, kind);
    }

    function verify(bytes calldata proof) external view returns (PledgeFacts memory facts) {
        bytes memory sig;
        (facts, sig) = abi.decode(proof, (PledgeFacts, bytes));
        address signer = ECDSA.recover(hashFacts(facts), sig);
        uint8 kind = attestorKind[signer];
        if (kind == 0) revert UnknownAttestor(signer);
        if (kind != facts.kind) revert KindMismatch(kind, facts.kind);
    }

    function hashFacts(PledgeFacts memory f) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PLEDGE_FACTS_TYPEHASH,
                    f.pledgeRef,
                    f.assetId,
                    f.quantity,
                    f.pledgorIdHash,
                    f.pledgeeIdHash,
                    f.status,
                    f.observedAt,
                    f.wallet,
                    f.kind
                )
            )
        );
    }
}
