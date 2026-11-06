"use client";

import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { useAccount } from "wagmi";
import {
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  SHARE,
  formatShares,
  formatUsd6,
  mockUSDTAbi,
  openShareTokenAbi,
  poolKeyFor,
  poolModifyLiquidityTestAbi,
  poolSwapTestAbi,
} from "@openshare/shared";
import { AssetTabs } from "@/components/AssetSelect";
import {
  AmountInput,
  AssetName,
  BackingMeter,
  Button,
  Change,
  Field,
  PageHeader,
  Panel,
  Segmented,
  Skeleton,
  Stat,
  TxStatus,
  inr,
  premiumPct,
  ticker,
} from "@/components/ui";
import { ago, useDeployment, useSnapshot, useTx } from "@/lib/hooks";

const MAX = 2n ** 255n;
const MIN_TICK = -887220; // minUsableTick(60)
const MAX_TICK = 887220;

export default function TradePage() {
  const { address } = useAccount();
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const tx = useTx();
  const lp = useTx();
  const faucet = useTx();
  const [assetId, setAssetId] = useState<Hex | undefined>();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [buyAmt, setBuyAmt] = useState("100");
  const [sellAmt, setSellAmt] = useState("5");
  const [lpShares, setLpShares] = useState("10");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("asset");
    if (q) setAssetId(q as Hex);
  }, []);

  if (!d || !s)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Trade" />
        <Skeleton className="h-10 w-80 rounded-full" />
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );

  const a = s.assets.find((x) => x.assetId === assetId) ?? s.assets[0];
  const t = ticker(a.isin, a.symbol);
  const key = poolKeyFor(a.token, d.usdt, d.hook);
  const usdtIs0 = key.currency0.toLowerCase() === d.usdt.toLowerCase();
  const live = a.supply > 0n && a.poolPriceUsd6 > 0n;
  const prem = live ? premiumPct(a.poolPriceUsd6, a.priceUsd6) : undefined;
  const feeReason = a.stale ? "Price feed delayed" : s.marketOpen ? "NSE open" : "NSE closed";
  const bal = s.user?.balances[a.assetId] ?? 0n;
  const usdt = s.user?.usdt ?? 0n;
  const amount = side === "buy" ? buyAmt : sellAmt;
  const price = a.poolPriceUsd6 || a.priceUsd6;
  const estimate =
    Number(amount || 0) > 0 && price > 0n
      ? side === "buy"
        ? `≈ ${(Number(amount) / (Number(price) / 1e6)).toFixed(3)} ${a.symbol}`
        : `≈ ${formatUsd6(BigInt(Math.round(Number(amount) * Number(price))))} USDT`
      : null;
  const insufficient =
    side === "buy" ? BigInt(Math.round(Number(buyAmt || 0) * 1e6)) > usdt : BigInt(Math.round(Number(sellAmt || 0) * 1e6)) * 10n ** 12n > bal;

  const swap = async () => {
    setDone(null);
    const amt = side === "buy" ? BigInt(Math.round(Number(buyAmt) * 1e6)) : BigInt(Math.round(Number(sellAmt) * 1e6)) * 10n ** 12n;
    const zeroForOne = side === "buy" ? usdtIs0 : !usdtIs0;
    const inToken = side === "buy" ? d.usdt : a.token;
    const ok = await tx.send(
      side === "buy" ? `Buying ${a.symbol}` : `Selling ${a.symbol}`,
      { address: inToken, abi: mockUSDTAbi, functionName: "approve", args: [d.swapRouter, MAX] },
      {
        address: d.swapRouter,
        abi: poolSwapTestAbi,
        functionName: "swap",
        args: [
          key,
          { zeroForOne, amountSpecified: -amt, sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n },
          { takeClaims: false, settleUsingBurn: false },
          "0x",
        ],
      },
    );
    if (ok) setDone(side === "buy" ? `Bought ${a.symbol}` : `Sold ${a.symbol}`);
  };

  const addLiquidity = () => {
    // Full-range position sized from the share amount at the pool price (amount0 = L/√P, amount1 = L·√P).
    const shares = BigInt(lpShares || "0") * SHARE;
    const usd6 = a.poolPriceUsd6 || a.priceUsd6;
    const raw = usdtIs0 ? Number(SHARE) / Number(usd6) : Number(usd6) / Number(SHARE);
    const sqrtP = Math.sqrt(raw);
    const L = usdtIs0 ? BigInt(Math.floor(Number(shares) / sqrtP)) : BigInt(Math.floor(Number(shares) * sqrtP));
    return lp.send(
      "Adding liquidity",
      { address: a.token, abi: openShareTokenAbi, functionName: "approve", args: [d.lpRouter, MAX] },
      { address: d.usdt, abi: mockUSDTAbi, functionName: "approve", args: [d.lpRouter, MAX] },
      {
        address: d.lpRouter,
        abi: poolModifyLiquidityTestAbi,
        functionName: "modifyLiquidity",
        args: [key, { tickLower: MIN_TICK, tickUpper: MAX_TICK, liquidityDelta: L, salt: "0x" + "0".repeat(64) }, "0x"],
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Trade"
        description="Buy and sell tokenized Indian stocks at any hour. Prices are set by traders on the pool; the pool fee widens while NSE is closed."
      />
      <AssetTabs assets={s.assets} value={a.assetId} onChange={setAssetId} />

      <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-6">
          <section className="rounded-2xl border border-line bg-canvas p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <AssetName isin={a.isin} symbol={a.symbol} />
              <div className="text-right">
                <div className="num text-[34px] font-normal leading-none tracking-[-0.02em]">{live ? formatUsd6(a.poolPriceUsd6) : "–"}</div>
                <div className="mt-2 text-[13px] text-muted">
                  {live ? <><Change pct={prem} /> vs NSE</> : "No liquidity yet"}
                </div>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5 md:grid-cols-4">
              <Stat label="NSE price" value={formatUsd6(a.priceUsd6)} sub={`${inr(a.inrPaise)} · ${ago(a.priceUpdatedAt, s.blockTime)}`} />
              <Stat label="Last close" value={formatUsd6(a.closeUsd6)} sub={`${a.sessions.toString()} session${a.sessions === 1n ? "" : "s"} recorded`} />
              <Stat label="Pool fee" value={`${(a.hookFee / 10_000).toFixed(2)}%`} sub={feeReason} />
              <Stat label="Tokens outstanding" value={formatShares(a.supply, 0)} sub={`${a.totalPledged.toLocaleString("en-US")} shares pledged`} />
            </div>
            <div className="mt-5 border-t border-line pt-5">
              <div className="mb-2 text-[12.5px] text-muted">Backing</div>
              <BackingMeter tokens={a.supply / SHARE} pledged={a.totalPledged} reserve={a.reserveShares} />
            </div>
          </section>

          <Panel title="Provide liquidity" description="Add a full-range position with matching USDT at the current pool price. You earn the pool fee on every trade.">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={`Amount of ${a.symbol}`} className="w-48">
                <AmountInput value={lpShares} onChange={setLpShares} unit="tokens" integer />
              </Field>
              <Button variant="secondary" onClick={addLiquidity} loading={!!lp.pending} disabled={!address || !lpShares}>
                Add liquidity
              </Button>
            </div>
            <div className="mt-3">
              <TxStatus pending={lp.pending} error={lp.error} />
            </div>
          </Panel>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          <section className="rounded-2xl border border-line bg-canvas p-5">
            <Segmented
              value={side}
              onChange={(v) => (setSide(v), setDone(null))}
              options={[
                ["buy", `Buy ${t}`],
                ["sell", `Sell ${t}`],
              ]}
            />
            <div className="mt-5 flex flex-col gap-4">
              <Field label={side === "buy" ? "You pay" : "You sell"}>
                <AmountInput value={amount} onChange={side === "buy" ? setBuyAmt : setSellAmt} unit={side === "buy" ? "USDT" : a.symbol} />
              </Field>
              <dl className="flex flex-col gap-2 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-muted">You receive</dt>
                  <dd className="num text-ink">{estimate ?? "–"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Pool fee</dt>
                  <dd className="num text-ink">{(a.hookFee / 10_000).toFixed(2)}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Available</dt>
                  <dd className="num text-ink">{side === "buy" ? `${formatUsd6(usdt)} USDT` : `${formatShares(bal)} ${a.symbol}`}</dd>
                </div>
              </dl>
              <Button size="lg" onClick={swap} loading={!!tx.pending} disabled={!address || !live || !Number(amount) || insufficient} className="w-full">
                {!address ? "Connect a wallet to trade" : !live ? "No liquidity yet" : insufficient ? "Insufficient balance" : side === "buy" ? `Buy ${a.symbol}` : `Sell ${a.symbol}`}
              </Button>
              <TxStatus pending={tx.pending} error={tx.error} success={done} />
              <p className="text-[12px] leading-relaxed text-muted">
                Pool prices can differ from NSE, especially while the exchange is closed. Any holder can redeem tokens for USDT at
                the NSE sale price through the pledge broker.
              </p>
            </div>
          </section>
          {d.mockUsdt && address && (
            <section className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-canvas px-5 py-4">
              <div>
                <div className="text-[13.5px] font-semibold">Testnet USDT</div>
                <div className="text-[12.5px] text-muted">Top up your wallet to try trading</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                loading={!!faucet.pending}
                onClick={() => faucet.send("Requesting USDT", { address: d.usdt, abi: mockUSDTAbi, functionName: "mint", args: [address, 10_000n * 10n ** 6n] })}
              >
                Get 10,000
              </Button>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
