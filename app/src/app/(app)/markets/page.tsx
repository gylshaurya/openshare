"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { BROKER_STATUS_LABEL, BrokerStatus, PledgeStatus, SHARE, TicketStatus, formatBps, formatUsd6 } from "@openshare/shared";
import {
  Addr,
  AssetName,
  BackingMeter,
  Change,
  Empty,
  PageHeader,
  PLEDGE_LABEL,
  Panel,
  ProofLabel,
  RatioMeter,
  Segmented,
  Skeleton,
  TICKET_LABEL,
  StatusPill,
  brokerName,
  inr,
  premiumPct,
  ticker,
} from "@/components/ui";
import { ago, useDeployment, useSnapshot } from "@/lib/hooks";
import type { Snapshot } from "@/lib/snapshot";

function RuleBanner({ s }: { s: Snapshot }) {
  const broken = s.assets.filter((a) => a.supply / SHARE > a.totalPledged + a.reserveShares);
  const ok = broken.length === 0;
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border px-5 py-4 ${ok ? "border-line bg-canvas" : "border-down/30 bg-down-soft"}`}>
      <span className={`flex items-center gap-2 text-[14px] font-semibold ${ok ? "text-ink" : "text-down"}`}>
        {ok ? <CheckCircle2 className="size-4.5 text-up" aria-hidden /> : <XCircle className="size-4.5" aria-hidden />}
        {ok ? `Fully backed across all ${s.assets.length} markets` : `Backing rule broken for ${broken.map((a) => ticker(a.isin)).join(", ")}`}
      </span>
      <span className="num text-[13px] text-body">tokens ≤ shares pledged + reserve</span>
      <span className="ml-auto text-[13px] text-muted">
        Session {s.currentSessionId.toString()} · broker bond requirement {formatBps(s.requiredBondBps)}
      </span>
    </div>
  );
}

function MarketsTable({ s }: { s: Snapshot }) {
  return (
    <Panel title="Markets" description="Token prices on the OpenShare pool against the latest NSE price" flush>
      <table>
        <thead>
          <tr>
            <th>Stock</th>
            <th className="r">Token price</th>
            <th className="r">NSE price</th>
            <th className="r">vs NSE</th>
            <th className="w-[240px]">Backing</th>
            <th className="r">Pool fee</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {s.assets.map((a) => {
            const supply = a.supply / SHARE;
            return (
              <tr key={a.assetId}>
                <td>
                  <AssetName isin={a.isin} symbol={a.symbol} />
                </td>
                <td className="r num text-[14.5px] font-medium">{supply > 0n && a.poolPriceUsd6 ? formatUsd6(a.poolPriceUsd6) : <span className="font-sans text-[13px] font-normal text-muted">No liquidity</span>}</td>
                <td className="r">
                  <div className="num text-[14px]">{formatUsd6(a.priceUsd6)}</div>
                  <div className="num text-[12px] text-muted">
                    {inr(a.inrPaise)} · {ago(a.priceUpdatedAt, s.blockTime)}
                  </div>
                </td>
                <td className="r">
                  <Change pct={supply > 0n ? premiumPct(a.poolPriceUsd6, a.priceUsd6) : undefined} />
                </td>
                <td>
                  <BackingMeter tokens={supply} pledged={a.totalPledged} reserve={a.reserveShares} />
                </td>
                <td className="r num">{(a.hookFee / 10_000).toFixed(2)}%</td>
                <td className="r">
                  <Link href={`/trade?asset=${a.assetId}`} className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-accent hover:underline">
                    Trade <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function BrokersTable({ s }: { s: Snapshot }) {
  const topShare = (broker: string) => {
    const ps = s.pledges.filter((p) => p.broker === broker && p.status === PledgeStatus.Active);
    const total = ps.reduce((a, p) => a + p.quantity, 0n);
    if (total === 0n) return "–";
    const by = new Map<string, bigint>();
    ps.forEach((p) => by.set(p.minter, (by.get(p.minter) ?? 0n) + p.quantity));
    const max = [...by.values()].reduce((a, b) => (b > a ? b : a), 0n);
    return `${Number((max * 1000n) / total) / 10}%`;
  };
  return (
    <Panel title="Pledge brokers" description="Each broker's USDT bond against the value of shares pledged to it" flush>
      {s.brokers.length === 0 ? (
        <Empty title="No brokers yet">Brokers appear here once they register and post a bond.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Broker</th>
              <th>Status</th>
              <th className="r">Bond</th>
              <th className="r">Pledged value</th>
              <th className="w-[200px]">Coverage</th>
              <th className="r">Open redemptions</th>
              <th className="r">Largest minter</th>
            </tr>
          </thead>
          <tbody>
            {s.brokers.map((b) => {
              const ratio = b.exposure === 0n ? 0 : Number(b.ratioBps) / 100;
              const req = Number(b.requiredBps) / 100;
              const tone = b.status !== BrokerStatus.Active ? "down" : b.undercollateralizedSince > 0n ? "warn" : "up";
              return (
                <tr key={b.address}>
                  <td>
                    <div className="flex flex-col">
                      <span className="text-[14px] font-semibold">{brokerName(b.name)}</span>
                      <Addr a={b.address} />
                    </div>
                  </td>
                  <td>
                    <StatusPill tone={tone}>{b.undercollateralizedSince > 0n && b.status === BrokerStatus.Active ? "Cure window" : BROKER_STATUS_LABEL[b.status]}</StatusPill>
                  </td>
                  <td className="r num">{formatUsd6(b.bond, 0)}</td>
                  <td className="r num">{formatUsd6(b.exposure, 0)}</td>
                  <td>
                    {b.exposure === 0n ? (
                      <span className="text-[13px] text-muted">No pledges</span>
                    ) : (
                      <div>
                        <RatioMeter value={ratio} required={req} />
                        <div className="num mt-1.5 flex justify-between text-[11.5px] text-muted">
                          <span className={ratio >= req ? "text-up" : "text-down"}>{formatBps(b.ratioBps)}</span>
                          <span>min {formatBps(b.requiredBps)}</span>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="r num">{b.pendingTickets.toString()}</td>
                  <td className="r num">{topShare(b.address)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Activity({ s }: { s: Snapshot }) {
  const [tab, setTab] = useState<"pledges" | "redemptions">("pledges");
  const sym = (assetId: string) => {
    const a = s.assets.find((x) => x.assetId === assetId);
    return a ? ticker(a.isin, a.symbol) : "";
  };
  return (
    <Panel
      title="Activity"
      actions={
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            ["pledges", `Pledges · ${s.pledges.length}`],
            ["redemptions", `Redemptions · ${s.tickets.length}`],
          ]}
        />
      }
      flush
    >
      {tab === "pledges" ? (
        s.pledges.length === 0 ? (
          <Empty title="No pledges yet">Pledges appear here when shareholders prove a depository pledge to a broker.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Pledge</th>
                <th>Stock</th>
                <th>Minter</th>
                <th>Broker</th>
                <th className="r">Pledged</th>
                <th className="r">Minted</th>
                <th>Proof</th>
                <th>Last proven</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...s.pledges].reverse().map((p) => {
                const stale = s.blockTime > p.lastAttestedAt + s.params.attestationInterval;
                const b = s.brokers.find((x) => x.address === p.broker);
                return (
                  <tr key={p.id.toString()}>
                    <td className="num">#{p.id.toString()}</td>
                    <td className="font-medium">{sym(p.assetId)}</td>
                    <td>
                      <Addr a={p.minter} />
                    </td>
                    <td>{brokerName(b?.name)}</td>
                    <td className="r num">{p.quantity.toLocaleString("en-US")}</td>
                    <td className="r num">
                      {p.minted.toLocaleString("en-US")}
                      {p.pendingRedemption > 0n && <span className="block text-[11.5px] text-warn">{p.pendingRedemption.toString()} redeeming</span>}
                    </td>
                    <td>
                      <ProofLabel kind={p.kind} />
                    </td>
                    <td className={`text-[13px] ${stale && p.status === PledgeStatus.Active ? "text-down" : "text-body"}`}>{ago(p.lastAttestedAt, s.blockTime)}</td>
                    <td>
                      <StatusPill tone={p.status === PledgeStatus.Active ? (p.frozen ? "down" : "up") : p.status === PledgeStatus.Proposed ? "warn" : "neutral"}>
                        {p.frozen ? "Frozen" : PLEDGE_LABEL[p.status]}
                      </StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      ) : s.tickets.length === 0 ? (
        <Empty title="No redemptions yet">Redemptions appear here when holders exchange tokens for USDT.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Holder</th>
              <th className="r">Shares</th>
              <th>Pledge</th>
              <th className="r">Paid</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {[...s.tickets].reverse().map((t) => (
              <tr key={t.id.toString()}>
                <td className="num">#{t.id.toString()}</td>
                <td>
                  <Addr a={t.holder} />
                </td>
                <td className="r num">{t.shares.toString()}</td>
                <td className="num">#{t.pledgeId.toString()}</td>
                <td className="r num">{t.paidUsdt ? formatUsd6(t.paidUsdt) : "–"}</td>
                <td>
                  <StatusPill tone={t.status === TicketStatus.Settled ? "up" : t.status === TicketStatus.Defaulted ? "down" : "warn"}>
                    {TICKET_LABEL[t.status]}
                    {t.status === TicketStatus.Pending ? ` · ${t.sessionsRemaining} sessions left` : ""}
                  </StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

export default function MarketsPage() {
  const { error: depErr } = useDeployment();
  const { data: s, error } = useSnapshot();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Markets"
        description="Indian equities as tokens, each backed by a share pledged from its owner's demat account. Trade around the clock; redeem for USDT through bonded brokers."
      />
      {depErr ? (
        <Panel>
          <Empty title="Markets are unavailable">We couldn&apos;t load the protocol deployment. {(depErr as Error).message}</Empty>
        </Panel>
      ) : !s ? (
        error ? (
          <Panel>
            <Empty title="Couldn't reach the network">{(error as Error).message}</Empty>
          </Panel>
        ) : (
          <div className="flex flex-col gap-6">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-72 w-full rounded-2xl" />
            <Skeleton className="h-56 w-full rounded-2xl" />
          </div>
        )
      ) : (
        <>
          <RuleBanner s={s} />
          <MarketsTable s={s} />
          <BrokersTable s={s} />
          <Activity s={s} />
        </>
      )}
    </div>
  );
}
