import { COMPANY, PriceSource, agreedMedian, priceOracleAbi, rateToUsdInr6, rupeesToPaise } from "@openshare/shared";
import type { Hex } from "viem";
import { readOracleAsset, type Clients } from "./chain";
import { equityPrices, usdInrRates } from "./sources";
import { ist, isSessionOpen, isTradingDay, nextIsExtendedClosure, CLOSE_POST_MIN, OPEN_MIN } from "./calendar";

export interface LivePrice {
  assetId: Hex;
  ticker: string;
  inrPaise: bigint;
  closePaise?: bigint;
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[relay]", ...a);

/** Fetches USD/INR and every listed asset's price; returns undefined values where sources disagree. */
export async function fetchMarket(cl: Clients): Promise<{ usdInr6?: bigint; prices: LivePrice[] }> {
  const fx = agreedMedian(await usdInrRates(), 100, 2);
  const prices: LivePrice[] = [];
  for (const a of cl.dep.assets) {
    const meta = COMPANY[a.isin];
    if (!meta) continue;
    const { last, close } = await equityPrices(meta.nse, meta.yahoo);
    // SPEC §10.1: require RELAY_MIN_SOURCES agreeing sources (default 1 because NSE/Google often block
    // automated clients; when several sources respond they must still agree within 1%).
    const minSources = Number(process.env.RELAY_MIN_SOURCES ?? 1);
    const l = agreedMedian(last, 100, Math.max(minSources, Math.min(2, last.length)));
    if (l === undefined) {
      log(`skip ${meta.ticker}: sources disagree or unavailable`, last);
      continue;
    }
    if (last.length < 2) log(`WARN ${meta.ticker}: only ${last.length} source available`);
    await new Promise((r) => setTimeout(r, 500));
    const c = close.length ? agreedMedian(close, 100, 1) : undefined;
    prices.push({
      assetId: a.assetId,
      ticker: meta.ticker,
      inrPaise: rupeesToPaise(l),
      closePaise: c ? rupeesToPaise(c) : undefined,
    });
  }
  return { usdInr6: fx ? rateToUsdInr6(fx) : undefined, prices };
}

async function send(cl: Clients, functionName: string, args: readonly unknown[]) {
  const hash = await cl.wallet.writeContract({
    address: cl.dep.oracle,
    abi: priceOracleAbi,
    functionName: functionName as never,
    args: args as never,
    account: cl.account,
    chain: cl.chain,
  });
  const r = await cl.pub.waitForTransactionReceipt({ hash });
  log(functionName, r.status, hash);
  return r;
}

export async function pushPrices(cl: Clients, prices: LivePrice[], usdInr6: bigint, source: number = PriceSource.Relay) {
  if (!prices.length) return;
  await send(cl, "pushPrices", [prices.map((p) => ({ assetId: p.assetId, inrPaise: p.inrPaise, usdInr6, source }))]);
}

export async function setMarketOpen(cl: Clients, open: boolean) {
  await send(cl, "setMarketOpen", [open]);
}

/**
 * Closes the next session on-chain. Prices default to each asset's current on-chain INR price and FX
 * (so a manual/demo close works with no network), overridden by `overrides`.
 */
export async function closeSession(
  cl: Clients,
  opts: { extended: boolean; halted?: Set<string>; overrides?: Map<string, bigint>; usdInr6?: bigint },
) {
  const current = (await cl.pub.readContract({
    address: cl.dep.oracle,
    abi: priceOracleAbi,
    functionName: "currentSessionId",
  })) as bigint;
  const closes = [];
  for (const a of cl.dep.assets) {
    const onchain = await readOracleAsset(cl, a.assetId);
    const inr = opts.overrides?.get(a.assetId) ?? onchain.inrPaise;
    const fx = opts.usdInr6 ?? onchain.usdInr6;
    if (inr === 0n || fx === 0n) continue;
    const ticker = COMPANY[a.isin]?.ticker ?? a.symbol;
    closes.push({ assetId: a.assetId, inrPaise: inr, usdInr6: fx, traded: !opts.halted?.has(ticker) });
  }
  await send(cl, "closeSession", [current + 1n, closes, opts.extended]);
}

/**
 * Main loop (SPEC §10.1): opens the market at 09:15 IST on trading days, pushes prices every
 * `intervalMs`, closes the session at 15:45 IST with the official close, and flags extended closures.
 */
export async function runLoop(cl: Clients, intervalMs = 5 * 60_000) {
  let lastClosedDate = "";
  log(`relay started for chain ${cl.chain.id}, oracle ${cl.dep.oracle}`);
  for (;;) {
    try {
      const now = new Date();
      const p = ist(now);
      const marketOpen = (await cl.pub.readContract({
        address: cl.dep.oracle,
        abi: priceOracleAbi,
        functionName: "marketOpen",
      })) as boolean;

      if (isSessionOpen(now)) {
        if (!marketOpen) await setMarketOpen(cl, true);
        const m = await fetchMarket(cl);
        if (m.usdInr6) await pushPrices(cl, m.prices, m.usdInr6);
        else log("skip push: USD/INR sources disagree");
      } else if (isTradingDay(p.date) && p.minutes >= CLOSE_POST_MIN && lastClosedDate !== p.date && marketOpen) {
        const m = await fetchMarket(cl);
        const overrides = new Map(m.prices.map((x) => [x.assetId as string, x.inrPaise]));
        await closeSession(cl, { extended: nextIsExtendedClosure(p.date), overrides, usdInr6: m.usdInr6 });
        lastClosedDate = p.date;
      } else if (p.minutes < OPEN_MIN || !isTradingDay(p.date)) {
        // Closed: nothing to do; heartbeat in logs only.
      }
    } catch (e) {
      log("error", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
