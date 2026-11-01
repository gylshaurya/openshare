import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";
import { isAddress, type Address } from "viem";
import { CHAIN_ID, deployment, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Creates a Reclaim proof request server-side (APP_SECRET never reaches the browser) bound to the wallet via
 * the context address (docs/integrations/reclaim.md). Returns the request JSON for the browser flow.
 */
export async function POST(req: Request) {
  const appId = process.env.RECLAIM_APP_ID;
  const secret = process.env.RECLAIM_APP_SECRET;
  const providerId = process.env.RECLAIM_PROVIDER_ID;
  if (!appId || !secret || !providerId) return json({ error: "Reclaim not configured" }, 501);
  const { wallet } = (await req.json()) as { wallet: Address };
  if (!isAddress(wallet)) return json({ error: "bad wallet" }, 400);
  const request = await ReclaimProofRequest.init(appId, secret, providerId);
  request.setContext(wallet.toLowerCase(), `${CHAIN_ID}:${deployment().core}:${Date.now()}`);
  return json({ request: request.toJsonString() });
}
