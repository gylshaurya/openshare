"use client";

import { useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { useAccount } from "wagmi";
import { ArrowUpRight } from "lucide-react";
import { BrokerStatus, PledgeStatus, Role, formatUsd6, mockUSDTAbi, openShareCoreAbi, pledgeeHash } from "@openshare/shared";
import { AssetTabs } from "@/components/AssetSelect";
import { RoleGate } from "@/components/RoleGate";
import {
  AmountInput,
  AssetName,
  Button,
  Empty,
  Field,
  Note,
  PLEDGE_LABEL,
  PageHeader,
  Panel,
  ProofLabel,
  Segmented,
  StatusPill,
  TxStatus,
  brokerName,
  ticker,
} from "@/components/ui";
import { DEMO_MODE } from "@/lib/config";
import { ago, useDeployment, useSnapshot, useTx } from "@/lib/hooks";
import { KNOWN_PLEDGEES, mockProof, reclaimProof } from "@/lib/proofs";
import type { PledgeView } from "@/lib/snapshot";

type Source = "attestor" | "kite" | "reclaim";

function AddPledge() {
  const { address } = useAccount();
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const tx = useTx();
  const [assetId, setAssetId] = useState<Hex | undefined>();
  const [broker, setBroker] = useState<string>("");
  const [source, setSource] = useState<Source>(DEMO_MODE ? "attestor" : "kite");
  const [qty, setQty] = useState("100");
  const [client, setClient] = useState("");
  const [pledgee, setPledgee] = useState("");
  const [kiteProof, setKiteProof] = useState<{ proof: Hex; qty: string } | null>(null);
  const [reclaimUrl, setReclaimUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const active = useMemo(() => (s?.brokers ?? []).filter((b) => b.status === BrokerStatus.Active), [s]);
  const asset = s?.assets.find((a) => a.assetId === assetId) ?? s?.assets[0];

  useEffect(() => {
    if (!broker && active[0]) setBroker(active[0].address);
  }, [active, broker]);
  useEffect(() => {
    const b = active.find((x) => x.address === broker);
    const guess = KNOWN_PLEDGEES.find((l) => b && pledgeeHash(l) === b.pledgeeIdHash);
    if (guess) setPledgee(guess);
  }, [broker, active]);
  useEffect(() => {
    // The Zerodha callback returns the signed proof in the URL fragment (never sent to a server).
    const h = new URLSearchParams(window.location.hash.slice(1));
    const p = h.get("kite");
    if (p && h.get("mode") !== "attest") {
      setKiteProof({ proof: p as Hex, qty: h.get("qty") ?? "?" });
      setSource("kite");
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (!s || !d || !address || !asset) return null;

  const register = async (proof: Hex, verifier: Hex) => {
    const ok = await tx.send("Submitting pledge", {
      address: d.core,
      abi: openShareCoreAbi,
      functionName: "registerPledge",
      args: [verifier, proof, broker],
    });
    if (ok) setDone("Pledge submitted. It becomes active once the broker confirms it.");
  };

  const submit = async () => {
    setErr(null);
    setDone(null);
    try {
      if (source === "attestor") {
        const proof = await mockProof({ wallet: address, isin: asset.isin, quantity: Number(qty), pledgee, client: client || undefined, seed: String(Date.now()) });
        await register(proof, d.attestedVerifier);
      } else if (source === "kite") {
        if (!kiteProof) {
          window.location.href = `/api/attest/kite/login?wallet=${address}&isin=${asset.isin}`;
          return;
        }
        await register(kiteProof.proof, d.attestedVerifier);
        setKiteProof(null);
      } else {
        const proof = await reclaimProof(address, setReclaimUrl);
        await register(proof, d.reclaimVerifier);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const brokerObj = active.find((b) => b.address === broker);

  return (
    <section className="rounded-2xl border border-line bg-canvas p-5">
      <h2 className="text-[15px] font-semibold">Add a pledge</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Pledge shares to a broker at your depository first. Your shares stay in your demat account; the pledge locks them.
      </p>
      <div className="mt-5 flex flex-col gap-4">
        <Field label="Stock">
          <AssetTabs assets={s.assets} value={asset.assetId} onChange={setAssetId} />
        </Field>
        <Field label="Pledged to" hint="The pledgee on your depository pledge must be this broker's account.">
          <select value={broker} onChange={(e) => setBroker(e.target.value)}>
            {active.map((b) => (
              <option key={b.address} value={b.address}>
                {brokerName(b.name)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Verify with">
          <Segmented
            value={source}
            onChange={(v) => (setSource(v), setErr(null))}
            options={[
              ["kite", "Zerodha"],
              ["reclaim", "zkTLS"],
              ["attestor", "Pledge details"],
            ]}
          />
        </Field>

        {source === "attestor" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pledged shares">
                <AmountInput value={qty} onChange={setQty} integer />
              </Field>
              <Field label="Client ID">
                <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="AB1234" />
              </Field>
            </div>
            <Field label="Pledgee account" hint={brokerObj ? `Registered to ${brokerName(brokerObj.name)}` : undefined}>
              <input className="num" value={pledgee} onChange={(e) => setPledgee(e.target.value)} />
            </Field>
            <p className="text-[12.5px] leading-relaxed text-muted">An approved attestor signs these pledge details; the broker confirms them against its depository records before accepting.</p>
          </>
        )}
        {source === "kite" && (
          <Note>
            Sign in with Zerodha. Bull Street reads your pledged {ticker(asset.isin)} quantity from Kite, signs the result and discards
            the session.
            {kiteProof && <span className="mt-2 block font-medium text-up">Verified: {kiteProof.qty} pledged shares. Submit to continue.</span>}
          </Note>
        )}
        {source === "reclaim" && (
          <Note>
            Prove your pledge from your depository account with a zero-knowledge TLS proof. Only the stock, quantity and pledgee are
            revealed, and the proof is checked on-chain.
            {reclaimUrl && (
              <a className="mt-2 flex items-center gap-1 font-medium text-accent hover:underline" href={reclaimUrl} target="_blank" rel="noreferrer">
                Continue verification <ArrowUpRight className="size-3.5" />
              </a>
            )}
          </Note>
        )}
        <Button size="lg" className="w-full" onClick={submit} loading={!!tx.pending} disabled={!broker}>
          {source === "kite" && !kiteProof ? "Sign in with Zerodha" : "Submit pledge"}
        </Button>
        <TxStatus pending={tx.pending} error={err ?? tx.error} success={done} />
      </div>
    </section>
  );
}

function PledgeCard({ p }: { p: PledgeView }) {
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const { address } = useAccount();
  const tx = useTx();
  const [n, setN] = useState("10");
  const [proven, setProven] = useState("");
  const [more, setMore] = useState(false);
  if (!d || !s || !address) return null;
  const asset = s.assets.find((a) => a.assetId === p.assetId)!;
  const b = s.brokers.find((x) => x.address === p.broker);
  const free = p.quantity - p.minted;
  const burnable = p.minted - p.pendingRedemption;
  const amount = BigInt(n || "0");
  const fee = (amount * asset.priceUsd6 * BigInt(s.params.mintFeeBps)) / 10_000n;
  const stale = s.blockTime > p.lastAttestedAt + s.params.attestationInterval;
  const core = { address: d.core, abi: openShareCoreAbi } as const;
  const pct = p.quantity === 0n ? 0 : Number((p.minted * 1000n) / p.quantity) / 10;

  const mint = () => {
    const reqs = [];
    if (s.user && s.user.usdtAllowanceCore < fee) reqs.push({ address: d.usdt, abi: mockUSDTAbi, functionName: "approve", args: [d.core, 2n ** 255n] });
    reqs.push({ ...core, functionName: "mint", args: [p.id, amount] });
    return tx.send(`Minting ${amount} ${asset.symbol}`, ...(reqs as never[]));
  };

  const reprove = async () => {
    try {
      const label = KNOWN_PLEDGEES.find((l) => b && pledgeeHash(l) === b.pledgeeIdHash) ?? "ZERODHA-MARGIN";
      const proof = await mockProof({ wallet: address, isin: asset.isin, quantity: Number(proven || p.quantity), pledgee: label, pledgeRef: p.pledgeRef });
      await tx.send("Updating attestation", { ...core, functionName: "attest", args: [p.id, d.attestedVerifier, proof] });
    } catch (e) {
      tx.setError((e as Error).message);
    }
  };

  const tone = p.status === PledgeStatus.Active ? (p.frozen ? "down" : "up") : p.status === PledgeStatus.Proposed ? "warn" : "neutral";

  return (
    <article className="rounded-2xl border border-line bg-canvas p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <AssetName isin={asset.isin} symbol={asset.symbol} />
        <div className="flex items-center gap-2">
          <StatusPill tone={tone}>{p.frozen ? "Frozen" : PLEDGE_LABEL[p.status]}</StatusPill>
          <span className="num text-[12.5px] text-muted">#{p.id.toString()}</span>
        </div>
      </div>

      <div className="mt-5">
        <div className="h-1.5 overflow-hidden rounded-full bg-strong">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Pledged", p.quantity],
              ["Minted", p.minted],
              ["Redeeming", p.pendingRedemption],
              ["Available", free],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="num text-[16px] font-medium">{v.toLocaleString("en-US")}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-muted">
        <span>Broker: <span className="text-ink">{brokerName(b?.name)}</span></span>
        <ProofLabel kind={p.kind} />
        <span className={stale ? "text-down" : ""}>Last proven {ago(p.lastAttestedAt, s.blockTime)}</span>
      </div>

      {p.status === PledgeStatus.Proposed && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warn-soft px-4 py-3">
          <span className="text-[13px] text-warn">Waiting for the broker to confirm this pledge.</span>
          <Button variant="ghost" size="sm" onClick={() => tx.send("Cancelling", { ...core, functionName: "cancelPledge", args: [p.id] })} loading={!!tx.pending}>
            Cancel pledge
          </Button>
        </div>
      )}

      {p.status === PledgeStatus.Active && (
        <div className="mt-5 border-t border-line pt-5">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Shares" className="w-40">
              <AmountInput value={n} onChange={setN} integer unit="shares" />
            </Field>
            <Button onClick={mint} loading={!!tx.pending} disabled={amount === 0n || amount > free || p.frozen}>
              Mint
            </Button>
            <Button variant="ghost" onClick={() => tx.send("Burning", { ...core, functionName: "burn", args: [p.id, amount] })} disabled={!!tx.pending || amount === 0n || amount > burnable}>
              Burn
            </Button>
            <Button variant="ghost" onClick={() => tx.send("Releasing", { ...core, functionName: "release", args: [p.id, amount] })} disabled={!!tx.pending || amount === 0n || amount > free}>
              Release
            </Button>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            Mint fee {formatUsd6(fee)} ({(s.params.mintFeeBps / 100).toFixed(2)}%), paid to the broker. Burn returns tokens to free up shares; release
            shrinks the pledge so you can unpledge at your depository.
          </p>
          {p.kind === 3 && (
            <div className="mt-3">
              <button className="text-[12.5px] font-medium text-accent hover:underline" onClick={() => setMore((m) => !m)}>
                {more ? "Hide attestation" : "Update attestation"}
              </button>
              {more && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Field label="Pledged shares now" className="w-44">
                    <AmountInput value={proven} placeholder={p.quantity.toString()} onChange={setProven} integer />
                  </Field>
                  <Button variant="secondary" onClick={reprove} disabled={!!tx.pending}>
                    Submit attestation
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="mt-3">
            <TxStatus pending={tx.pending} error={tx.error} />
          </div>
        </div>
      )}
    </article>
  );
}

export default function MintPage() {
  const { data: s } = useSnapshot();
  const { address } = useAccount();
  const mine = (s?.pledges ?? []).filter((p) => p.minter.toLowerCase() === address?.toLowerCase() && p.status !== PledgeStatus.Closed).reverse();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Mint"
        description="Unlock liquidity from shares you keep. Pledge them to a bonded broker, mint one token per share at any hour, and sell or hold. Buying tokens back later may cost more than you sold them for."
      />
      <RoleGate role={Role.Minter}>
        <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="flex flex-col gap-4">
            <h2 className="text-[15px] font-semibold">Your pledges</h2>
            {mine.length === 0 ? (
              <Panel>
                <Empty title="No pledges yet">Add a pledge to start minting. Once the broker confirms it, you can mint up to the pledged quantity at any time.</Empty>
              </Panel>
            ) : (
              mine.map((p) => <PledgeCard key={p.id.toString()} p={p} />)
            )}
          </div>
          <div className="lg:sticky lg:top-24">
            <AddPledge />
          </div>
        </div>
      </RoleGate>
    </div>
  );
}
