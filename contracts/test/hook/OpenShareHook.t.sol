// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../utils/Base.t.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {OpenShareHook} from "../../src/hook/OpenShareHook.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";

contract OpenShareHookTest is Base {
    PoolManager manager;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest lpRouter;
    OpenShareHook hook;
    PoolKey key;
    address trader = makeAddr("trader");
    address alice;

    function setUp() public override {
        super.setUp();
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);

        address hookAddr = address(uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG) | (uint160(0x4444) << 144));
        deployCodeTo(
            "OpenShareHook.sol:OpenShareHook",
            abi.encode(manager, address(core), IPriceOracle(address(oracle)), compliance, address(usdt), address(lpRouter)),
            hookAddr
        );
        hook = OpenShareHook(hookAddr);

        // Liquidity: Alice mints 1,000 shares and gives them to this contract (the LP).
        address x = makeBroker("X", 1_000_000e6);
        alice = makeMinter("alice");
        (uint256 id,) = pledge(alice, x, 1_000);
        mintFor(alice, id, 1_000);
        vm.prank(alice);
        token.transfer(address(this), shares(1_000));
        usdt.mint(address(this), 1_000_000e6);

        key = _key();
        uint160 sqrtP = _sqrtPrice16();
        // Pool creation is restricted to the hook owner (the LP router is set as owner for this test).
        vm.prank(address(lpRouter));
        manager.initialize(key, sqrtP);

        token.approve(address(lpRouter), type(uint256).max);
        usdt.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(60),
                tickUpper: TickMath.maxUsableTick(60),
                liquidityDelta: 1e15,
                salt: 0
            }),
            ""
        );

        usdt.mint(trader, 100_000e6);
        vm.prank(trader);
        usdt.approve(address(swapRouter), type(uint256).max);
        vm.prank(trader);
        token.approve(address(swapRouter), type(uint256).max);
    }

    function _key() internal view returns (PoolKey memory k) {
        (address a, address b) = address(token) < address(usdt) ? (address(token), address(usdt)) : (address(usdt), address(token));
        k = PoolKey({
            currency0: Currency.wrap(a),
            currency1: Currency.wrap(b),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    /// sqrtPriceX96 for $16 per share: raw price currency1/currency0.
    function _sqrtPrice16() internal view returns (uint160) {
        (uint256 num, uint256 den) = address(token) < address(usdt) ? (uint256(16e6), uint256(1e18)) : (uint256(1e18), uint256(16e6));
        return uint160(Math.sqrt((num << 192) / den));
    }

    function _buyTokens(uint256 usdtIn) internal returns (uint256 tokensOut) {
        return _buyTokens(usdtIn, false);
    }

    function _buyTokens(uint256 usdtIn, bool expectFail) internal returns (uint256 tokensOut) {
        bool usdtIs0 = address(usdt) < address(token);
        uint256 before = token.balanceOf(trader);
        if (expectFail) vm.expectRevert();
        vm.prank(trader);
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: usdtIs0,
                amountSpecified: -int256(usdtIn),
                sqrtPriceLimitX96: usdtIs0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        if (expectFail) return 0;
        tokensOut = token.balanceOf(trader) - before;
    }

    function test_swapWorks_andFeeDependsOnMarket() public {
        // Market closed (default): closed fee 0.30%.
        assertEq(hook.currentFee(ASSET), 3000);
        uint256 snap = vm.snapshotState();
        uint256 outClosed = _buyTokens(160e6);
        vm.revertToState(snap);
        setMarketOpen(true);
        setPriceInr(140_000); // fresh price while open
        assertEq(hook.currentFee(ASSET), 500);
        uint256 outOpen = _buyTokens(160e6);
        assertGt(outClosed, 9.5e18); // ~4% of pool depth incl. price impact
        assertGt(outOpen, outClosed, "open fee is cheaper than closed fee");
    }

    function test_staleOracleUsesStaleFee() public {
        setMarketOpen(true);
        skip(1 hours);
        assertEq(hook.currentFee(ASSET), 10_000);
        _buyTokens(16e6); // still trades, at 1%
    }

    function test_pausedAssetRevertsSwap() public {
        vm.prank(admin);
        compliance.setTransfersPaused(ASSET, true);
        _buyTokens(16e6, true);
    }

    function test_blockedTraderCannotReceive() public {
        vm.prank(admin);
        compliance.setBlocked(trader, true);
        _buyTokens(16e6, true);
    }

    function test_poolGuard() public {
        // A non-owner cannot create pools with the hook.
        PoolKey memory k2 = key;
        k2.tickSpacing = 10;
        vm.expectRevert();
        manager.initialize(k2, _sqrtPrice16());
        // A static-fee pool is rejected even for the owner.
        PoolKey memory k3 = key;
        k3.fee = 3000;
        vm.prank(address(lpRouter));
        vm.expectRevert();
        manager.initialize(k3, _sqrtPrice16());
    }

    function test_onlyPoolManagerCallsHook() public {
        vm.expectRevert(OpenShareHook.NotPoolManager.selector);
        hook.beforeSwap(
            address(this), key, IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 0}), ""
        );
    }

    function test_setFees() public {
        vm.expectRevert(OpenShareHook.NotOwner.selector);
        hook.setFees(1, 2, 3);
        vm.prank(address(lpRouter));
        hook.setFees(100, 200, 300);
        assertEq(hook.closedFee(), 200);
    }
}
