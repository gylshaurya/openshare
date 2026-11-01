import { isAddress } from "viem";
import { json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Starts the Kite Connect login (docs/integrations/kite.md). Stores wallet + ISIN + CSRF state in a cookie. */
export async function GET(req: Request) {
  const apiKey = process.env.KITE_API_KEY;
  if (!apiKey) return json({ error: "KITE_API_KEY not configured" }, 501);
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet") ?? "";
  const isin = url.searchParams.get("isin") ?? "";
  const mode = url.searchParams.get("mode") === "attest" ? "attest" : "register";
  if (!isAddress(wallet) || !isin) return json({ error: "wallet and isin required" }, 400);
  const state = crypto.randomUUID();
  const cookie = Buffer.from(JSON.stringify({ wallet, isin, state, mode })).toString("base64url");
  const login = `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(apiKey)}&redirect_params=${encodeURIComponent(`state=${state}`)}`;
  return new Response(null, {
    status: 302,
    headers: {
      location: login,
      "set-cookie": `kite_ctx=${cookie}; Path=/api/attest/kite; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}
