import { COMPANY, PriceSource, formatUsd6, rateToUsdInr6, rupeesToPaise } from "@openshare/shared";
import { clients, readOracleAsset } from "./chain";
import { closeSession, fetchMarket, pushPrices, runLoop, setMarketOpen } from "./relay";

/**
 * OpenShare price relay CLI (SPEC §10.1).
 *   run                         loop: open/push/close following the NSE calendar
 *   once                        fetch live prices from public sources and push once
 *   status                      print on-chain oracle state
 *   open | close [--extended] [--halt TICKER,...]
 *   set-price TICKER RUPEES [--usdinr 87.5]   manual price (source = MANUAL, labelled in the UI)
 */
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cl = clients();
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? (rest[i + 1] ?? "true") : undefined;
  };

  switch (cmd) {
    case "run":
      await runLoop(cl, Number(process.env.RELAY_INTERVAL_MS ?? 300_000));
      break;
    case "once": {
      const m = await fetchMarket(cl);
      console.log(m);
      if (!m.usdInr6) throw new Error("USD/INR sources disagree or are unavailable");
      await pushPrices(cl, m.prices, m.usdInr6, PriceSource.Relay);
      break;
    }
    case "open":
      await setMarketOpen(cl, true);
      break;
    case "close": {
      const halted = new Set((flag("halt") ?? "").split(",").filter(Boolean));
      await closeSession(cl, { extended: flag("extended") !== undefined, halted });
      break;
    }
    case "set-price": {
      const [ticker, rupees] = rest;
      const asset = cl.dep.assets.find((a) => COMPANY[a.isin]?.ticker === ticker?.toUpperCase() || a.symbol === ticker);
      if (!asset || !rupees) throw new Error("usage: set-price TICKER RUPEES [--usdinr 87.5]");
      const cur = await readOracleAsset(cl, asset.assetId);
      const fx = flag("usdinr") ? rateToUsdInr6(Number(flag("usdinr"))) : cur.usdInr6 || 87_500_000n;
      await pushPrices(cl, [{ assetId: asset.assetId, ticker, inrPaise: rupeesToPaise(Number(rupees)) }], fx, PriceSource.Manual);
      break;
    }
    case "status": {
      for (const a of cl.dep.assets) {
        const s = await readOracleAsset(cl, a.assetId);
        console.log(
          a.symbol.padEnd(10),
          formatUsd6(s.usd6),
          `₹${Number(s.inrPaise) / 100}`,
          `close ${formatUsd6(s.closeUsd6)}`,
          `sessions ${s.sessions}`,
          s.halted ? "HALTED" : "",
        );
      }
      break;
    }
    default:
      console.log("commands: run | once | status | open | close [--extended] [--halt T1,T2] | set-price TICKER RUPEES");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
