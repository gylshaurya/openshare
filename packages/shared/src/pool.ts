import type { Address } from "viem";

export const DYNAMIC_FEE_FLAG = 0x800000;
export const TICK_SPACING = 60;
export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;
const Q96 = 2n ** 96n;

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export function poolKeyFor(token: Address, usdt: Address, hook: Address): PoolKey {
  const tokenFirst = token.toLowerCase() < usdt.toLowerCase();
  return {
    currency0: tokenFirst ? token : usdt,
    currency1: tokenFirst ? usdt : token,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: TICK_SPACING,
    hooks: hook,
  };
}

/**
 * Pool price as USDT (6 dec) per share (1e18 units), i.e. usd6, from sqrtPriceX96.
 * raw price = currency1/currency0 = (sqrtP / 2^96)^2.
 */
export function poolPriceUsd6(sqrtPriceX96: bigint, token: Address, usdt: Address): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  const tokenFirst = token.toLowerCase() < usdt.toLowerCase();
  const sq = sqrtPriceX96 * sqrtPriceX96; // raw price * 2^192
  if (tokenFirst) {
    // usdt raw per token raw; per 1e18 token units:
    return (sq * 10n ** 18n) / (Q96 * Q96);
  }
  // token raw per usdt raw => usd6 = 1e18 / rawPrice
  return (Q96 * Q96 * 10n ** 18n) / sq;
}

/** PoolId = keccak256(abi.encode(PoolKey)). */
export const poolKeyAbi = [
  {
    type: "tuple",
    components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ],
  },
] as const;
