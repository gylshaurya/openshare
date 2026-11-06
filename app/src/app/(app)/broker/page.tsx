"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { BrokerStatus, PledgeStatus, Role, TicketStatus, bondVaultAbi, formatBps, formatUsd6, mockUSDTAbi, openShareCoreAbi, pledgeeHash } from "@openshare/shared";
import { RoleGate } from "@/components/RoleGate";
import {
  Addr,
  AmountInput,
  Button,
  Empty,
  Field,
  PageHeader,
  Panel,
  ProofLabel,
  RatioMeter,
  Stat,
  StatusPill,
  TxStatus,
  brokerName,
  ticker,
} from "@/components/ui";
import { useDeployment, useSnapshot, useTx } from "@/lib/hooks";
import type { TicketView } from "@/lib/snapshot";

const parseUsd6 = (v: string) => BigInt(Math.round(Number(v || "0") * 1e6));

function Register() {
  const { data: d } = useDeployment();
  const tx = useTx();
  const [name, setName] = useState("");
  const [bo, setBo] = useState("");
  if (!d) return null;
  return (
    <section className="mx-auto w-full max-w-[560px] rounded-2xl border border-line bg-canvas p-6">
      <h2 className="text-[18px] font-semibold">Register as a pledge broker</h2>
      <p className="mt-1 text-[13.5px] leading-relaxed text-body">
        Shareholders pledge shares to your depository account. You confirm each pledge once, keep a USDT bond, and settle
        redemptions by selling on NSE.
      </p>
      <div className="mt-5 flex flex-col gap-4">
        <Field label="Legal name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Securities Pvt Ltd" />
        </Field>
        <Field label="Pledgee account" hint="Your CDSL BO ID. Only a hash is stored on-chain.">
          <input className="num" value={bo} onChange={(e) => setBo(e.target.value)} placeholder="1208160000000001" />
        </Field>
        <Button
          size="lg"
          disabled={!name || !bo}
          loading={!!tx.pending}
          onClick={() => tx.send("Registering broker", { address: d.core, abi: openShareCoreAbi, functionName: "registerBroker", args: [pledgeeHash(bo), name] })}
        >
          Register
        </Button>
        <TxStatus pending={tx.pending} error={tx.error} />
      </div>
    </section>
  );
}

function TicketRow({ t }: { t: TicketView }) {
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
    if (s.user && s.user.usdtAllowanceCore < payout) reqs.push({ address: d.usdt, abi: mockUSDTAbi, functionName: "approve", args: [d.core, 2n ** 255n] });
    reqs.push({ address: d.core, abi: openShareCoreAbi, functionName: "settleRedemption", args: [t.id, reported] });
    return tx.send(`Paying ticket #${t.id}`, ...(reqs as never[]));
  };
  return (
    <tr>
      <td className="num">#{t.id.toString()}</td>
      <td>
        <Addr a={t.holder} />
      </td>
      <td className="num">
        {t.shares.toString()} {ticker(a.isin, a.symbol)}
      </td>
      <td>
        <StatusPill tone={t.sessionsRemaining <= 1n ? "down" : "warn"}>{t.sessionsRemaining.toString()} sessions left</StatusPill>
      </td>
      <td>
        <div className="w-32">
          <AmountInput value={price} onChange={setPrice} placeholder={(Number(a.priceUsd6) / 1e6).toFixed(2)} unit="USD" />
        </div>
      </td>
      <td className="r">
        <div className="num font-medium">{formatUsd6(payout)}</div>
        <div className="num text-[11.5px] text-muted">floor {formatUsd6(floor)}</div>
      </td>
      <td className="r">
        <Button size="sm" onClick={settle} loading={!!tx.pending}>
          Pay
        </Button>
        {tx.error && (
          <div className="mt-1 max-w-[220px] whitespace-normal text-left">
            <TxStatus pending={null} error={tx.error} />
          </div>
        )}
      </td>
    </tr>
  );
}

function PledgeActions({ id }: { id: bigint }) {
  const { data: d } = useDeployment();
  const tx = useTx();
  if (!d) return null;
  const core = { address: d.core, abi: openShareCoreAbi } as const;
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" disabled={!!tx.pending} onClick={() => tx.send("Rejecting pledge", { ...core, functionName: "rejectPledge", args: [id] })}>
        Reject
      </Button>
      <Button size="sm" loading={!!tx.pending} onClick={() => tx.send("Confirming pledge", { ...core, functionName: "acceptPledge", args: [id] })}>
        Confirm
      </Button>
      {tx.error && <TxStatus pending={null} error={tx.error} />}
    </div>
  );
}

function BrokerConsole() {
  const { address } = useAccount();
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const tx = useTx();
  const [amt, setAmt] = useState("1000");
  if (!d || !s || !address) return null;
  const me = s.brokers.find((b) => b.address.toLowerCase() === address.toLowerCase());
  if (!me) return <Register />;

  const proposed = s.pledges.filter((p) => p.broker === me.address && p.status === PledgeStatus.Proposed);
  const active = s.pledges.filter((p) => p.broker === me.address && p.status === PledgeStatus.Active);
  const tickets = s.tickets.filter((t) => t.status === TicketStatus.Pending && s.pledges.find((p) => p.id === t.pledgeId)?.broker === me.address);
  const ratio = me.exposure === 0n ? 0 : Number(me.ratioBps) / 100;
  const req = Number(me.requiredBps) / 100;
  const healthy = me.exposure === 0n || ratio >= req;
  const amount = parseUsd6(amt);
  const asset = (id: string) => s.assets.find((a) => a.assetId === id)!;
  const ratioAfter = (extra: bigint, assetId: string) => {
    const exp = me.exposure + extra * asset(assetId).priceUsd6;
    return exp === 0n ? "–" : formatBps((me.bond * 10_000n) / exp);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-line bg-canvas p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{brokerName(me.name)}</h2>
            <StatusPill tone={me.status !== BrokerStatus.Active ? "down" : me.undercollateralizedSince > 0n ? "warn" : "up"}>
              {me.status !== BrokerStatus.Active ? "Defaulted" : me.undercollateralizedSince > 0n ? "Cure window" : "Active"}
            </StatusPill>
          </div>
          <Addr a={me.address} />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
          <Stat label="Bond" value={formatUsd6(me.bond, 0)} sub="USDT in the bond vault" />
          <Stat label="Pledged value" value={formatUsd6(me.exposure, 0)} sub="Pledged shares × NSE price" />
          <div>
            <Stat label="Coverage" value={me.exposure === 0n ? "–" : formatBps(me.ratioBps)} tone={healthy ? "up" : "down"} sub={`Minimum ${formatBps(me.requiredBps)}`} />
            {me.exposure > 0n && <RatioMeter className="mt-2" value={ratio} required={req} />}
          </div>
          <Stat label="Open redemptions" value={me.pendingTickets.toString()} tone={me.pendingTickets > 0n ? "warn" : undefined} sub="Pay within the deadline" />
        </div>
        <div className="mt-6 flex flex-wrap items-end gap-2 border-t border-line pt-5">
          <Field label="Bond amount" className="w-48">
            <AmountInput value={amt} onChange={setAmt} unit="USDT" />
          </Field>
          <Button
            loading={!!tx.pending}
            disabled={amount === 0n}
            onClick={() =>
              tx.send(
                "Depositing bond",
                { address: d.usdt, abi: mockUSDTAbi, functionName: "approve", args: [d.vault, amount] },
                { address: d.vault, abi: bondVaultAbi, functionName: "deposit", args: [amount] },
              )
            }
          >
            Deposit
          </Button>
          <Button variant="ghost" disabled={!!tx.pending || amount === 0n} onClick={() => tx.send("Withdrawing bond", { address: d.vault, abi: bondVaultAbi, functionName: "withdraw", args: [amount] })}>
            Withdraw
          </Button>
          <span className="pb-2.5 text-[12.5px] text-muted">Withdrawals must keep coverage above the minimum with no open redemptions.</span>
        </div>
        <div className="mt-2">
          <TxStatus pending={tx.pending} error={tx.error} />
        </div>
      </section>

      <Panel title="Pledges to confirm" description="Check each pledge in your depository account before confirming. Once confirmed, the shareholder can mint at any time." flush>
        {proposed.length === 0 ? (
          <Empty title="Nothing to confirm">New pledges to your account appear here for a one-time confirmation.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Pledge</th>
                <th>Shareholder</th>
                <th>Stock</th>
                <th className="r">Shares</th>
                <th>Proof</th>
                <th className="r">Coverage after</th>
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
                  <td className="font-medium">{ticker(asset(p.assetId).isin)}</td>
                  <td className="r num">{p.quantity.toLocaleString("en-US")}</td>
                  <td>
                    <ProofLabel kind={p.kind} />
                  </td>
                  <td className="r num">{ratioAfter(p.quantity, p.assetId)}</td>
                  <td className="r">
                    <PledgeActions id={p.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Redemption queue"
        description={`Invoke the pledge, sell on NSE and pay USDT within ${s.params.deadlineSessions} sessions. Missed deadlines are paid from your bond at 105%.`}
        flush
      >
        {tickets.length === 0 ? (
          <Empty title="No open redemptions">When holders redeem against your pledges, their tickets appear here with a deadline.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Holder</th>
                <th>Amount</th>
                <th>Deadline</th>
                <th>Sale price</th>
                <th className="r">Payout</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <TicketRow key={t.id.toString()} t={t} />
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Active pledges" flush>
        {active.length === 0 ? (
          <Empty title="No active pledges">Confirmed pledges are listed here with how much has been minted against them.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Pledge</th>
                <th>Shareholder</th>
                <th>Stock</th>
                <th className="r">Pledged</th>
                <th className="r">Minted</th>
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
                  <td className="font-medium">{ticker(asset(p.assetId).isin)}</td>
                  <td className="r num">{p.quantity.toLocaleString("en-US")}</td>
                  <td className="r num">{p.minted.toLocaleString("en-US")}</td>
                  <td>
                    <ProofLabel kind={p.kind} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

export default function BrokerPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Broker"
        description="Hold pledges, keep a USDT bond of at least 110% of pledged value (125% across weekends and holidays), and settle redemptions. Earn 0.10% on every mint and 0.20% on every redemption."
      />
      <RoleGate role={Role.Broker}>
        <BrokerConsole />
      </RoleGate>
    </div>
  );
}
