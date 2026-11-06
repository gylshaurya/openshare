"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { encodePacked, type Hex } from "viem";
import { useAccount } from "wagmi";
import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { Fingerprint, UserRoundCheck, Wallet } from "lucide-react";
import { Role, roleRegistryAbi } from "@openshare/shared";
import { DEMO_MODE, WORLD, WORLD_ENABLED } from "@/lib/config";
import { useDeployment, useSnapshot, useTx } from "@/lib/hooks";
import { Button, Field, Skeleton, TxStatus } from "./ui";

interface Signed {
  attestation: { wallet: Hex; role: number; nullifierHash: string; expiresAt: string };
  signature: Hex;
}

function GateShell({ icon, title, children }: { icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-canvas px-6 py-10 sm:px-10">
      <div className="mx-auto flex max-w-[520px] flex-col items-center text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">{icon}</span>
        <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        <div className="mt-2 w-full text-[14px] leading-relaxed text-body">{children}</div>
      </div>
    </section>
  );
}

/**
 * One human, one role (SPEC D15): World ID Proof of Human → backend verify → EIP-712 attestation →
 * RoleRegistry.register. A fallback identity route exists only when the URL carries ?identity=local.
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
  const [localIdentity, setLocalIdentity] = useState(false);
  const signedRef = useRef<Signed | null>(null);
  const roleName = role === Role.Minter ? "minter" : "broker";

  useEffect(() => {
    setLocalIdentity(DEMO_MODE && new URLSearchParams(window.location.search).get("identity") === "local");
  }, []);

  if (!address)
    return (
      <GateShell icon={<Wallet className="size-5" />} title="Connect your wallet">
        Connect a wallet on {`Whitechain`} to open the {roleName} workspace.
      </GateShell>
    );
  if (!s || !d) return <Skeleton className="h-64 w-full rounded-2xl" />;
  const current = s.user?.role ?? 0;
  if (current === role) return <>{children}</>;
  if (current !== Role.None) {
    return (
      <GateShell icon={<UserRoundCheck className="size-5" />} title={`This wallet is registered as a ${current === Role.Minter ? "minter" : "broker"}`}>
        Each verified person holds exactly one role, so no one can be both the minter and the broker of the same pledge. Switch
        to a wallet registered as a {roleName} to continue.
      </GateShell>
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

  const local = async () => {
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
    <GateShell icon={<Fingerprint className="size-5" />} title={`Verify to become a ${roleName}`}>
      <p>
        OpenShare uses World ID to confirm you are a unique person. One person can hold one role, which keeps minters and
        the brokers who hold their pledges independent. Only an anonymous identifier is stored on-chain.
      </p>
      <div className="mt-6 flex flex-col items-center gap-3">
        {WORLD_ENABLED ? (
          <Button size="lg" onClick={startWorld} loading={!!tx.pending}>
            Verify with World ID
          </Button>
        ) : (
          <p className="text-[13px] text-muted">Identity verification is unavailable on this deployment.</p>
        )}
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
            onError={(code) => setErr(code === "max_verifications_reached" ? "This person already holds an OpenShare role." : `Verification failed (${code}).`)}
          />
        )}
        {localIdentity && (
          <div className="mt-2 flex w-full max-w-[360px] items-end gap-2 text-left">
            <Field label="Identity handle" className="flex-1">
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="name" />
            </Field>
            <Button variant="ghost" onClick={local} disabled={!handle || !!tx.pending}>
              Register
            </Button>
          </div>
        )}
        <TxStatus pending={tx.pending} error={err ?? tx.error} />
      </div>
    </GateShell>
  );
}
