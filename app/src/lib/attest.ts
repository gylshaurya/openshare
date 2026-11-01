import { encodeAbiParameters, type Address, type Hex } from "viem";
import type { LocalAccount } from "viem/accounts";
import {
  pledgeAttestorDomain,
  pledgeFactsAbiParams,
  pledgeFactsTypes,
  roleAttestationTypes,
  roleDomain,
  type PledgeFacts,
  type RoleAttestation,
} from "@openshare/shared";
import { CHAIN_ID, deployment } from "./server";

/** Signs a RoleAttestation for RoleRegistry.register (SPEC §8.3). Expires in 1 hour. */
export async function signRole(signer: LocalAccount, wallet: Address, role: number, nullifierHash: bigint) {
  const d = deployment();
  const att: RoleAttestation = {
    wallet,
    role,
    nullifierHash,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };
  const signature = await signer.signTypedData({
    domain: roleDomain(CHAIN_ID, d.roles),
    types: roleAttestationTypes,
    primaryType: "RoleAttestation",
    message: att,
  });
  return { attestation: att, signature };
}

/** Signs PledgeFacts and returns the ABI-encoded proof for AttestedPledgeVerifier.verify (SPEC §8.6). */
export async function signPledgeFacts(signer: LocalAccount, facts: PledgeFacts): Promise<Hex> {
  const d = deployment();
  const signature = await signer.signTypedData({
    domain: pledgeAttestorDomain(CHAIN_ID, d.attestedVerifier),
    types: pledgeFactsTypes,
    primaryType: "PledgeFacts",
    message: facts,
  });
  return encodeAbiParameters(pledgeFactsAbiParams, [facts, signature]);
}
