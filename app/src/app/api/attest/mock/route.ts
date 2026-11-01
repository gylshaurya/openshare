import { isAddress, isHex, keccak256, toBytes, type Address, type Hex } from "viem";
import { ProofKind, STATUS_CONFIRMED, assetIdOf, pledgeeHash } from "@openshare/shared";
import { signPledgeFacts } from "@/lib/attest";
import { DEMO_MODE, json, signers } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * DEMO_MODE only: signs mock PledgeFacts (kind = MOCK, shown with an orange MOCK badge). SPEC §10.2.
 * Body: { wallet, isin, quantity, pledgee, client, seed, pledgeRef? }  (pledgeRef re-proves an existing pledge)
 */
export async function POST(req: Request) {
  if (!DEMO_MODE) return json({ error: "mock attestor disabled" }, 403);
  const signer = signers.mock();
  if (!signer) return json({ error: "mock attestor key not configured" }, 501);
  const b = (await req.json()) as {
    wallet: Address;
    isin: string;
    quantity: number;
    pledgee: string;
    client?: string;
    seed?: string;
    pledgeRef?: Hex;
  };
  if (!isAddress(b.wallet) || !b.isin || !(b.quantity >= 0) || !b.pledgee) return json({ error: "bad input" }, 400);
  const client = b.client?.trim() || `MOCK-${b.wallet.slice(2, 8)}`;
  const facts = {
    pledgeRef: b.pledgeRef && isHex(b.pledgeRef) && b.pledgeRef.length === 66
      ? b.pledgeRef
      : keccak256(toBytes(`MOCK:${client}:${b.pledgee}:${b.isin}:${b.seed ?? ""}`)),
    assetId: assetIdOf(b.isin),
    quantity: BigInt(Math.floor(b.quantity)),
    pledgorIdHash: keccak256(toBytes(client)),
    pledgeeIdHash: pledgeeHash(b.pledgee),
    status: STATUS_CONFIRMED,
    observedAt: BigInt(Math.floor(Date.now() / 1000) - 5),
    wallet: b.wallet,
    kind: ProofKind.Mock,
  };
  return json({ proof: await signPledgeFacts(signer, facts), facts });
}
