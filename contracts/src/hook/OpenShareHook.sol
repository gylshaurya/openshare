// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ComplianceRegistry} from "../registry/ComplianceRegistry.sol";

interface ICoreAssetLookup {
    function assetOfToken(address token) external view returns (bytes32);
}

/// @title OpenShareHook
/// @notice Uniswap v4 hook for Bull Street asset/USDT pools. SPEC §8.10 (D19).
///         - Pool guard: only listed Bull Street tokens paired with USDT, dynamic-fee pools, created by the owner.
///         - Dynamic fee: openFee while the exchange is open, closedFee while closed, staleFee if the oracle is stale.
///         - Reverts swaps while the asset's transfers are paused.
///         No price caps (D3 / D-R1). Holder compliance is enforced by the token itself (D16).
contract OpenShareHook is IHooks {
    using LPFeeLibrary for uint24;

    IPoolManager public immutable poolManager;
    ICoreAssetLookup public immutable core;
    IPriceOracle public immutable oracle;
    ComplianceRegistry public immutable compliance;
    address public immutable usdt;
    address public owner;

    uint24 public openFee = 500; // 0.05%
    uint24 public closedFee = 3000; // 0.30%
    uint24 public staleFee = 10_000; // 1.00%

    event FeesSet(uint24 openFee, uint24 closedFee, uint24 staleFee);
    event OwnerSet(address owner);

    error NotPoolManager();
    error NotOwner();
    error HookNotImplemented();
    error PoolNotAllowed();
    error AssetPaused();
    error InvalidFee();

    constructor(IPoolManager pm, address core_, IPriceOracle oracle_, ComplianceRegistry compliance_, address usdt_, address owner_)
    {
        poolManager = pm;
        core = ICoreAssetLookup(core_);
        oracle = oracle_;
        compliance = compliance_;
        usdt = usdt_;
        owner = owner_;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ------------------------------------------------------------------ admin

    function setFees(uint24 open_, uint24 closed_, uint24 stale_) external {
        if (msg.sender != owner) revert NotOwner();
        if (open_ > LPFeeLibrary.MAX_LP_FEE || closed_ > LPFeeLibrary.MAX_LP_FEE || stale_ > LPFeeLibrary.MAX_LP_FEE) {
            revert InvalidFee();
        }
        openFee = open_;
        closedFee = closed_;
        staleFee = stale_;
        emit FeesSet(open_, closed_, stale_);
    }

    function setOwner(address o) external {
        if (msg.sender != owner) revert NotOwner();
        owner = o;
        emit OwnerSet(o);
    }

    // ------------------------------------------------------------------ views

    /// @notice The asset (Bull Street token) side of a pool key, or bytes32(0) if the pool is not a Bull Street pool.
    function assetOf(PoolKey calldata key) public view returns (bytes32 assetId) {
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (c0 == usdt) return core.assetOfToken(c1);
        if (c1 == usdt) return core.assetOfToken(c0);
        return bytes32(0);
    }

    /// @notice Fee (hundredths of a bip) that the next swap on `assetId` would pay.
    function currentFee(bytes32 assetId) public view returns (uint24) {
        if (oracle.isStale(assetId)) return staleFee;
        return oracle.marketOpen() ? openFee : closedFee;
    }

    // ------------------------------------------------------------------ hooks

    function beforeInitialize(address sender, PoolKey calldata key, uint160) external view onlyPoolManager returns (bytes4) {
        if (sender != owner) revert PoolNotAllowed();
        if (assetOf(key) == bytes32(0)) revert PoolNotAllowed();
        if (!key.fee.isDynamicFee()) revert PoolNotAllowed();
        if (address(key.hooks) != address(this)) revert PoolNotAllowed();
        return IHooks.beforeInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bytes32 assetId = assetOf(key);
        if (compliance.transfersPaused(assetId)) revert AssetPaused();
        uint24 fee = currentFee(assetId);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    // ------------------------------------------------------------------ unused hooks

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
