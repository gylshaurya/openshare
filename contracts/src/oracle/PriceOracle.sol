// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {PriceSource} from "../libraries/Types.sol";

/// @title PriceOracle
/// @notice Signed-relay oracle for exchange prices, USD/INR, session closes and market status. SPEC §8.5 (D17).
/// @dev Trusted component: prices are posted by RELAYER_ROLE. The source is recorded so the UI can label it.
contract PriceOracle is IPriceOracle, AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    struct AssetPrice {
        uint256 usd6; // USDT per share, 6 decimals
        uint256 inrPaise;
        uint256 usdInr6;
        uint64 updatedAt;
        uint256 closeUsd6;
        uint64 closeSessionId;
        uint64 sessions; // sessions in which the asset traded
        bool halted;
        PriceSource source;
    }

    struct PriceUpdate {
        bytes32 assetId;
        uint256 inrPaise;
        uint256 usdInr6;
        uint8 source;
    }

    struct SessionClose {
        bytes32 assetId;
        uint256 inrPaise;
        uint256 usdInr6;
        bool traded;
    }

    mapping(bytes32 => AssetPrice) public prices;
    bool public override marketOpen;
    bool public override extendedClosure;
    uint64 public currentSessionId;
    uint64 public maxPriceAge = 15 minutes;
    uint64 public lastHeartbeat;

    event PricesPushed(bytes32 indexed assetId, uint256 usd6, uint256 inrPaise, uint256 usdInr6, PriceSource source);
    event SessionClosed(uint64 indexed sessionId, bool nextIsExtendedClosure);
    event AssetSessionClosed(bytes32 indexed assetId, uint64 indexed sessionId, uint256 closeUsd6, bool traded);
    event MarketStatusChanged(bool open, bool extendedClosure);
    event HaltChanged(bytes32 indexed assetId, bool halted);

    error ZeroValue();
    error BadSessionId();
    error BadSource();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------- relayer

    function pushPrices(PriceUpdate[] calldata updates) external onlyRole(RELAYER_ROLE) {
        for (uint256 i; i < updates.length; ++i) {
            PriceUpdate calldata u = updates[i];
            if (u.source == uint8(PriceSource.Unset) || u.source > uint8(PriceSource.Reclaim)) revert BadSource();
            uint256 usd6 = toUsd6(u.inrPaise, u.usdInr6);
            AssetPrice storage p = prices[u.assetId];
            p.usd6 = usd6;
            p.inrPaise = u.inrPaise;
            p.usdInr6 = u.usdInr6;
            p.updatedAt = uint64(block.timestamp);
            p.source = PriceSource(u.source);
            emit PricesPushed(u.assetId, usd6, u.inrPaise, u.usdInr6, PriceSource(u.source));
        }
        lastHeartbeat = uint64(block.timestamp);
    }

    function closeSession(uint64 sessionId, SessionClose[] calldata closes, bool nextIsExtendedClosure)
        external
        onlyRole(RELAYER_ROLE)
    {
        if (sessionId != currentSessionId + 1) revert BadSessionId();
        currentSessionId = sessionId;
        for (uint256 i; i < closes.length; ++i) {
            SessionClose calldata c = closes[i];
            uint256 usd6 = toUsd6(c.inrPaise, c.usdInr6);
            AssetPrice storage p = prices[c.assetId];
            p.closeUsd6 = usd6;
            p.closeSessionId = sessionId;
            p.usd6 = usd6;
            p.inrPaise = c.inrPaise;
            p.usdInr6 = c.usdInr6;
            p.updatedAt = uint64(block.timestamp);
            if (p.source == PriceSource.Unset) p.source = PriceSource.Relay;
            if (c.traded) p.sessions += 1;
            p.halted = !c.traded;
            emit AssetSessionClosed(c.assetId, sessionId, usd6, c.traded);
        }
        marketOpen = false;
        extendedClosure = nextIsExtendedClosure;
        lastHeartbeat = uint64(block.timestamp);
        emit SessionClosed(sessionId, nextIsExtendedClosure);
        emit MarketStatusChanged(false, nextIsExtendedClosure);
    }

    function setMarketOpen(bool open) external onlyRole(RELAYER_ROLE) {
        marketOpen = open;
        if (open) extendedClosure = false;
        lastHeartbeat = uint64(block.timestamp);
        emit MarketStatusChanged(open, extendedClosure);
    }

    function setExtendedClosure(bool extended) external onlyRole(RELAYER_ROLE) {
        extendedClosure = extended;
        emit MarketStatusChanged(marketOpen, extended);
    }

    function setHalted(bytes32 assetId, bool halted) external onlyRole(RELAYER_ROLE) {
        prices[assetId].halted = halted;
        emit HaltChanged(assetId, halted);
    }

    function setMaxPriceAge(uint64 age) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxPriceAge = age;
    }

    // ---------------------------------------------------------------- views

    function price(bytes32 assetId) external view returns (uint256 usd6, uint64 updatedAt) {
        AssetPrice storage p = prices[assetId];
        return (p.usd6, p.updatedAt);
    }

    function lastClose(bytes32 assetId) external view returns (uint256 usd6, uint64 sessionId) {
        AssetPrice storage p = prices[assetId];
        return (p.closeUsd6, p.closeSessionId);
    }

    function assetSessions(bytes32 assetId) external view returns (uint64) {
        return prices[assetId].sessions;
    }

    function isStale(bytes32 assetId) external view returns (bool) {
        AssetPrice storage p = prices[assetId];
        if (p.updatedAt == 0) return true;
        return marketOpen && block.timestamp - p.updatedAt > maxPriceAge;
    }

    function priceSource(bytes32 assetId) external view returns (PriceSource) {
        return prices[assetId].source;
    }

    function isHalted(bytes32 assetId) external view returns (bool) {
        return prices[assetId].halted;
    }

    /// @notice usd6 = inrPaise / 100 / (usdInr6 / 1e6) * 1e6 = inrPaise * 1e10 / usdInr6
    function toUsd6(uint256 inrPaise, uint256 usdInr6) public pure returns (uint256) {
        if (inrPaise == 0 || usdInr6 == 0) revert ZeroValue();
        return inrPaise * 1e10 / usdInr6;
    }
}
