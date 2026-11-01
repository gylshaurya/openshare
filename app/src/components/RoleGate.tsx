"use client";

import { useRef, useState, type ReactNode } from "react";
import { encodePacked, type Hex } from "viem";
import { useAccount } from "wagmi";
import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { Role, roleRegistryAbi } from "@openshare/shared";
import { DEMO_MODE, WORLD, WORLD_ENABLED } from "@/lib/config";
import { useDeployment, useSnapshot, useTx } from "@/lib/hooks";
import { Badge, Button, Card, Field, Note, TxStatus } from "./ui";

interface Signed {
  attestation: { wallet: Hex; role: number; nullifierHash: string; expiresAt: string };
  signature: Hex;
}

/**
 * One human, one role (SPEC D15). Real flow: World ID Proof of Human via IDKit 4 → backend verify →
 * EIP-712 attestation → RoleRegistry.register. DEMO_MODE adds a clearly-labelled demo identity.
 */
export function RoleGate({ role, children }: { role: number; children: ReactNode }) {
  const { address } = useAccount();
  const { data: s } = useSnapshot();
  const { data: d } = useDeployment();
  const tx = useTx();
  const [handle, setHandle] = useState("");
  const [open, setOpen] = useState(false);
  const [rp, setRp] = useState<RpContext | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const signedRef = useRef<Signed | null>(null);
  const roleName = role === Role.Minter ? "minter" : "broker";

  if (!address) return <Card title="Connect a wallet">Connect a wallet (or pick a demo persona) to continue.</Card>;
  if (!s || !d) return null;
  const current = s.user?.role ?? 0;
  if (current === role) return <>{children}</>;
  if (current !== Role.None) {
    return (
      <Card title="Wrong role">
        <p className="text-sm text-muted">
          This wallet is registered as a {current === Role.Minter ? "minter" : "broker"}. One verified human can hold only
          one role, so the same person can never be both minter and pledgee of a pledge.
        </p>
      </Card>
    );
  }

  const register = async (signed: Signed) => {
    await tx.send(`Registering as ${roleName}`, {
      address: d.roles,
      abi: roleRegistryAbi,
      functionName: "register",
      args: [
        {
          wallet: signed.attestation.wallet,
          role: signed.attestation.role,
          nullifierHash: BigInt(signed.attestation.nullifierHash),
          expiresAt: BigInt(signed.attestation.expiresAt),
        },
        signed.signature,
      ],
    });
  };

  const demo = async () => {
    setErr(null);
    const r = await fetch("/api/world/demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: address, role, handle }),
    });
    const j = await r.json();
    if (!r.ok) return setErr(j.error);
    await register(j);
  };

  const startWorld = async () => {
    setErr(null);
    const r = await fetch("/api/world/rp-signature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: WORLD.action }),
    });
    const j = await r.json();
    if (!r.ok) return setErr(j.error);
    setRp({ rp_id: WORLD.rpId, nonce: j.nonce, created_at: j.created_at, expires_at: j.expires_at, signature: j.sig } as RpContext);
    setOpen(true);
  };

  return (
    <Card title={`Verify you are a unique human to become a ${roleName}`} right={<Badge tone="accent">World ID</Badge>}>
      <div className="flex max-w-xl flex-col gap-4">
        <p className="text-sm text-muted">
          OpenShare asks for World ID <b>Proof of Human</b>: the minimum credential that stops one person from acting as
          both minter and broker. Your wallet and role are bound into the proof; only a nullifier is stored on-chain.
        </p>
        {WORLD_ENABLED ? (
          <>
            <Button onClick={startWorld} disabled={!!tx.pending}>
              Verify with World ID
            </Button>
            {rp && (
              <IDKitRequestWidget
                open={open}
                onOpenChange={setOpen}
                app_id={WORLD.appId as `app_${string}`}
                action={WORLD.action}
                rp_context={rp}
                allow_legacy_proofs={false}
                environment={WORLD.env}
                preset={proofOfHuman({ signal: encodePacked(["uint8", "address"], [role, address]) })}
                handleVerify={async (result: IDKitResult) => {
                  const r = await fetch("/api/world/verify", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ idkitResponse: result, wallet: address, role }),
                  });
                  const j = await r.json();
                  if (!r.ok) throw new Error(j.error ?? "verification failed");
                  signedRef.current = j;
                }}
                onSuccess={() => {
                  if (signedRef.current) void register(signedRef.current);
                }}
                onError={(code) => setErr(`World ID: ${code}`)}
              />
            )}
          </>
        ) : (
          <Note>World ID is not configured on this deployment (set NEXT_PUBLIC_WORLD_APP_ID / RP_ID).</Note>
        )}
        {DEMO_MODE && (
          <div className="flex flex-col gap-2 rounded-lg border border-mock/30 p-3">
            <div className="flex items-center gap-2">
              <Badge tone="mock">demo identity</Badge>
              <span className="text-xs text-muted">Simulates a unique human for demos. Same name = same human.</span>
            </div>
            <Field label="Your name">
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="e.g. alice" />
            </Field>
            <Button variant="ghost" onClick={demo} disabled={!handle || !!tx.pending}>
              Register as {roleName} with demo identity
            </Button>
          </div>
        )}
        <TxStatus pending={tx.pending} error={err ?? tx.error} />
      </div>
    </Card>
  );
}
