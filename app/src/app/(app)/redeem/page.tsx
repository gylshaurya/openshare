"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { useAccount } from "wagmi";
import { SHARE, TicketStatus, formatShares, formatUsd6, openShareCoreAbi } from "@openshare/shared";
import { AssetTabs } from "@/components/AssetSelect";
import {
  Addr,
  AmountInput,
  Button,
  Empty,
  Field,
  Note,
  PageHeader,
  Panel,
  Skeleton,
  StatusPill,
  TICKET_LABEL,
  TxStatus,
  brokerName,
} from "@/components/ui";
import { useDeployment, useSnapshot, useTx } from "@/lib/hooks";
import type { TicketView } from "@/lib/snapshot";

function ClaimButton({ t }: { t: TicketView }) {
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const tx = useTx();
  if (!d || !s || t.status !== TicketStatus.Pending) return null;
  const ready = t.sessionsRemaining === 0n && s.blockTime >= t.requestedAt + s.params.minDefaultDelay;
  if (!ready) return null;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="danger"
        size="sm"
        loading={!!tx.pending}
        title="The broker missed the deadline: its bond pays 105% of the last close"
        onClick={() => tx.send(`Claiming from bond`, { address: d.core, abi: openShareCoreAbi, functionName: "claimDefault", args: [t.id] })}
      >
        Claim from bond
      </Button>
      <TxStatus pending={null} error={tx.error} />
    </span>
  );
}

export default function RedeemPage() {
  const { address } = useAccount();
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const tx = useTx();
  const [assetId, setAssetId] = useState<Hex | undefined>();
  const [n, setN] = useState("10");
  const [done, setDone] = useState<string | null>(null);

  if (!d || !s)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Redeem" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );

  const a = s.assets.find((x) => x.assetId === assetId) ?? s.assets[0];
  const bal = s.user?.balances[a.assetId] ?? 0n;
  const shares = BigInt(n || "0");
  const min = s.params.minRedeemShares;
  const reserveInstant = shares < a.reserveShares ? shares : a.reserveShares;
  const floor = (a.closeUsd6 * BigInt(10_000 - s.params.priceBandBps)) / 10_000n;
  const estimate = shares * (a.priceUsd6 > floor ? a.priceUsd6 : floor);
  const estimateNet = estimate - (estimate * BigInt(s.params.redeemFeeBps)) / 10_000n;
  const mine = s.tickets.filter((t) => t.holder.toLowerCase() === address?.toLowerCase()).reverse();
  const others = s.tickets.filter(
    (t) =>
      t.holder.toLowerCase() !== address?.toLowerCase() &&
      t.status === TicketStatus.Pending &&
      t.sessionsRemaining === 0n &&
      s.blockTime >= t.requestedAt + s.params.minDefaultDelay,
  );
  const tooFew = shares < min;
  const tooMany = shares * SHARE > bal;

  const redeem = async () => {
    setDone(null);
    const ok = await tx.send("Requesting redemption", {
      address: d.core,
      abi: openShareCoreAbi,
      functionName: "requestRedemption",
      args: [a.assetId, shares],
    });
    if (ok) setDone(`Redemption requested for ${shares} ${a.symbol}`);
  };

  const ticketRow = (t: TicketView, claimOnly = false) => {
    const p = s.pledges.find((x) => x.id === t.pledgeId);
    const b = s.brokers.find((x) => x.address === p?.broker);
    const asset = s.assets.find((x) => x.assetId === p?.assetId);
    return (
      <tr key={t.id.toString()}>
        <td className="num">#{t.id.toString()}</td>
        <td className="num">
          {t.shares.toString()} {asset?.symbol}
        </td>
        <td>{brokerName(b?.name)}</td>
        {claimOnly ? (
          <td>
            <Addr a={t.holder} />
          </td>
        ) : (
          <td>
            <StatusPill tone={t.status === TicketStatus.Settled ? "up" : t.status === TicketStatus.Defaulted ? "down" : "warn"}>
              {TICKET_LABEL[t.status]}
              {t.status === TicketStatus.Pending ? ` · ${t.sessionsRemaining} sessions left` : ""}
            </StatusPill>
          </td>
        )}
        <td className="r num">{t.paidUsdt ? formatUsd6(t.paidUsdt) : "–"}</td>
        <td className="r">
          <ClaimButton t={t} />
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Redeem"
        description={`Exchange tokens for USDT. The pledge broker sells the underlying shares on NSE and pays you within ${s.params.deadlineSessions} trading sessions. If it misses the deadline, its bond pays you 105% of the last close.`}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.5fr]">
        <section className="rounded-2xl border border-line bg-canvas p-5">
          <h2 className="text-[15px] font-semibold">Request redemption</h2>
          <div className="mt-4">
            <AssetTabs assets={s.assets} value={a.assetId} onChange={setAssetId} />
          </div>
          <div className="mt-5 flex flex-col gap-4">
            <Field label="Shares to redeem" hint={`Whole shares, minimum ${min}. You hold ${formatShares(bal)} ${a.symbol}.`}>
              <AmountInput value={n} onChange={setN} unit={a.symbol} integer />
            </Field>
            <dl className="flex flex-col gap-2 rounded-xl bg-soft px-4 py-3 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-muted">Estimated payout</dt>
                <dd className="num font-medium text-ink">{shares > 0n ? `${formatUsd6(estimateNet)} USDT` : "–"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Price floor</dt>
                <dd className="num text-ink">{formatUsd6(floor)} / share</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Redemption fee</dt>
                <dd className="num text-ink">{(s.params.redeemFeeBps / 100).toFixed(2)}%</dd>
              </div>
            </dl>
            {reserveInstant > 0n && <Note tone="accent">{reserveInstant.toString()} shares will be paid immediately from the bond-funded reserve.</Note>}
            <Button size="lg" className="w-full" loading={!!tx.pending} disabled={!address || tooFew || tooMany} onClick={redeem}>
              {!address ? "Connect a wallet" : tooMany ? "Insufficient balance" : tooFew ? `Minimum ${min} shares` : `Redeem ${shares} ${a.symbol}`}
            </Button>
            <TxStatus pending={tx.pending} error={tx.error} success={done} />
            <p className="text-[12px] leading-relaxed text-muted">
              You&apos;re paid the NSE sale price over the next sessions, never less than the last close minus {s.params.priceBandBps / 100}%,
              minus the fee. Tokens are held in escrow until payment.
            </p>
          </div>
        </section>

        <div className="flex flex-col gap-6">
          <Panel title="Your redemptions" flush>
            {mine.length === 0 ? (
              <Empty title="No redemptions yet">Requests you make appear here with their deadline and payout.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Amount</th>
                    <th>Broker</th>
                    <th>Status</th>
                    <th className="r">Paid</th>
                    <th />
                  </tr>
                </thead>
                <tbody>{mine.map((t) => ticketRow(t))}</tbody>
              </table>
            )}
          </Panel>
          {others.length > 0 && (
            <Panel title="Missed deadlines" description="Anyone can trigger the bond payout for redemptions past their deadline." flush>
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Amount</th>
                    <th>Broker</th>
                    <th>Holder</th>
                    <th className="r">Paid</th>
                    <th />
                  </tr>
                </thead>
                <tbody>{others.map((t) => ticketRow(t, true))}</tbody>
              </table>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
