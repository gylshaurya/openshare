# Uniswap v4 integration

- **Library:** `Uniswap/v4-core` tag `v4.0.0` (the only release). v4-periphery isn't used. Its `BaseHook` and `HookMiner` were moved out of `main` (PR #510), so Bull Street implements `IHooks` directly and mines the hook address in its own script.
- **Contracts deployed by Bull Street:** `PoolManager(owner)`, `PoolSwapTest(manager)`, `PoolModifyLiquidityTest(manager)` (from `v4-core/src/test`), and `OpenShareHook`.
- **Hook flags:** `BEFORE_INITIALIZE_FLAG (1<<13) | BEFORE_SWAP_FLAG (1<<7)`. The hook address must have exactly these low 14 bits. It's mined with the CREATE2 proxy `0x4e59…956C` in scripts, and with `deployCodeTo` in tests.
- **Dynamic fees:** the pool key uses `fee = LPFeeLibrary.DYNAMIC_FEE_FLAG (0x800000)`. `beforeSwap` returns `fee | LPFeeLibrary.OVERRIDE_FEE_FLAG (0x400000)`. Fee units are hundredths of a bip (500 = 0.05%).
- **Real end user:** `sender` in the hook is the router. Bull Street doesn't need the end user in the hook, because the token's `_update` enforces compliance on the final transfer (D16).
- **Swaps from the UI:**
  - `PoolSwapTest.swap(key, SwapParams{zeroForOne, amountSpecified (negative = exact in), sqrtPriceLimitX96}, TestSettings{takeClaims:false, settleUsingBurn:false}, hookData)` after an ERC-20 `approve` to the router.
  - Liquidity: `PoolModifyLiquidityTest.modifyLiquidity(key, ModifyLiquidityParams{tickLower, tickUpper, liquidityDelta, salt}, hookData)`.
- **Production path:** PositionManager + Permit2, and a router implementing `msgSender()` (UniversalRouter or v4-router).
