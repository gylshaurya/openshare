"use client";

import type { Hex } from "viem";
import type { AssetView } from "@/lib/snapshot";
import { AssetMark, ticker } from "./ui";

/** Compact asset switcher (pill tabs) for workspaces with a handful of listed stocks. */
export function AssetTabs({ assets, value, onChange }: { assets: AssetView[]; value?: Hex; onChange: (id: Hex) => void }) {
  return (
    <div role="tablist" aria-label="Stock" className="flex flex-wrap gap-2">
      {assets.map((a) => {
        const on = a.assetId === value;
        return (
          <button
            key={a.assetId}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(a.assetId)}
            className={`inline-flex h-10 items-center gap-2 rounded-full border pl-1.5 pr-4 text-[13.5px] font-semibold transition-colors ${
              on ? "border-ink bg-canvas text-ink" : "border-line bg-canvas text-body hover:border-[#cfd3d9]"
            }`}
          >
            <AssetMark isin={a.isin} size={28} />
            {ticker(a.isin, a.symbol)}
          </button>
        );
      })}
    </div>
  );
}

export function AssetSelect({ assets, value, onChange }: { assets: AssetView[]; value?: Hex; onChange: (id: Hex) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Hex)}>
      {assets.map((a) => (
        <option key={a.assetId} value={a.assetId}>
          {ticker(a.isin, a.symbol)} · {a.symbol}
        </option>
      ))}
    </select>
  );
}
