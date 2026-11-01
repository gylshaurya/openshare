"use client";

import type { Hex } from "viem";
import type { AssetView } from "@/lib/snapshot";

export function AssetSelect({ assets, value, onChange }: { assets: AssetView[]; value?: Hex; onChange: (id: Hex) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Hex)}>
      {assets.map((a) => (
        <option key={a.assetId} value={a.assetId}>
          {a.symbol} · {a.isin}
        </option>
      ))}
    </select>
  );
}
