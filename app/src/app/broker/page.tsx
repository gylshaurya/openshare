"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import {
  BROKER_STATUS_LABEL,
  BrokerStatus,
  PledgeStatus,
  Role,
  TicketStatus,
  bondVaultAbi,
  formatBps,
  formatUsd6,
  mockUSDTAbi,
  openShareCoreAbi,
  pledgeeHash,
} from "@openshare/shared";
import { RoleGate } from "@/components/RoleGate";
import { Addr, Badge, Button, Card, Empty, Field, Note, ProofBadge, Stat, TxStatus } from "@/components/ui";
import { useDeployment, useSnapshot, useTx } from "@/lib/hooks";
import type { TicketView } from "@/lib/snapshot";

const parseUsd6 = (v: string) => BigInt(Math.round(Number(v || "0") * 1e6));

function Register() {
  const { data: d } = useDeployment();
  const tx = useTx();
  const [name, setName] = useState("");
  const [bo, setBo] = useState("ZERODHA-MARGIN");
  if (!d) return null;
  return (
    <Card title="Register as a pledge broker">
      <div className="flex max-w-xl flex-col gap-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Securities" />
        </Field>
        <Field label="Pledgee demat id (CDSL BO id)" hint="Only its hash goes on-chain. Use ZERODHA-MARGIN to accept Kite margin-pledge proofs in demos.">
          <input value={bo} onChange={(e) => setBo(e.target.value)} />
        </Field>
        <Button
          disabled={!name || !bo || !!tx.pending}
          onClick={() => tx.send("Registering broker", { address: d.core, abi: openShareCoreAbi, functionName: "registerBroker", args: [pledgeeHash(bo), name] })}
        >
          Register
        </Button>
        <TxStatus pending={tx.pending} error={tx.error} />
      </div>
    </Card>
  );
}

function Ticket({ t }: { t: TicketView }) {
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const tx = useTx();
  const [price, setPrice] = useState("");
  if (!d || !s) return null;
  const p = s.pledges.find((x) => x.id === t.pledgeId)!;
  const a = s.assets.find((x) => x.assetId === p.assetId)!;
  const floor = (a.closeUsd6 * BigInt(10_000 - s.params.priceBandBps)) / 10_000n;
  const reported = parseUsd6(price || (Number(a.priceUsd6) / 1e6).toFixed(2));
  const per = reported > floor ? reported : floor;
  const gross = per * t.shares;
  const payout = gross - (gross * BigInt(s.params.redeemFeeBps)) / 10_000n;
  const settle = () => {
    const reqs = [];
    if (s.user && s.user.usdtAllowanceCore < payout) {
      reqs.push({ address: d.usdt, abi: mockUSDTAbi, functionName: "approve", args: [d.core, 2n ** 255n] });
    }
    reqs.push({ address: d.core, abi: openShareCoreAbi, functionName: "settleRedemption", args: [t.id, reported] });
    return tx.send(`Settling ticket #${t.id}`, ...(reqs as never[]));
  };
  return (
    <tr>
      <td className="num">#{t.id.toString()}</td>
      <td>
        <Addr a={t.holder} />
      </td>
      <td className="num">
        {t.shares.toString()} {a.symbol}
      </td>
      <td className="num">#{t.pledgeId.toString()}</td>
      <td>
        <Badge tone={t.sessionsRemaining === 0n ? "bad" : "warn"}>{t.sessionsRemaining.toString()} sessions left</Badge>
      </td>
      <td>
        <input className="num w-24 !py-1" placeholder={(Number(a.priceUsd6) / 1e6).toFixed(2)} value={price} onChange={(e) => setPrice(e.target.value)} />
      </td>
      <td className="num text-xs text-muted">
        floor {formatUsd6(floor)} → pays {formatUsd6(payout)}
      </td>
      <td>
        <Button onClick={settle} disabled={!!tx.pending}>
          Settle
        </Button>
        <TxStatus pending={tx.pending} error={tx.error} />
      </td>
    </tr>
  );
}

function BrokerConsole() {
  const { address } = useAccount();
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const tx = useTx();
  const [amt, setAmt] = useState("10000");
  if (!d || !s || !address) return null;
  const me = s.brokers.find((b) => b.address.toLowerCase() === address.toLowerCase());
  if (!me) return <Register />;

  const proposed = s.pledges.filter((p) => p.broker === me.address && p.status === PledgeStatus.Proposed);
  const active = s.pledges.filter((p) => p.broker === me.address && p.status === PledgeStatus.Active);
  const tickets = s.tickets.filter((t) => t.status === TicketStatus.Pending && s.pledges.find((p) => p.id === t.pledgeId)?.broker === me.address);
  const healthy = me.exposure === 0n || me.ratioBps >= me.requiredBps;
  const amount = parseUsd6(amt);
  const core = { address: d.core, abi: openShareCoreAbi } as const;

  const priceOf = (assetId: string) => s.assets.find((a) => a.assetId === assetId)?.priceUsd6 ?? 0n;
  const ratioAfter = (extraShares: bigint, assetId: string) => {
    const exp = me.exposure + extraShares * priceOf(assetId);
    return exp === 0n ? "∞" : formatBps((me.bond * 10_000n) / exp);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card title={me.name} right={<Badge tone={me.status === BrokerStatus.Active ? "ok" : "bad"}>{BROKER_STATUS_LABEL[me.status]}</Badge>}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Bond (USDT)" value={formatUsd6(me.bond, 0)} />
          <Stat label="Exposure" value={formatUsd6(me.exposure, 0)} sub="pledged shares × price" />
          <Stat label="Ratio" value={me.exposure === 0n ? "∞" : formatBps(me.ratioBps)} tone={healthy ? "ok" : "bad"} sub={`required ${formatBps(me.requiredBps)}`} />
          <Stat label="Pending redemptions" value={me.pendingTickets.toString()} tone={me.pendingTickets > 0n ? "warn" : undefined} />
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Field label="Amount (USDT)">
            <input className="num w-32" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </Field>
          <Button
            disabled={!!tx.pending || amount === 0n}
            onClick={() =>
              tx.send(
                "Depositing bond",
                { address: d.usdt, abi: mockUSDTAbi, functionName: "approve", args: [d.vault, amount] },
                { address: d.vault, abi: bondVaultAbi, functionName: "deposit", args: [amount] },
              )
            }
          >
            Deposit bond
          </Button>
          <Button variant="ghost" disabled={!!tx.pending || amount === 0n} onClick={() => tx.send("Withdrawing bond", { address: d.vault, abi: bondVaultAbi, functionName: "withdraw", args: [amount] })}>
            Withdraw
          </Button>
          <span className="text-xs text-dim">Withdrawals must keep the ratio ≥ requirement and need zero pending redemptions.</span>
        </div>
        <div className="mt-2">
          <TxStatus pending={tx.pending} error={tx.error} />
        </div>
      </Card>

      <Card title="Pledges awaiting your co-signature">
        {proposed.length === 0 ? (
          <Empty>Nothing to accept</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Minter</th>
                <th>Stock</th>
                <th>Shares</th>
                <th>Proof</th>
                <th>Ratio after</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {proposed.map((p) => (
                <tr key={p.id.toString()}>
                  <td className="num">#{p.id.toString()}</td>
                  <td>
                    <Addr a={p.minter} />
                  </td>
                  <td>{s.assets.find((a) => a.assetId === p.assetId)?.symbol}</td>
                  <td className="num">{p.quantity.toString()}</td>
                  <td>
                    <ProofBadge kind={p.kind} />
                  </td>
                  <td className="num">{ratioAfter(p.quantity, p.assetId)}</td>
                  <td className="flex gap-2">
                    <Button onClick={() => tx.send("Accepting pledge", { ...core, functionName: "acceptPledge", args: [p.id] })} disabled={!!tx.pending}>
                      Accept
                    </Button>
                    <Button variant="ghost" onClick={() => tx.send("Rejecting pledge", { ...core, functionName: "rejectPledge", args: [p.id] })} disabled={!!tx.pending}>
                      Reject
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-3">
          <Note>Check the pledge at the depository before accepting. After acceptance the minter can mint at any time without you.</Note>
        </div>
      </Card>

      <Card title="Redemption queue" right={<span className="text-xs text-dim">invoke → sell on NSE → pay USDT within 3 sessions, or your bond pays 105%</span>}>
        {tickets.length === 0 ? (
          <Empty>No pending redemptions</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Holder</th>
                  <th>Shares</th>
                  <th>Pledge</th>
                  <th>Deadline</th>
                  <th>Sale price ($)</th>
                  <th>Payout</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <Ticket key={t.id.toString()} t={t} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Active pledges">
        {active.length === 0 ? (
          <Empty>None</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Minter</th>
                <th>Pledged</th>
                <th>Minted</th>
                <th>Proof</th>
              </tr>
            </thead>
            <tbody>
              {active.map((p) => (
                <tr key={p.id.toString()}>
                  <td className="num">#{p.id.toString()}</td>
                  <td>
                    <Addr a={p.minter} />
                  </td>
                  <td className="num">{p.quantity.toString()}</td>
                  <td className="num">{p.minted.toString()}</td>
                  <td>
                    <ProofBadge kind={p.kind} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export default function BrokerPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pledge broker console</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Hold pledges, keep a USDT bond of at least 110% of pledged value (125% over weekends and holidays), and settle
          redemptions. Earn 0.10% on mints and 0.20% on redemptions.
        </p>
      </div>
      <RoleGate role={Role.Broker}>
        <BrokerConsole />
      </RoleGate>
    </div>
  );
}
