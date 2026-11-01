"use client";

import { useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { useAccount } from "wagmi";
import {
  BrokerStatus,
  COMPANY,
  PLEDGE_STATUS_LABEL,
  PledgeStatus,
  Role,
  formatUsd6,
  mockUSDTAbi,
  openShareCoreAbi,
  pledgeeHash,
} from "@openshare/shared";
import { AssetSelect } from "@/components/AssetSelect";
import { RoleGate } from "@/components/RoleGate";
import { Addr, Badge, Button, Card, Empty, Field, Note, ProofBadge, TxStatus } from "@/components/ui";
import { DEMO_MODE } from "@/lib/config";
import { ago, useDeployment, useSnapshot, useTx } from "@/lib/hooks";
import { KNOWN_PLEDGEES, mockProof, reclaimProof } from "@/lib/proofs";
import type { PledgeView } from "@/lib/snapshot";

type Source = "mock" | "kite" | "reclaim";

function ProvePledge() {
  const { address } = useAccount();
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const tx = useTx();
  const [assetId, setAssetId] = useState<Hex | undefined>();
  const [broker, setBroker] = useState<string>("");
  const [source, setSource] = useState<Source>(DEMO_MODE ? "mock" : "kite");
  const [qty, setQty] = useState("100");
  const [client, setClient] = useState("");
  const [pledgee, setPledgee] = useState("");
  const [kiteProof, setKiteProof] = useState<{ proof: Hex; qty: string } | null>(null);
  const [reclaimUrl, setReclaimUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const active = useMemo(() => (s?.brokers ?? []).filter((b) => b.status === BrokerStatus.Active), [s]);
  const asset = s?.assets.find((a) => a.assetId === (assetId ?? s.assets[0]?.assetId));

  useEffect(() => {
    if (!broker && active[0]) setBroker(active[0].address);
  }, [active, broker]);
  useEffect(() => {
    const b = active.find((x) => x.address === broker);
    const guess = KNOWN_PLEDGEES.find((l) => b && pledgeeHash(l) === b.pledgeeIdHash);
    if (guess) setPledgee(guess);
  }, [broker, active]);
  useEffect(() => {
    // Kite callback returns the signed proof in the URL fragment.
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
    await tx.send("Registering pledge", {
      address: d.core,
      abi: openShareCoreAbi,
      functionName: "registerPledge",
      args: [verifier, proof, broker],
    });
  };

  const submit = async () => {
    setErr(null);
    try {
      if (source === "mock") {
        const proof = await mockProof({
          wallet: address,
          isin: asset.isin,
          quantity: Number(qty),
          pledgee,
          client: client || undefined,
          seed: String(Date.now()),
        });
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

  return (
    <Card title="1 · Prove a pledge" right={<span className="text-xs text-dim">pledge created at your depository first (weekday)</span>}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Field label="Stock">
            <AssetSelect assets={s.assets} value={asset.assetId} onChange={setAssetId} />
          </Field>
          <Field label="Pledged to broker" hint="Your pledge's pledgee must be this broker's demat account.">
            <select value={broker} onChange={(e) => setBroker(e.target.value)}>
              {active.map((b) => (
                <option key={b.address} value={b.address}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Proof source">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["reclaim", "zkTLS (Reclaim)", "ok"],
                  ["kite", "Zerodha Kite API", "warn"],
                  ...(DEMO_MODE ? [["mock", "Mock", "mock"]] : []),
                ] as Array<[Source, string, "ok" | "warn" | "mock"]>
              ).map(([k, label, tone]) => (
                <button
                  key={k}
                  onClick={() => setSource(k)}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${source === k ? "border-accent bg-accent/10" : "border-line"}`}
                >
                  <Badge tone={tone}>{k === "reclaim" ? "zkTLS" : k === "kite" ? "trusted attestor" : "mock"}</Badge>{" "}
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="flex flex-col gap-3">
          {source === "mock" && (
            <>
              <Note tone="mock">Mock proof for demos: a server key signs whatever you enter. Labelled MOCK everywhere.</Note>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Pledged shares">
                  <input className="num" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} />
                </Field>
                <Field label="Your client id">
                  <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="AB1234" />
                </Field>
              </div>
              <Field label="Pledgee demat id" hint="Must hash to the broker's registered pledgee id.">
                <input value={pledgee} onChange={(e) => setPledgee(e.target.value)} />
              </Field>
            </>
          )}
          {source === "kite" && (
            <Note tone="warn">
              Log in with Zerodha. A trusted attestor reads <code>collateral_quantity</code> for {COMPANY[asset.isin]?.ticker} from the Kite API
              (a margin pledge to Zerodha, standing in for the broker) and signs it. The access token is discarded.
              {kiteProof && (
                <span className="mt-2 block text-ok">Kite proof ready: {kiteProof.qty} pledged shares. Submit to register.</span>
              )}
            </Note>
          )}
          {source === "reclaim" && (
            <Note>
              Generate a zkTLS proof of your pledge page with Reclaim. The proof is bound to your wallet and verified
              on-chain against Reclaim attestor signatures.
              {reclaimUrl && (
                <a className="mt-2 block break-all text-accent" href={reclaimUrl} target="_blank" rel="noreferrer">
                  Open Reclaim verification ↗
                </a>
              )}
            </Note>
          )}
          <Button onClick={submit} disabled={!!tx.pending || !broker}>
            {source === "kite" && !kiteProof ? "Log in with Zerodha" : "Register pledge"}
          </Button>
          <TxStatus pending={tx.pending} error={err ?? tx.error} />
        </div>
      </div>
    </Card>
  );
}

function PledgeRow({ p }: { p: PledgeView }) {
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const { address } = useAccount();
  const tx = useTx();
  const [n, setN] = useState("10");
  const [proven, setProven] = useState("");
  if (!d || !s || !address) return null;
  const asset = s.assets.find((a) => a.assetId === p.assetId)!;
  const free = p.quantity - p.minted;
  const burnable = p.minted - p.pendingRedemption;
  const amount = BigInt(n || "0");
  const fee = (amount * asset.priceUsd6 * BigInt(s.params.mintFeeBps)) / 10_000n;
  const stale = s.blockTime > p.lastAttestedAt + s.params.attestationInterval;
  const core = { address: d.core, abi: openShareCoreAbi } as const;

  const mint = () => {
    const reqs = [];
    if (s.user && s.user.usdtAllowanceCore < fee) {
      reqs.push({ address: d.usdt, abi: mockUSDTAbi, functionName: "approve", args: [d.core, 2n ** 255n] });
    }
    reqs.push({ ...core, functionName: "mint", args: [p.id, amount] });
    return tx.send(`Minting ${amount} ${asset.symbol}`, ...(reqs as never[]));
  };

  const reprove = async () => {
    try {
      const b = s.brokers.find((x) => x.address === p.broker);
      const label = KNOWN_PLEDGEES.find((l) => b && pledgeeHash(l) === b.pledgeeIdHash) ?? "ZERODHA-MARGIN";
      const proof = await mockProof({
        wallet: address,
        isin: asset.isin,
        quantity: Number(proven || p.quantity),
        pledgee: label,
        pledgeRef: p.pledgeRef,
      });
      await tx.send("Re-proving pledge", { ...core, functionName: "attest", args: [p.id, d.attestedVerifier, proof] });
    } catch (e) {
      tx.setError((e as Error).message);
    }
  };

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">#{p.id.toString()}</span>
        <span>{asset.symbol}</span>
        <span className="text-dim">→</span>
        <Addr a={p.broker} />
        <ProofBadge kind={p.kind} />
        <Badge tone={p.status === PledgeStatus.Active ? (p.frozen ? "bad" : "ok") : "neutral"}>
          {p.frozen ? "frozen" : PLEDGE_STATUS_LABEL[p.status]}
        </Badge>
        <span className={`ml-auto text-xs ${stale ? "text-bad" : "text-dim"}`}>re-proved {ago(p.lastAttestedAt, s.blockTime)}</span>
      </div>
      <div className="num mt-2 grid grid-cols-4 gap-2 text-xs text-muted">
        <span>pledged {p.quantity.toString()}</span>
        <span>minted {p.minted.toString()}</span>
        <span>escrowed {p.pendingRedemption.toString()}</span>
        <span>free {free.toString()}</span>
      </div>
      {p.status === PledgeStatus.Proposed && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-warn">Waiting for the broker to accept (one-time co-sign).</span>
          <Button variant="ghost" onClick={() => tx.send("Cancelling", { ...core, functionName: "cancelPledge", args: [p.id] })}>
            Cancel
          </Button>
        </div>
      )}
      {p.status === PledgeStatus.Active && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Shares">
            <input className="num w-24" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Button onClick={mint} disabled={!!tx.pending || amount === 0n || amount > free}>
            Mint
          </Button>
          <Button variant="ghost" onClick={() => tx.send("Burning", { ...core, functionName: "burn", args: [p.id, amount] })} disabled={!!tx.pending || amount === 0n || amount > burnable}>
            Burn
          </Button>
          <Button variant="ghost" onClick={() => tx.send("Releasing", { ...core, functionName: "release", args: [p.id, amount] })} disabled={!!tx.pending || amount === 0n || amount > free}>
            Release
          </Button>
          {p.kind === 3 && (
            <>
              <Field label="Re-prove qty" hint="lower = simulate broker taking shares">
                <input className="num w-24" value={proven} placeholder={p.quantity.toString()} onChange={(e) => setProven(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Button variant="ghost" onClick={reprove} disabled={!!tx.pending}>
                Re-prove
              </Button>
            </>
          )}
          <span className="text-xs text-dim">mint fee ≈ {formatUsd6(fee)} to broker</span>
        </div>
      )}
      <div className="mt-2">
        <TxStatus pending={tx.pending} error={tx.error} />
      </div>
    </div>
  );
}

export default function MinterPage() {
  const { data: s } = useSnapshot();
  const { address } = useAccount();
  const mine = (s?.pledges ?? []).filter((p) => p.minter.toLowerCase() === address?.toLowerCase()).reverse();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mint against your pledged shares</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Your shares stay in your demat account, locked by a pledge to a bonded broker. Mint any time, weekends included,
          and sell on the pool. You are selling exposure: buying tokens back later may cost more.
        </p>
      </div>
      <RoleGate role={Role.Minter}>
        <ProvePledge />
        <Card title="2 · Your pledges">
          {mine.length === 0 ? <Empty>No pledges yet</Empty> : <div className="flex flex-col gap-3">{mine.map((p) => <PledgeRow key={p.id.toString()} p={p} />)}</div>}
        </Card>
      </RoleGate>
    </div>
  );
}
