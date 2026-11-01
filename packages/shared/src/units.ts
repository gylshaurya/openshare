/** Unit helpers (SPEC §8.1). Prices are USDT per share with 6 decimals; tokens have 18 decimals. */
export const SHARE = 10n ** 18n;
export const USDT = 10n ** 6n;
export const BPS = 10_000n;

/** usd6 = inrPaise * 1e10 / usdInr6 (same as PriceOracle.toUsd6). */
export function toUsd6(inrPaise: bigint, usdInr6: bigint): bigint {
  if (inrPaise === 0n || usdInr6 === 0n) throw new Error("zero value");
  return (inrPaise * 10n ** 10n) / usdInr6;
}

export function rupeesToPaise(rupees: number): bigint {
  return BigInt(Math.round(rupees * 100));
}

export function rateToUsdInr6(rate: number): bigint {
  return BigInt(Math.round(rate * 1e6));
}

export function formatUsd6(v: bigint, digits = 2): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / USDT;
  const frac = (a % USDT).toString().padStart(6, "0").slice(0, digits);
  return `${neg ? "-" : ""}$${whole.toLocaleString("en-US")}${digits > 0 ? "." + frac : ""}`;
}

export function formatShares(units: bigint, digits = 2): string {
  const whole = units / SHARE;
  const frac = (units % SHARE).toString().padStart(18, "0").slice(0, digits);
  return digits > 0 && /[1-9]/.test(frac) ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
}

export function formatBps(bps: bigint | number): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

/** Median of numbers; throws on empty input. */
export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median of empty set");
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Median of values that agree within `toleranceBps` of the overall median.
 * Returns undefined if fewer than `minAgree` values agree (SPEC §10.1).
 */
export function agreedMedian(values: number[], toleranceBps = 100, minAgree = 2): number | undefined {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  if (v.length < minAgree) return undefined;
  const m = median(v);
  const ok = v.filter((x) => (Math.abs(x - m) / m) * 10_000 <= toleranceBps);
  return ok.length >= minAgree ? median(ok) : undefined;
}
