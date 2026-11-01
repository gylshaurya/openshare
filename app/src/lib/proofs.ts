"use client";

import { encodeAbiParameters, type Address, type Hex } from "viem";
import { reclaimProofAbiParams } from "@openshare/shared";

/** Known pledgee labels so the UI can pre-fill the pledgee id that matches a broker's on-chain hash. */
export const KNOWN_PLEDGEES = ["ZERODHA-MARGIN", "1208160000000001"];

export async function mockProof(body: {
  wallet: Address;
  isin: string;
  quantity: number;
  pledgee: string;
  client?: string;
  seed?: string;
  pledgeRef?: Hex;
}): Promise<Hex> {
  const r = await fetch("/api/attest/mock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "mock attestor failed");
  return j.proof as Hex;
}

/**
 * Runs the Reclaim flow (server-initialised request, wallet-bound context) and returns the ABI-encoded
 * proof for ReclaimPledgeVerifier (docs/integrations/reclaim.md).
 */
export async function reclaimProof(wallet: Address, onUrl?: (url: string) => void): Promise<Hex> {
  const r = await fetch("/api/reclaim/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Reclaim not configured");
  const { ReclaimProofRequest, transformForOnchain } = await import("@reclaimprotocol/js-sdk");
  const req = await ReclaimProofRequest.fromJsonString(j.request);
  onUrl?.(await req.getRequestUrl());
  return await new Promise<Hex>((resolve, reject) => {
    req
      .startSession({
        onSuccess: (proofs: unknown) => {
          const proof = Array.isArray(proofs) ? proofs[0] : proofs;
          if (!proof || typeof proof === "string") return reject(new Error("no proof returned"));
          const t = transformForOnchain(proof as never) as {
            claimInfo: { provider: string; parameters: string; context: string };
            signedClaim: {
              claim: { identifier: Hex; owner: Address; timestampS: number; epoch: number };
              signatures: Hex[];
            };
          };
          resolve(encodeAbiParameters(reclaimProofAbiParams, [t as never]));
        },
        onError: (e: Error) => reject(e),
      })
      .catch(reject);
    req.triggerReclaimFlow?.().catch(() => undefined);
  });
}
