/**
 * Market data sources (SPEC §10.1). Only sources that offer programmatic access are used: no browser
 * impersonation, cookie warm-ups or page scraping. Each fetcher returns undefined on any failure; the
 * relay posts only when the configured number of sources respond and agree within 1% (agreedMedian).
 *
 *   Twelve Data   (TWELVEDATA_API_KEY)    symbol + exchange=NSE
 *   Alpha Vantage (ALPHAVANTAGE_API_KEY)  symbol.BSE  (BSE price as an independent cross-check)
 *   Yahoo chart   (no key, best effort; may rate-limit)
 *   FX: Frankfurter (ECB), open.er-api, Yahoo INR=X
 */
async function getJson(url: string, timeoutMs = 8000): Promise<any | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

export interface Quote {
  last?: number;
  previousClose?: number;
}

const num = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export async function yahooQuote(symbol: string): Promise<Quote | undefined> {
  const j = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
  );
  const meta = j?.chart?.result?.[0]?.meta;
  if (!meta) return undefined;
  return { last: num(meta.regularMarketPrice), previousClose: num(meta.chartPreviousClose ?? meta.previousClose) };
}

export async function twelveDataQuote(ticker: string): Promise<Quote | undefined> {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) return undefined;
  const j = await getJson(
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(ticker)}&exchange=NSE&apikey=${key}`,
  );
  if (!j || j.status === "error") return undefined;
  return { last: num(j.close), previousClose: num(j.previous_close) };
}

export async function alphaVantageQuote(ticker: string): Promise<Quote | undefined> {
  const key = process.env.ALPHAVANTAGE_API_KEY;
  if (!key) return undefined;
  const j = await getJson(
    `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}.BSE&apikey=${key}`,
  );
  const q = j?.["Global Quote"];
  if (!q) return undefined;
  return { last: num(q["05. price"]), previousClose: num(q["08. previous close"]) };
}

/** USD/INR rates from three providers. */
export async function usdInrRates(): Promise<number[]> {
  const [y, f, e] = await Promise.all([
    yahooQuote("INR=X").then((q) => q?.last),
    getJson("https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR").then((j) => num(j?.rates?.INR)),
    getJson("https://open.er-api.com/v6/latest/USD").then((j) => num(j?.rates?.INR)),
  ]);
  return [y, f, e].filter((x): x is number => x !== undefined);
}

export async function equityPrices(ticker: string, yahoo: string): Promise<{ last: number[]; close: number[] }> {
  const [t, a, y] = await Promise.all([twelveDataQuote(ticker), alphaVantageQuote(ticker), yahooQuote(yahoo)]);
  const last = [t?.last, a?.last, y?.last].filter((x): x is number => x !== undefined);
  const close = [t?.previousClose, a?.previousClose, y?.previousClose].filter((x): x is number => x !== undefined);
  return { last, close };
}
