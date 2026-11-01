// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IPledgeVerifier} from "../interfaces/IPledgeVerifier.sol";
import {PledgeFacts, Types} from "../libraries/Types.sol";

/// @title ReclaimPledgeVerifier
/// @notice Verifies Reclaim zkTLS proofs of a depository/broker pledge page and maps them to PledgeFacts.
///         SPEC §10.5 (D18). Reclaim is not deployed on the target chain, so this contract keeps its own
///         allowlist of attestor keys (byte-compatible with reclaim-solidity-sdk serialisation).
/// @dev Expected `extractedParameters` in the proof context (configured in the Reclaim provider):
///        isin    (required)  e.g. "INE002A01018"
///        qty     (required)  pledged quantity, decimal string ("12" or "12.0")
///        client  (required)  demat / broker client id of the pledgor (binds the pledge to one account)
///        pledgee (optional)  pledgee id; falls back to the provider's default pledgee label
///        status  (optional)  must be an allowed "confirmed" status; if absent the provider must imply it
///        psn     (optional)  depository pledge sequence number
contract ReclaimPledgeVerifier is IPledgeVerifier, AccessControl {
    struct ClaimInfo {
        string provider;
        string parameters;
        string context;
    }

    struct CompleteClaimData {
        bytes32 identifier;
        address owner;
        uint32 timestampS;
        uint32 epoch;
    }

    struct SignedClaim {
        CompleteClaimData claim;
        bytes[] signatures;
    }

    struct Proof {
        ClaimInfo claimInfo;
        SignedClaim signedClaim;
    }

    struct ProviderConfig {
        bool allowed;
        bool impliesConfirmed;
        bytes32 defaultPledgeeHash;
    }

    mapping(address => bool) public isAttestor;
    uint8 public threshold = 1;
    mapping(bytes32 => ProviderConfig) public providers; // providerHash => config
    mapping(bytes32 => bool) public confirmedStatus; // keccak256(status string) => ok

    event AttestorSet(address indexed attestor, bool allowed);
    event ThresholdSet(uint8 threshold);
    event ProviderSet(bytes32 indexed providerHash, bool allowed, bool impliesConfirmed, bytes32 defaultPledgeeHash);
    event StatusSet(string status, bool ok);

    error IdentifierMismatch();
    error UnknownAttestor(address signer);
    error DuplicateSignature();
    error NotEnoughSignatures();
    error BadSignature();
    error ProviderNotAllowed(bytes32 providerHash);
    error MissingField(string field);
    error BadHex();
    error BadNumber();

    constructor(address admin, address[] memory attestors) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        for (uint256 i; i < attestors.length; ++i) {
            isAttestor[attestors[i]] = true;
            emit AttestorSet(attestors[i], true);
        }
        confirmedStatus[keccak256("CONFIRMED")] = true;
        confirmedStatus[keccak256("SUCCESS")] = true;
        confirmedStatus[keccak256("PLEDGED")] = true;
    }

    // ------------------------------------------------------------------ admin

    function setAttestor(address a, bool ok) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isAttestor[a] = ok;
        emit AttestorSet(a, ok);
    }

    function setThreshold(uint8 t) external onlyRole(DEFAULT_ADMIN_ROLE) {
        threshold = t;
        emit ThresholdSet(t);
    }

    function setProvider(bytes32 providerHash, bool allowed, bool impliesConfirmed, bytes32 defaultPledgeeHash)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        providers[providerHash] = ProviderConfig(allowed, impliesConfirmed, defaultPledgeeHash);
        emit ProviderSet(providerHash, allowed, impliesConfirmed, defaultPledgeeHash);
    }

    function setConfirmedStatus(string calldata status, bool ok) external onlyRole(DEFAULT_ADMIN_ROLE) {
        confirmedStatus[keccak256(bytes(status))] = ok;
        emit StatusSet(status, ok);
    }

    // ------------------------------------------------------------------ verification

    function verify(bytes calldata proofBytes) external view returns (PledgeFacts memory f) {
        Proof memory p = abi.decode(proofBytes, (Proof));
        string memory ctx = verifySignatures(p);

        bytes32 providerHash = parseBytes32(extractField(ctx, '"providerHash":"'));
        ProviderConfig memory cfg = providers[providerHash];
        if (!cfg.allowed) revert ProviderNotAllowed(providerHash);

        string memory isin = _required(ctx, '"isin":"', "isin");
        string memory client = _required(ctx, '"client":"', "client");
        uint64 qty = uint64(parseUintPrefix(_required(ctx, '"qty":"', "qty")));
        string memory pledgee = extractField(ctx, '"pledgee":"');
        string memory status = extractField(ctx, '"status":"');
        string memory psn = extractField(ctx, '"psn":"');

        bool confirmed = bytes(status).length == 0 ? cfg.impliesConfirmed : confirmedStatus[keccak256(bytes(status))];

        f.assetId = keccak256(bytes(isin));
        f.quantity = qty;
        f.pledgorIdHash = keccak256(bytes(client));
        f.pledgeeIdHash = bytes(pledgee).length == 0 ? cfg.defaultPledgeeHash : keccak256(bytes(pledgee));
        f.status = confirmed ? Types.STATUS_CONFIRMED : 0;
        f.observedAt = p.signedClaim.claim.timestampS;
        f.wallet = parseAddress(_required(ctx, '"contextAddress":"', "contextAddress"));
        f.kind = Types.KIND_RECLAIM;
        // D23: PSN when available, otherwise one pledge per (client, pledgee, isin).
        f.pledgeRef = bytes(psn).length != 0
            ? keccak256(abi.encodePacked("PSN", psn))
            : keccak256(abi.encodePacked("RECLAIM", f.pledgorIdHash, f.pledgeeIdHash, f.assetId));
    }

    /// @notice Checks the claim identifier and attestor signatures; returns the signed context string.
    function verifySignatures(Proof memory p) public view returns (string memory) {
        bytes32 id =
            keccak256(abi.encodePacked(p.claimInfo.provider, "\n", p.claimInfo.parameters, "\n", p.claimInfo.context));
        if (id != p.signedClaim.claim.identifier) revert IdentifierMismatch();

        bytes memory m = abi.encodePacked(
            _hex(abi.encodePacked(id)),
            "\n",
            _hex(abi.encodePacked(p.signedClaim.claim.owner)),
            "\n",
            _uint(p.signedClaim.claim.timestampS),
            "\n",
            _uint(p.signedClaim.claim.epoch)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", _uint(m.length), m));

        uint256 n = p.signedClaim.signatures.length;
        address[] memory seen = new address[](n);
        for (uint256 i; i < n; ++i) {
            address s = _recover(digest, p.signedClaim.signatures[i]);
            if (!isAttestor[s]) revert UnknownAttestor(s);
            for (uint256 j; j < i; ++j) {
                if (seen[j] == s) revert DuplicateSignature();
            }
            seen[i] = s;
        }
        if (n == 0 || n < threshold) revert NotEnoughSignatures();
        return p.claimInfo.context;
    }

    // ------------------------------------------------------------------ parsing helpers (public for tests)

    /// @notice Same semantics as Reclaim's extractFieldFromContext. `target` like '"isin":"'.
    function extractField(string memory data, string memory target) public pure returns (string memory) {
        bytes memory d = bytes(data);
        bytes memory t = bytes(target);
        if (d.length < t.length || t.length == 0) return "";
        for (uint256 i; i <= d.length - t.length; ++i) {
            bool ok = true;
            for (uint256 j; j < t.length; ++j) {
                if (d[i + j] != t[j]) {
                    ok = false;
                    break;
                }
            }
            if (!ok) continue;
            uint256 s = i + t.length;
            uint256 e = s;
            while (e < d.length && !(d[e] == '"' && d[e - 1] != "\\")) ++e;
            if (e >= d.length) return "";
            bytes memory out = new bytes(e - s);
            for (uint256 k = s; k < e; ++k) {
                out[k - s] = d[k];
            }
            return string(out);
        }
        return "";
    }

    function parseAddress(string memory s) public pure returns (address) {
        bytes memory b = bytes(s);
        if (b.length != 42 || b[0] != "0" || (b[1] != "x" && b[1] != "X")) revert BadHex();
        uint160 r;
        for (uint256 i = 2; i < 42; ++i) {
            r = (r << 4) | uint160(_nibble(b[i]));
        }
        return address(r);
    }

    function parseBytes32(string memory s) public pure returns (bytes32) {
        bytes memory b = bytes(s);
        if (b.length != 66 || b[0] != "0" || (b[1] != "x" && b[1] != "X")) revert BadHex();
        uint256 r;
        for (uint256 i = 2; i < 66; ++i) {
            r = (r << 4) | _nibble(b[i]);
        }
        return bytes32(r);
    }

    /// @notice Parses the integer part of a decimal string ("12", "12.0", "1,200" -> 1200).
    function parseUintPrefix(string memory s) public pure returns (uint256 r) {
        bytes memory b = bytes(s);
        bool any;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c == ".") break;
            if (c == ",") continue;
            if (c < "0" || c > "9") revert BadNumber();
            r = r * 10 + (uint8(c) - 48);
            any = true;
        }
        if (!any) revert BadNumber();
    }

    function _required(string memory ctx, string memory target, string memory name)
        internal
        pure
        returns (string memory v)
    {
        v = extractField(ctx, target);
        if (bytes(v).length == 0) revert MissingField(name);
    }

    function _nibble(bytes1 c) private pure returns (uint8) {
        uint8 x = uint8(c);
        if (x >= 48 && x <= 57) return x - 48;
        if (x >= 97 && x <= 102) return x - 87;
        if (x >= 65 && x <= 70) return x - 55;
        revert BadHex();
    }

    function _recover(bytes32 h, bytes memory sig) private pure returns (address a) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadSignature();
        a = ecrecover(h, v, r, s);
        if (a == address(0)) revert BadSignature();
    }

    function _hex(bytes memory b) private pure returns (bytes memory o) {
        bytes16 H = "0123456789abcdef";
        o = new bytes(2 + b.length * 2);
        o[0] = "0";
        o[1] = "x";
        for (uint256 i; i < b.length; ++i) {
            o[2 + 2 * i] = H[uint8(b[i]) >> 4];
            o[3 + 2 * i] = H[uint8(b[i]) & 15];
        }
    }

    function _uint(uint256 v) private pure returns (bytes memory) {
        if (v == 0) return "0";
        uint256 l;
        for (uint256 t = v; t != 0; t /= 10) {
            ++l;
        }
        bytes memory o = new bytes(l);
        while (v != 0) {
            o[--l] = bytes1(uint8(48 + v % 10));
            v /= 10;
        }
        return o;
    }
}
