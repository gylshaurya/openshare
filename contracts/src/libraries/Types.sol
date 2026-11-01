// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Shared types for OpenShare. See docs/SPEC.md §8.
library Types {
    /// 1 share = 1e18 token units.
    uint256 internal constant SHARE = 1e18;
    uint256 internal constant BPS = 10_000;

    uint8 internal constant STATUS_CONFIRMED = 1;

    uint8 internal constant KIND_RECLAIM = 1;
    uint8 internal constant KIND_KITE = 2;
    uint8 internal constant KIND_MOCK = 3;
}

/// @notice Facts about a depository pledge produced by an IPledgeVerifier. SPEC §8.6.
struct PledgeFacts {
    bytes32 pledgeRef;
    bytes32 assetId;
    uint64 quantity;
    bytes32 pledgorIdHash;
    bytes32 pledgeeIdHash;
    uint8 status;
    uint64 observedAt;
    address wallet;
    uint8 kind;
}

enum Role {
    None,
    Minter,
    Broker
}

enum PriceSource {
    Unset,
    Relay,
    Manual,
    Reclaim
}
