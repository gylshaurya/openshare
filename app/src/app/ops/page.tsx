"use client";

import { useState } from "react";
import type { Address, Hex } from "viem";
import { isAddress } from "viem";
import { BrokerStatus, PledgeStatus, complianceRegistryAbi, formatUsd6, openShareCoreAbi } from "@openshare/shared";
import { AssetSelect } from "@/components/AssetSelect";
import { Addr, Badge, Button, Card, Field, Note, SourceBadge, TxStatus } from "@/components/ui";
import { DEMO_MODE } from "@/lib/config";
import { ago, useDeployment, useSnapshot, useTx } from "@/lib/hooks";
import { useQueryClient } from "@tanstack/react-query";

function useOps() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (label: string, body: object) => {
    setPending(label);
    setError(null);
    try {
      const r = await fetch("/api/ops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await qc.invalidateQueries({ queryKey: ["snapshot"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  };
  return { run, pending, error };
}

export default function OpsPage() {
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const ops = useOps();
  const tx = useTx();
  const [assetId, setAssetId] = useState<Hex | undefined>();
  const [rupees, setRupees] = useState("1512");
  const [n, setN] = useState("3");
  const [acct, setAcct] = useState("");
  if (!d || !s) return null;
  const a = s.assets.find((x) => x.assetId === (assetId ?? s.assets[0]?.assetId))!;
  const core = { address: d.core, abi: openShareCoreAbi } as const;
  const stale = s.pledges.filter((p) => p.status === PledgeStatus.Active && s.blockTime > p.lastAttestedAt + s.params.attestationInterval);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Market status and prices come from the price relay (a trusted component, labelled everywhere). Keeper actions
          below are permissionless: anyone can call them.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Market & relay" right={<Badge tone={s.marketOpen ? "ok" : "warn"}>{s.marketOpen ? "open" : s.extendedClosure ? "closed · extended" : "closed"}</Badge>}>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap gap-4 text-xs text-muted">
              <span>session #{s.currentSessionId.toString()}</span>
              <span>relay heartbeat {ago(s.lastHeartbeat, s.blockTime)}</span>
            </div>
            {DEMO_MODE ? (
              <>
                <Note tone="mock">Demo controls post with the relayer key. Prices set here are labelled MANUAL.</Note>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" disabled={!!ops.pending} onClick={() => ops.run("Opening market", { action: "open" })}>
                    Open session
                  </Button>
                  <Button variant="ghost" disabled={!!ops.pending} onClick={() => ops.run("Closing session", { action: "close" })}>
                    Close session
                  </Button>
                  <Button variant="ghost" disabled={!!ops.pending} onClick={() => ops.run("Closing for weekend", { action: "close", extended: true })}>
                    Close for weekend
                  </Button>
                  <Button variant="ghost" disabled={!!ops.pending} onClick={() => ops.run("Closing with halt", { action: "close", halted: [a.assetId] })}>
                    Close with {a.symbol} halted
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Advance sessions">
                    <input className="num w-20" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} />
                  </Field>
                  <Button variant="ghost" disabled={!!ops.pending} onClick={() => ops.run(`Advancing ${n} sessions`, { action: "advance", sessions: Number(n) })}>
                    Advance
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Stock">
                    <AssetSelect assets={s.assets} value={a.assetId} onChange={setAssetId} />
                  </Field>
                  <Field label="Price (₹)">
                    <input className="num w-28" value={rupees} onChange={(e) => setRupees(e.target.value)} />
                  </Field>
                  <Button variant="ghost" disabled={!!ops.pending} onClick={() => ops.run("Setting price", { action: "setPrice", assetId: a.assetId, rupees: Number(rupees) })}>
                    Set price
                  </Button>
                </div>
              </>
            ) : (
              <Note>Run the relay service: pnpm relay</Note>
            )}
            <TxStatus pending={ops.pending} error={ops.error} />
            <table>
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Price</th>
                  <th>Close</th>
                  <th>Sessions</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {s.assets.map((x) => (
                  <tr key={x.assetId}>
                    <td>
                      {x.symbol} {x.halted && <Badge tone="bad">halted</Badge>}
                    </td>
                    <td className="num">
                      {formatUsd6(x.priceUsd6)} <span className="text-dim">₹{(Number(x.inrPaise) / 100).toLocaleString("en-IN")}</span>
                    </td>
                    <td className="num">{formatUsd6(x.closeUsd6)}</td>
                    <td className="num">{x.sessions.toString()}</td>
                    <td>
                      <SourceBadge source={x.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Keeper actions">
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-muted">Stale pledges (no re-proof within the interval)</div>
              {stale.length === 0 ? (
                <p className="text-xs text-dim">None</p>
              ) : (
                stale.map((p) => (
                  <div key={p.id.toString()} className="flex items-center gap-2 py-1">
                    <span className="num">#{p.id.toString()}</span>
                    <Addr a={p.minter} />
                    <Button variant="ghost" onClick={() => tx.send("Flagging stale", { ...core, functionName: "flagStale", args: [p.id] })}>
                      Freeze minting
                    </Button>
                    <Button variant="danger" onClick={() => tx.send("Slashing stale pledge", { ...core, functionName: "slashStale", args: [p.id] })}>
                      Slash to reserve
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-muted">Broker collateral</div>
              {s.brokers
                .filter((b) => b.status === BrokerStatus.Active)
                .map((b) => (
                  <div key={b.address} className="flex items-center gap-2 py-1">
                    <Addr a={b.address} />
                    <span className="num text-xs text-muted">{b.exposure === 0n ? "∞" : `${Number(b.ratioBps) / 100}%`}</span>
                    {b.undercollateralizedSince > 0n && <Badge tone="bad">cure window since {ago(b.undercollateralizedSince, s.blockTime)}</Badge>}
                    <Button variant="ghost" onClick={() => tx.send("Checking collateral", { ...core, functionName: "pokeCollateral", args: [b.address] })}>
                      Check
                    </Button>
                  </div>
                ))}
            </div>
            <TxStatus pending={tx.pending} error={tx.error} />
          </div>
        </Card>

        <Card title="Compliance denylist" right={<span className="text-xs text-dim">needs COMPLIANCE_ROLE (Admin persona)</span>}>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Address">
              <input className="num w-96 max-w-full" value={acct} onChange={(e) => setAcct(e.target.value)} placeholder="0x…" />
            </Field>
            <Button
              variant="danger"
              disabled={!isAddress(acct) || !!tx.pending}
              onClick={() => tx.send("Blocking", { address: d.compliance, abi: complianceRegistryAbi, functionName: "setBlocked", args: [acct as Address, true] })}
            >
              Block
            </Button>
            <Button
              variant="ghost"
              disabled={!isAddress(acct) || !!tx.pending}
              onClick={() => tx.send("Unblocking", { address: d.compliance, abi: complianceRegistryAbi, functionName: "setBlocked", args: [acct as Address, false] })}
            >
              Unblock
            </Button>
          </div>
          <div className="mt-2">
            <Note>Blocked addresses cannot send or receive tokens, including via the pool (enforced in the token contract).</Note>
          </div>
        </Card>

        <Card title="Deployment">
          <div className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {(["core", "oracle", "vault", "roles", "compliance", "attestedVerifier", "reclaimVerifier", "poolManager", "hook", "usdt"] as const).map((k) => (
              <div key={k} className="contents">
                <span className="text-muted">{k}</span>
                <Addr a={d[k] as string} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
