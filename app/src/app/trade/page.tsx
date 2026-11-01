"use client";

import { useState } from "react";
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
import { AssetSelect } from "@/components/AssetSelect";
import { Badge, Button, Card, Field, Note, Stat, TxStatus } from "@/components/ui";
import { useDeployment, useSnapshot, useTx } from "@/lib/hooks";

const MAX = 2n ** 255n;
const MIN_TICK = -887220; // minUsableTick(60)
const MAX_TICK = 887220;

export default function TradePage() {
  const { address } = useAccount();
  const { data: d } = useDeployment();
  const { data: s } = useSnapshot();
  const tx = useTx();
  const [assetId, setAssetId] = useState<Hex | undefined>();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("160");
  const [lpShares, setLpShares] = useState("50");
  if (!d || !s) return null;
  const a = s.assets.find((x) => x.assetId === (assetId ?? s.assets[0]?.assetId))!;
  const key = poolKeyFor(a.token, d.usdt, d.hook);
  const usdtIs0 = key.currency0.toLowerCase() === d.usdt.toLowerCase();
  const prem = a.poolPriceUsd6 && a.priceUsd6 ? Math.round((Number(a.poolPriceUsd6) / Number(a.priceUsd6) - 1) * 10_000) / 100 || 0 : undefined;
  const feeReason = a.stale ? "oracle stale" : s.marketOpen ? "NSE open" : "NSE closed: informed-flow risk for LPs";
  const bal = s.user?.balances[a.assetId] ?? 0n;

  const swap = () => {
    const amt = side === "buy" ? BigInt(Math.round(Number(amount) * 1e6)) : BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 12n;
    const zeroForOne = side === "buy" ? usdtIs0 : !usdtIs0;
    const inToken = side === "buy" ? d.usdt : a.token;
    return tx.send(
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
  };

  const addLiquidity = () => {
    // Full-range position sized from the share amount at the oracle price (≈ amount0 = L/√P, amount1 = L·√P).
    const shares = BigInt(lpShares || "0") * SHARE;
    const usd6 = a.poolPriceUsd6 || a.priceUsd6;
    const raw = usdtIs0 ? Number(SHARE) / Number(usd6) : Number(usd6) / Number(SHARE); // currency1/currency0
    const sqrtP = Math.sqrt(raw);
    const L = usdtIs0 ? BigInt(Math.floor(Number(shares) / sqrtP)) : BigInt(Math.floor(Number(shares) * sqrtP));
    return tx.send(
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trade 24/7</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Uniswap v4 pool with the OpenShare hook. Prices are set by traders, never capped by the protocol; while the
          exchange is closed the pool charges a wider fee to protect liquidity providers.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Swap" right={<AssetSelect assets={s.assets} value={a.assetId} onChange={setAssetId} />}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Pool price" value={a.poolPriceUsd6 ? formatUsd6(a.poolPriceUsd6) : "—"} />
            <Stat label="Exchange price" value={formatUsd6(a.priceUsd6)} sub={`last close ${formatUsd6(a.closeUsd6)}`} />
            <Stat label="Premium" value={prem === undefined ? "—" : `${prem >= 0 ? "+" : ""}${prem.toFixed(2)}%`} tone={prem !== undefined && Math.abs(prem) > 3 ? "warn" : undefined} />
            <Stat label="Fee now" value={`${(a.hookFee / 10_000).toFixed(2)}%`} sub={feeReason} />
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div className="flex overflow-hidden rounded-lg border border-line">
              {(["buy", "sell"] as const).map((x) => (
                <button key={x} onClick={() => setSide(x)} className={`px-4 py-2 text-sm ${side === x ? "bg-accent text-bg" : "text-muted"}`}>
                  {x === "buy" ? "Buy" : "Sell"}
                </button>
              ))}
            </div>
            <Field label={side === "buy" ? "Pay (USDT)" : `Sell (${a.symbol})`}>
              <input className="num w-36" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Button onClick={swap} disabled={!address || !!tx.pending || !a.poolPriceUsd6}>
              {side === "buy" ? `Buy ${a.symbol}` : `Sell ${a.symbol}`}
            </Button>
          </div>
          <div className="mt-3 flex gap-4 text-xs text-muted">
            <span>
              You hold <span className="num text-ink">{formatShares(bal)}</span> {a.symbol}
            </span>
            <span>
              USDT <span className="num text-ink">{formatUsd6(s.user?.usdt ?? 0n)}</span>
            </span>
          </div>
          <div className="mt-2">
            <TxStatus pending={tx.pending} error={tx.error} />
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          <Card title="Provide liquidity">
            <div className="flex flex-col gap-3">
              <Field label={`Shares of ${a.symbol}`} hint="Full-range position with matching USDT at the pool price.">
                <input className="num" value={lpShares} onChange={(e) => setLpShares(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Button variant="ghost" onClick={addLiquidity} disabled={!address || !!tx.pending}>
                Add liquidity
              </Button>
            </div>
          </Card>
          {d.mockUsdt && (
            <Card title="Test USDT" right={<Badge tone="mock">mock</Badge>}>
              <Button
                variant="ghost"
                className="w-full"
                disabled={!address || !!tx.pending}
                onClick={() => tx.send("Minting test USDT", { address: d.usdt, abi: mockUSDTAbi, functionName: "mint", args: [address, 10_000n * 10n ** 6n] })}
              >
                Get 10,000 test USDT
              </Button>
            </Card>
          )}
          <Note>Holders on the compliance denylist cannot receive tokens: the token contract enforces it on every transfer, including pool swaps.</Note>
        </div>
      </div>
    </div>
  );
}
