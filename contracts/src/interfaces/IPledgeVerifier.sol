// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PledgeFacts} from "../libraries/Types.sol";

/// @notice Verifies a proof of a depository pledge. SPEC §8.6 (D18).
interface IPledgeVerifier {
    /// @dev MUST revert if the proof is invalid. The caller checks wallet binding, freshness and status.
    function verify(bytes calldata proof) external view returns (PledgeFacts memory);
}
