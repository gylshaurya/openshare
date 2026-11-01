"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { useAccount } from "wagmi";
import { SHARE, TICKET_STATUS_LABEL, TicketStatus, formatShares, formatUsd6, openShareCoreAbi } from "@openshare/shared";
import { AssetSelect } from "@/components/AssetSelect";
import { Addr, Badge, Button, Card, Empty, Field, Note, TxStatus } from "@/components/ui";
import { useDeployment, useSnapshot, useTx } from "@/lib/hooks";
import type { TicketView } from "@/lib/snapshot";

function ClaimButton({ t }: { t: TicketView }) {
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const tx = useTx();
  if (!d || !s) return null;
  const ready = t.sessionsRemaining === 0n && s.blockTime >= t.requestedAt + s.params.minDefaultDelay;
  if (t.status !== TicketStatus.Pending) return null;
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="danger"
        disabled={!ready || !!tx.pending}
        title={ready ? "Broker missed the deadline: the bond pays 105% of the last close" : "Deadline not reached"}
        onClick={() => tx.send(`Claiming default on #${t.id}`, { address: d.core, abi: openShareCoreAbi, functionName: "claimDefault", args: [t.id] })}
      >
        Claim from bond
      </Button>
      <TxStatus pending={tx.pending} error={tx.error} />
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
  if (!d || !s) return null;
  const a = s.assets.find((x) => x.assetId === (assetId ?? s.assets[0]?.assetId))!;
  const bal = s.user?.balances[a.assetId] ?? 0n;
  const shares = BigInt(n || "0");
  const min = s.params.minRedeemShares;
  const reserveInstant = shares < a.reserveShares ? shares : a.reserveShares;
  const floor = (a.closeUsd6 * BigInt(10_000 - s.params.priceBandBps)) / 10_000n;
  const mine = s.tickets.filter((t) => t.holder.toLowerCase() === address?.toLowerCase()).reverse();
  const defaultable = s.tickets.filter(
    (t) => t.status === TicketStatus.Pending && t.sessionsRemaining === 0n && s.blockTime >= t.requestedAt + s.params.minDefaultDelay,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Redeem for USDT</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Your tokens are escrowed and assigned to the oldest pledges first. The pledge broker sells the shares on the
          exchange and pays you within {s.params.deadlineSessions.toString()} trading sessions. If it doesn&apos;t, anyone can make
          its bond pay you 105% of the last close.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card title="Request redemption" right={<AssetSelect assets={s.assets} value={a.assetId} onChange={setAssetId} />}>
          <div className="flex flex-col gap-3">
            <Field label={`Shares (whole, min ${min})`} hint={`You hold ${formatShares(bal)} ${a.symbol}`}>
              <input className="num" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Note>
              Paid at the next sessions&apos; sale price (never below last close − {s.params.priceBandBps / 100}% = {formatUsd6(floor)}) minus the{" "}
              {s.params.redeemFeeBps / 100}% fee.
              {reserveInstant > 0n && (
                <span className="mt-1 block text-ok">{reserveInstant.toString()} shares will be paid instantly from the bond-funded reserve.</span>
              )}
            </Note>
            <Button
              disabled={!address || !!tx.pending || shares < min || shares * SHARE > bal}
              onClick={() => tx.send("Requesting redemption", { address: d.core, abi: openShareCoreAbi, functionName: "requestRedemption", args: [a.assetId, shares] })}
            >
              Redeem {shares.toString()} {a.symbol}
            </Button>
            <TxStatus pending={tx.pending} error={tx.error} />
          </div>
        </Card>
        <Card title="Your redemptions">
          {mine.length === 0 ? (
            <Empty>No redemptions</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Shares</th>
                  <th>Pledge → broker</th>
                  <th>Status</th>
                  <th>Paid</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {mine.map((t) => {
                  const p = s.pledges.find((x) => x.id === t.pledgeId);
                  return (
                    <tr key={t.id.toString()}>
                      <td className="num">#{t.id.toString()}</td>
                      <td className="num">{t.shares.toString()}</td>
                      <td>
                        #{t.pledgeId.toString()} → <Addr a={p?.broker} />
                      </td>
                      <td>
                        <Badge tone={t.status === 2 ? "ok" : t.status === 3 ? "bad" : "warn"}>
                          {TICKET_STATUS_LABEL[t.status]}
                          {t.status === 1 ? ` · ${t.sessionsRemaining} sessions left` : ""}
                        </Badge>
                      </td>
                      <td className="num">{t.paidUsdt ? formatUsd6(t.paidUsdt) : "—"}</td>
                      <td>
                        <ClaimButton t={t} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      {defaultable.length > 0 && (
        <Card title="Missed deadlines (anyone can trigger the bond payout)">
          <table>
            <tbody>
              {defaultable.map((t) => (
                <tr key={t.id.toString()}>
                  <td className="num">#{t.id.toString()}</td>
                  <td>
                    <Addr a={t.holder} />
                  </td>
                  <td className="num">{t.shares.toString()} shares</td>
                  <td>
                    <ClaimButton t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
