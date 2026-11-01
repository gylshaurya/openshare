"use client";

import {
  BROKER_STATUS_LABEL,
  BrokerStatus,
  COMPANY,
  PLEDGE_STATUS_LABEL,
  PledgeStatus,
  SHARE,
  TICKET_STATUS_LABEL,
  formatBps,
  formatShares,
  formatUsd6,
} from "@openshare/shared";
import { Addr, Badge, Card, Empty, ProofBadge, SourceBadge, Stat } from "@/components/ui";
import { ago, useDeployment, useSnapshot } from "@/lib/hooks";
import type { AssetView, Snapshot } from "@/lib/snapshot";

function premium(a: AssetView) {
  if (a.poolPriceUsd6 === 0n || a.priceUsd6 === 0n) return undefined;
  return (Number(a.poolPriceUsd6) / Number(a.priceUsd6) - 1) * 100;
}

function AssetCard({ a, s }: { a: AssetView; s: Snapshot }) {
  const supplyShares = a.supply / SHARE;
  const backing = a.totalPledged + a.reserveShares;
  const ok = supplyShares <= backing;
  const capacity = s.pledges
    .filter((p) => p.assetId === a.assetId && p.status === PledgeStatus.Active && !p.frozen)
    .reduce((acc, p) => acc + (p.quantity - p.minted), 0n);
  const prem = premium(a);
  const meta = COMPANY[a.isin];
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {a.symbol}
          <span className="font-normal text-dim">{meta?.name ?? a.name}</span>
        </span>
      }
      right={ok ? <Badge tone="ok">rule holds</Badge> : <Badge tone="bad">rule broken</Badge>}
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Exchange price"
          value={formatUsd6(a.priceUsd6)}
          sub={
            <span className="flex items-center gap-1">
              ₹{(Number(a.inrPaise) / 100).toLocaleString("en-IN")} <SourceBadge source={a.source} /> {ago(a.priceUpdatedAt, s.blockTime)}
            </span>
          }
        />
        <Stat
          label="Pool price"
          value={a.poolPriceUsd6 ? formatUsd6(a.poolPriceUsd6) : "—"}
          sub={prem === undefined ? "no liquidity" : `${prem >= 0 ? "+" : ""}${prem.toFixed(2)}% vs exchange`}
          tone={prem !== undefined && Math.abs(prem) > 3 ? "warn" : undefined}
        />
        <Stat label="Tokens" value={formatShares(a.supply)} sub={`reserve-backed ${a.reserveShares}`} />
        <Stat label="Shares pledged" value={a.totalPledged.toString()} sub={`mint capacity ${capacity}`} />
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[11px] text-muted">
          <span>tokens {supplyShares.toString()} / backing {backing.toString()}</span>
          <span>
            pool fee {(a.hookFee / 10_000).toFixed(2)}% {a.stale && <Badge tone="bad">stale oracle</Badge>}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full ${ok ? "bg-ok" : "bg-bad"}`}
            style={{ width: `${backing === 0n ? 0 : Math.min(100, Number((supplyShares * 1000n) / backing) / 10)}%` }}
          />
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { error: depErr } = useDeployment();
  const { data: s, error } = useSnapshot();

  if (depErr) {
    return (
      <Card title="No deployment found">
        <p className="text-sm text-muted">{(depErr as Error).message}</p>
        <pre className="mt-3 rounded bg-surface-2 p-3 text-xs">pnpm chain   # terminal 1{"\n"}pnpm deploy:local{"\n"}pnpm dev</pre>
      </Card>
    );
  }
  if (!s) return <p className="text-sm text-dim">{error ? (error as Error).message : "Loading protocol state…"}</p>;

  const minterShare = (broker: string) => {
    const ps = s.pledges.filter((p) => p.broker === broker && p.status === PledgeStatus.Active);
    const total = ps.reduce((a, p) => a + p.quantity, 0n);
    if (total === 0n) return "—";
    const by = new Map<string, bigint>();
    ps.forEach((p) => by.set(p.minter, (by.get(p.minter) ?? 0n) + p.quantity));
    const max = [...by.values()].reduce((a, b) => (b > a ? b : a), 0n);
    return `${Number((max * 1000n) / total) / 10}%`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Every token is backed by a pledged share</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Shareholders mint against shares locked by a depository pledge, any time of day or week. Bonded brokers redeem
          tokens for USDT; if a broker fails, its bond pays. Session {s.currentSessionId.toString()} · bond requirement{" "}
          {formatBps(s.requiredBondBps)}
          {s.extendedClosure ? " (extended closure)" : ""}.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-1">
        {s.assets.map((a) => (
          <AssetCard key={a.assetId} a={a} s={s} />
        ))}
      </div>

      <Card title="Pledge brokers">
        {s.brokers.length === 0 ? (
          <Empty>No brokers yet</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Broker</th>
                  <th>Status</th>
                  <th>Bond</th>
                  <th>Exposure</th>
                  <th>Ratio</th>
                  <th>Required</th>
                  <th>Pending redemptions</th>
                  <th>Top minter share</th>
                </tr>
              </thead>
              <tbody>
                {s.brokers.map((b) => {
                  const healthy = b.exposure === 0n || b.ratioBps >= b.requiredBps;
                  return (
                    <tr key={b.address}>
                      <td>
                        <div className="flex flex-col">
                          <Addr a={b.address} />
                          <span className="text-[11px] text-dim">{b.name}</span>
                        </div>
                      </td>
                      <td>
                        <Badge tone={b.status === BrokerStatus.Active ? "ok" : "bad"}>{BROKER_STATUS_LABEL[b.status]}</Badge>
                        {b.undercollateralizedSince > 0n && <Badge tone="bad">cure window</Badge>}
                      </td>
                      <td className="num">{formatUsd6(b.bond, 0)}</td>
                      <td className="num">{formatUsd6(b.exposure, 0)}</td>
                      <td className={`num ${healthy ? "text-ok" : "text-bad"}`}>
                        {b.exposure === 0n ? "∞" : formatBps(b.ratioBps)}
                      </td>
                      <td className="num">{formatBps(b.requiredBps)}</td>
                      <td className="num">{b.pendingTickets.toString()}</td>
                      <td className="num">{minterShare(b.address)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Pledges">
          {s.pledges.length === 0 ? (
            <Empty>No pledges yet</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Minter → Broker</th>
                    <th>Pledged</th>
                    <th>Minted</th>
                    <th>Re-proof</th>
                    <th>Proof</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...s.pledges].reverse().map((p) => {
                    const stale = s.blockTime > p.lastAttestedAt + s.params.attestationInterval;
                    return (
                      <tr key={p.id.toString()}>
                        <td className="num">{p.id.toString()}</td>
                        <td>
                          <Addr a={p.minter} /> <span className="text-dim">→</span> <Addr a={p.broker} />
                        </td>
                        <td className="num">{p.quantity.toString()}</td>
                        <td className="num">
                          {p.minted.toString()}
                          {p.pendingRedemption > 0n && <span className="text-warn"> ({p.pendingRedemption.toString()} esc)</span>}
                        </td>
                        <td className={stale ? "text-bad" : "text-muted"}>{ago(p.lastAttestedAt, s.blockTime)}</td>
                        <td>
                          <ProofBadge kind={p.kind} />
                        </td>
                        <td>
                          <Badge tone={p.status === PledgeStatus.Active ? (p.frozen ? "bad" : "ok") : "neutral"}>
                            {p.frozen ? "frozen" : PLEDGE_STATUS_LABEL[p.status]}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Redemptions">
          {s.tickets.length === 0 ? (
            <Empty>No redemptions yet</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Holder</th>
                    <th>Shares</th>
                    <th>Pledge</th>
                    <th>Paid</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...s.tickets].reverse().map((t) => (
                    <tr key={t.id.toString()}>
                      <td className="num">{t.id.toString()}</td>
                      <td>
                        <Addr a={t.holder} />
                      </td>
                      <td className="num">{t.shares.toString()}</td>
                      <td className="num">#{t.pledgeId.toString()}</td>
                      <td className="num">{t.paidUsdt ? formatUsd6(t.paidUsdt) : "—"}</td>
                      <td>
                        <Badge tone={t.status === 2 ? "ok" : t.status === 3 ? "bad" : "warn"}>
                          {TICKET_STATUS_LABEL[t.status]}
                          {t.status === 1 ? ` · ${t.sessionsRemaining} sess.` : ""}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
