// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Pluggable price oracle. SPEC §8.5 (D17). Prices are USDT per share with 6 decimals.
interface IPriceOracle {
    function price(bytes32 assetId) external view returns (uint256 usd6, uint64 updatedAt);
    function lastClose(bytes32 assetId) external view returns (uint256 usd6, uint64 sessionId);
    /// @notice Number of sessions in which the asset traded. Deadlines count these (D12).
    function assetSessions(bytes32 assetId) external view returns (uint64);
    function marketOpen() external view returns (bool);
    function extendedClosure() external view returns (bool);
    function isStale(bytes32 assetId) external view returns (bool);
}
