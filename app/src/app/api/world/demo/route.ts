import { isAddress, keccak256, toBytes, type Address } from "viem";
import { Role } from "@openshare/shared";
import { signRole } from "@/lib/attest";
import { DEMO_MODE, json, signers } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * DEMO_MODE only: issues a RoleAttestation for a "demo identity" (nullifier derived from a typed handle),
 * labelled DEMO IDENTITY in the UI. Never available when DEMO_MODE is off (docs/integrations/world-id.md).
 */
export async function POST(req: Request) {
  if (!DEMO_MODE) return json({ error: "demo identities are disabled" }, 403);
  const signer = signers.world();
  if (!signer) return json({ error: "world attestor key not configured" }, 501);
  const { wallet, role, handle } = (await req.json()) as { wallet: Address; role: number; handle: string };
  if (!isAddress(wallet) || (role !== Role.Minter && role !== Role.Broker) || !handle?.trim()) {
    return json({ error: "bad input" }, 400);
  }
  const nullifier = BigInt(keccak256(toBytes(`demo-identity:${handle.trim().toLowerCase()}`)));
  return json(await signRole(signer, wallet, role, nullifier));
}
