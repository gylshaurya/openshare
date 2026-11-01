import { PriceSource, priceOracleAbi, rupeesToPaise } from "@openshare/shared";
import type { Hex } from "viem";
import { DEMO_MODE, deployment, json, publicClient, signers, walletClient } from "@/lib/server";

export const dynamic = "force-dynamic";

type OpsAction =
  | { action: "open" }
  | { action: "close"; extended?: boolean; halted?: Hex[] }
  | { action: "setPrice"; assetId: Hex; rupees: number }
  | { action: "advance"; sessions: number };

/**
 * DEMO_MODE only: relay operations with the relayer key (labelled MANUAL in the UI). Production uses the
 * relay service (services/relay). SPEC §11.7.
 */
export async function POST(req: Request) {
  if (!DEMO_MODE) return json({ error: "ops disabled outside demo mode" }, 403);
  const relayer = signers.relayer();
  if (!relayer) return json({ error: "relayer key not configured" }, 501);
  const d = deployment();
  const pub = publicClient();
  const w = walletClient(relayer);
  const body = (await req.json()) as OpsAction;
  const oracle = { address: d.oracle, abi: priceOracleAbi } as const;

  const write = async (functionName: string, args: readonly unknown[]) => {
    const hash = await w.writeContract({ ...oracle, functionName: functionName as never, args: args as never, chain: w.chain, account: relayer });
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  };

  const closeOnce = async (extended: boolean, halted: Set<string>) => {
    const current = (await pub.readContract({ ...oracle, functionName: "currentSessionId" })) as bigint;
    const closes = [];
    for (const a of d.assets) {
      const p = (await pub.readContract({ ...oracle, functionName: "prices", args: [a.assetId] })) as unknown as readonly bigint[];
      if (p[1] === 0n || p[2] === 0n) continue;
      closes.push({ assetId: a.assetId, inrPaise: p[1], usdInr6: p[2], traded: !halted.has(a.assetId.toLowerCase()) });
    }
    return write("closeSession", [current + 1n, closes, extended]);
  };

  try {
    switch (body.action) {
      case "open":
        return json({ tx: await write("setMarketOpen", [true]) });
      case "close":
        return json({ tx: await closeOnce(Boolean(body.extended), new Set((body.halted ?? []).map((h) => h.toLowerCase()))) });
      case "advance": {
        const txs = [];
        for (let i = 0; i < Math.min(Math.max(body.sessions, 1), 10); i++) {
          await write("setMarketOpen", [true]);
          txs.push(await closeOnce(false, new Set()));
        }
        return json({ txs });
      }
      case "setPrice": {
        const p = (await pub.readContract({ ...oracle, functionName: "prices", args: [body.assetId] })) as unknown as readonly bigint[];
        const fx = p[2] && p[2] > 0n ? p[2] : 87_500_000n;
        return json({
          tx: await write("pushPrices", [[{ assetId: body.assetId, inrPaise: rupeesToPaise(body.rupees), usdInr6: fx, source: PriceSource.Manual }]]),
        });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message.split("\n")[0] }, 500);
  }
}
