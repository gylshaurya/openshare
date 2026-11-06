import { createHash } from "node:crypto";
import { keccak256, toBytes, type Address } from "viem";
import { ProofKind, STATUS_CONFIRMED, ZERODHA_MARGIN_PLEDGEE, assetIdOf, pledgeeHash } from "@openshare/shared";
import { signPledgeFacts } from "@/lib/attest";
import { json, signers } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Kite Connect callback: exchanges request_token, reads holdings, signs PledgeFacts for the margin pledge
 * (`collateral_quantity`), discards the access token, and redirects to /mint with the proof in the URL
 * fragment (never sent to a server). Kind = TRUSTED ATTESTOR. docs/integrations/kite.md, SPEC D18.
 */
export async function GET(req: Request) {
  const apiKey = process.env.KITE_API_KEY;
  const apiSecret = process.env.KITE_API_SECRET;
  const signer = signers.kite();
  if (!apiKey || !apiSecret || !signer) return json({ error: "Kite attestor not configured" }, 501);

  const url = new URL(req.url);
  const requestToken = url.searchParams.get("request_token");
  const cookie = req.headers.get("cookie")?.match(/kite_ctx=([^;]+)/)?.[1];
  if (!requestToken || !cookie) return json({ error: "missing request_token or session" }, 400);
  const ctx = JSON.parse(Buffer.from(cookie, "base64url").toString()) as {
    wallet: Address;
    isin: string;
    state: string;
    mode: string;
  };
  if (url.searchParams.get("state") && url.searchParams.get("state") !== ctx.state) {
    return json({ error: "state mismatch" }, 400);
  }

  const checksum = createHash("sha256").update(apiKey + requestToken + apiSecret).digest("hex");
  const sess = await fetch("https://api.kite.trade/session/token", {
    method: "POST",
    headers: { "X-Kite-Version": "3", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum }),
  }).then((r) => r.json());
  const accessToken = sess?.data?.access_token as string | undefined;
  const userId = sess?.data?.user_id as string | undefined;
  if (!accessToken || !userId) return json({ error: "Kite session exchange failed", detail: sess?.message }, 400);

  const holdings = await fetch("https://api.kite.trade/portfolio/holdings", {
    headers: { "X-Kite-Version": "3", Authorization: `token ${apiKey}:${accessToken}` },
  }).then((r) => r.json());
  const h = (holdings?.data ?? []).find((x: any) => x.isin === ctx.isin);
  const qty = Math.floor(Number(h?.collateral_quantity ?? 0));

  const pledgorIdHash = keccak256(toBytes(userId));
  const assetId = assetIdOf(ctx.isin);
  const facts = {
    pledgeRef: keccak256(new Uint8Array([...toBytes("KITE"), ...toBytes(pledgorIdHash), ...toBytes(ctx.isin)])),
    assetId,
    quantity: BigInt(qty),
    pledgorIdHash,
    pledgeeIdHash: pledgeeHash(ZERODHA_MARGIN_PLEDGEE),
    status: STATUS_CONFIRMED,
    observedAt: BigInt(Math.floor(Date.now() / 1000) - 5),
    wallet: ctx.wallet,
    kind: ProofKind.Kite,
  };
  const proof = await signPledgeFacts(signer, facts);
  // Access token is not stored anywhere.
  const back = new URL("/mint", url.origin);
  back.hash = `kite=${proof}&qty=${qty}&mode=${ctx.mode}`;
  return new Response(null, {
    status: 302,
    headers: { location: back.toString(), "set-cookie": "kite_ctx=; Path=/api/attest/kite; Max-Age=0" },
  });
}
