"use client";

import { useState } from "react";
import type { Address, Hex } from "viem";
import { isAddress } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { BrokerStatus, PledgeStatus, complianceRegistryAbi, formatUsd6, openShareCoreAbi } from "@openshare/shared";
import { AssetSelect } from "@/components/AssetSelect";
import { Addr, AmountInput, Button, Field, PageHeader, Panel, Skeleton, StatusPill, TxStatus, brokerName, inr, ticker } from "@/components/ui";
import { DEMO_MODE } from "@/lib/config";
import { ago, useDeployment, useSnapshot, useTx } from "@/lib/hooks";

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
  if (!d || !s)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Operations" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  const a = s.assets.find((x) => x.assetId === assetId) ?? s.assets[0];
  const core = { address: d.core, abi: openShareCoreAbi } as const;
  const stale = s.pledges.filter((p) => p.status === PledgeStatus.Active && s.blockTime > p.lastAttestedAt + s.params.attestationInterval);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Operations"
        description="Market sessions, price feed and keeper actions. Keeper actions are permissionless: any account can run them."
      />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title="Market sessions" description={`Session ${s.currentSessionId} · feed heartbeat ${ago(s.lastHeartbeat, s.blockTime)}`}>
          {DEMO_MODE && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" disabled={!!ops.pending} onClick={() => ops.run("Opening session", { action: "open" })}>
                  Open session
                </Button>
                <Button variant="secondary" size="sm" disabled={!!ops.pending} onClick={() => ops.run("Closing session", { action: "close" })}>
                  Close session
                </Button>
                <Button variant="secondary" size="sm" disabled={!!ops.pending} onClick={() => ops.run("Closing for weekend", { action: "close", extended: true })}>
                  Close for weekend
                </Button>
                <Button variant="secondary" size="sm" disabled={!!ops.pending} onClick={() => ops.run("Closing with halt", { action: "close", halted: [a.assetId] })}>
                  Close with {ticker(a.isin)} halted
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Advance sessions" className="w-36">
                  <AmountInput value={n} onChange={setN} integer />
                </Field>
                <Button variant="ghost" disabled={!!ops.pending} onClick={() => ops.run(`Advancing ${n} sessions`, { action: "advance", sessions: Number(n) })}>
                  Advance
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Stock" className="w-48">
                  <AssetSelect assets={s.assets} value={a.assetId} onChange={setAssetId} />
                </Field>
                <Field label="Price" className="w-36">
                  <AmountInput value={rupees} onChange={setRupees} unit="₹" />
                </Field>
                <Button variant="ghost" disabled={!!ops.pending} onClick={() => ops.run("Updating price", { action: "setPrice", assetId: a.assetId, rupees: Number(rupees) })}>
                  Update price
                </Button>
              </div>
              <TxStatus pending={ops.pending} error={ops.error} />
            </div>
          )}
          <div className="-mx-5 mt-4 border-t border-line">
            <table>
              <thead>
                <tr>
                  <th>Stock</th>
                  <th className="r">Price</th>
                  <th className="r">Close</th>
                  <th className="r">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {s.assets.map((x) => (
                  <tr key={x.assetId}>
                    <td className="font-medium">
                      {ticker(x.isin)} {x.halted && <StatusPill tone="down">Halted</StatusPill>}
                    </td>
                    <td className="r">
                      <div className="num">{formatUsd6(x.priceUsd6)}</div>
                      <div className="num text-[12px] text-muted">{inr(x.inrPaise)}</div>
                    </td>
                    <td className="r num">{formatUsd6(x.closeUsd6)}</td>
                    <td className="r num">{x.sessions.toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Stale pledges" description="Pledges not re-proven within the attestation interval">
            {stale.length === 0 ? (
              <p className="text-[13px] text-muted">All active pledges are within their attestation interval.</p>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {stale.map((p) => (
                  <div key={p.id.toString()} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="num">#{p.id.toString()}</span>
                    <Addr a={p.minter} />
                    <span className="ml-auto flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => tx.send("Freezing minting", { ...core, functionName: "flagStale", args: [p.id] })}>
                        Freeze minting
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => tx.send("Moving to reserve", { ...core, functionName: "slashStale", args: [p.id] })}>
                        Move to reserve
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Broker collateral" description="Start the cure window for any broker below its bond minimum">
            <div className="flex flex-col divide-y divide-line">
              {s.brokers
                .filter((b) => b.status === BrokerStatus.Active)
                .map((b) => (
                  <div key={b.address} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="font-medium">{brokerName(b.name)}</span>
                    <span className="num text-[13px] text-muted">{b.exposure === 0n ? "No pledges" : `${(Number(b.ratioBps) / 100).toFixed(2)}%`}</span>
                    {b.undercollateralizedSince > 0n && <StatusPill tone="warn">Cure window since {ago(b.undercollateralizedSince, s.blockTime)}</StatusPill>}
                    <Button className="ml-auto" variant="ghost" size="sm" onClick={() => tx.send("Checking collateral", { ...core, functionName: "pokeCollateral", args: [b.address] })}>
                      Check
                    </Button>
                  </div>
                ))}
            </div>
            <div className="mt-2">
              <TxStatus pending={tx.pending} error={tx.error} />
            </div>
          </Panel>
          <Panel title="Compliance" description="Blocked accounts cannot send or receive tokens, including through the pool.">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Account" className="min-w-[260px] flex-1">
                <input className="num" value={acct} onChange={(e) => setAcct(e.target.value)} placeholder="0x…" />
              </Field>
              <Button
                variant="danger"
                disabled={!isAddress(acct) || !!tx.pending}
                onClick={() => tx.send("Blocking account", { address: d.compliance, abi: complianceRegistryAbi, functionName: "setBlocked", args: [acct as Address, true] })}
              >
                Block
              </Button>
              <Button
                variant="ghost"
                disabled={!isAddress(acct) || !!tx.pending}
                onClick={() => tx.send("Unblocking account", { address: d.compliance, abi: complianceRegistryAbi, functionName: "setBlocked", args: [acct as Address, false] })}
              >
                Unblock
              </Button>
            </div>
          </Panel>
        </div>

        <Panel title="Contracts" className="lg:col-span-2">
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {(["core", "oracle", "vault", "roles", "compliance", "attestedVerifier", "reclaimVerifier", "poolManager", "hook", "usdt"] as const).map((k) => (
              <div key={k} className="flex items-center justify-between gap-4 border-b border-line py-2">
                <dt className="text-[13px] text-muted">{k}</dt>
                <dd>
                  <Addr a={d[k] as string} label={(d[k] as string).slice(0, 10) + "…" + (d[k] as string).slice(-6)} />
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
