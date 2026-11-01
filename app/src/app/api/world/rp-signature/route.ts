import { signRequest } from "@worldcoin/idkit-core/signing";
import { json } from "@/lib/server";

export const dynamic = "force-dynamic";
const ACTION = "openshare-role";

/** RP signature for World ID 4.0 requests (docs/integrations/world-id.md). TTL 300s. */
export async function POST(req: Request) {
  const key = process.env.WORLD_RP_SIGNING_KEY;
  if (!key) return json({ error: "WORLD_RP_SIGNING_KEY not configured" }, 501);
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action !== ACTION) return json({ error: "unknown action" }, 400);
  const s = signRequest({ signingKeyHex: key, action: ACTION });
  return json({ sig: s.sig, nonce: s.nonce, created_at: s.createdAt, expires_at: s.expiresAt });
}
