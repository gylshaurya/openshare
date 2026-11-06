import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { encodePacked, isAddress, type Address } from "viem";
import { Role, roleRegistryAbi } from "@openshare/shared";
import { signRole } from "@/lib/attest";
import { deployment, json, publicClient, signers } from "@/lib/server";

export const dynamic = "force-dynamic";
const ACTION = "openshare-role";

/**
 * Verifies an IDKit 4.x Proof-of-Human result and returns an EIP-712 RoleAttestation (SPEC §10.3, D15).
 * The Developer Portal does not reject reused nullifiers or check the signal, so both are checked here and
 * uniqueness is enforced on-chain by RoleRegistry.
 */
export async function POST(req: Request) {
  const rpId = process.env.NEXT_PUBLIC_WORLD_RP_ID;
  const env = process.env.NEXT_PUBLIC_WORLD_ENV ?? "staging";
  const signer = signers.world();
  if (!rpId || !signer) return json({ error: "World ID not configured" }, 501);

  const { idkitResponse: r, wallet, role } = (await req.json()) as {
    idkitResponse: any;
    wallet: Address;
    role: number;
  };
  if (!isAddress(wallet) || (role !== Role.Minter && role !== Role.Broker)) return json({ error: "bad input" }, 400);
  if (r?.environment !== env || r?.protocol_version !== "4.0" || r?.action !== ACTION) {
    return json({ error: "unexpected environment, protocol or action" }, 400);
  }
  const item = r.responses?.[0];
  if (!item || item.issuer_schema_id !== 1) return json({ error: "Proof of Human credential required" }, 400);
  const expected = hashSignal(encodePacked(["uint8", "address"], [role, wallet])).toLowerCase();
  if (String(item.signal_hash).toLowerCase() !== expected) return json({ error: "signal mismatch" }, 400);

  const v = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...r, environment: env }),
  });
  const body = await v.json().catch(() => ({}));
  if (!v.ok || body.success !== true) return json({ error: "World ID verification failed", detail: body }, 400);

  const nullifier = BigInt(item.nullifier);
  const d = deployment();
  const existing = (await publicClient().readContract({
    address: d.roles,
    abi: roleRegistryAbi,
    functionName: "nullifierRole",
    args: [nullifier],
  })) as number;
  if (existing !== 0) return json({ error: "This human already holds a Bull Street role" }, 409);

  return json(await signRole(signer, wallet, role, nullifier));
}
