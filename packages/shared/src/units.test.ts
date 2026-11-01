import { describe, expect, it } from "vitest";
import { agreedMedian, formatUsd6, median, toUsd6 } from "./units";
import { poolPriceUsd6 } from "./pool";

describe("units", () => {
  it("converts INR paise to usd6 like PriceOracle.toUsd6", () => {
    expect(toUsd6(140_000n, 87_500_000n)).toBe(16_000_000n);
    expect(toUsd6(140_875n, 87_500_000n)).toBe(16_100_000n);
  });
  it("formats usd6", () => {
    expect(formatUsd6(643_111_200n)).toBe("$643.11");
  });
  it("median and agreed median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(agreedMedian([1400, 1401, 1600])).toBe(1400.5);
    expect(agreedMedian([1400])).toBeUndefined();
    expect(agreedMedian([1400, 1700])).toBeUndefined();
  });
});

describe("pool price", () => {
  it("recovers $16 from sqrtPriceX96 in both orderings", () => {
    const Q96 = 2n ** 96n;
    // token is currency0: raw price = 16e6 / 1e18
    const sqrt0 = BigInt(Math.floor(Math.sqrt(16e6 / 1e18) * 2 ** 48)) * 2n ** 48n;
    const p0 = poolPriceUsd6(sqrt0, "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002");
    expect(Number(p0) / 1e6).toBeCloseTo(16, 3);
    // usdt is currency0: raw price = 1e18 / 16e6 = 6.25e10, sqrt = 250000
    const sqrt1 = 250_000n * Q96;
    const p1 = poolPriceUsd6(sqrt1, "0x0000000000000000000000000000000000000002", "0x0000000000000000000000000000000000000001");
    expect(p1).toBe(16_000_000n);
  });
});
