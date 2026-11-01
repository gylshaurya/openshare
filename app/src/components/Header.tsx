"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Role } from "@openshare/shared";
import { IS_LOCAL, DEMO_MODE, chain } from "@/lib/config";
import { PERSONAS, personaOf } from "@/lib/personas";
import { short, useSnapshot } from "@/lib/hooks";
import { Badge } from "./ui";

const NAV = [
  ["/", "Dashboard"],
  ["/minter", "Mint"],
  ["/broker", "Broker"],
  ["/trade", "Trade"],
  ["/redeem", "Redeem"],
  ["/ops", "Ops"],
] as const;

export function MarketPill() {
  const { data: s } = useSnapshot();
  if (!s) return <Badge>market …</Badge>;
  const halted = s.assets.some((a) => a.halted);
  if (s.marketOpen) return <Badge tone="ok">NSE open</Badge>;
  return (
    <span className="flex items-center gap-1">
      <Badge tone="warn">{s.extendedClosure ? "NSE closed · extended" : "NSE closed"}</Badge>
      {halted && <Badge tone="bad">halt</Badge>}
    </span>
  );
}

function RoleBadge() {
  const { data: s } = useSnapshot();
  const r = s?.user?.role;
  if (r === Role.Minter) return <Badge tone="accent">Minter</Badge>;
  if (r === Role.Broker) return <Badge tone="accent">Broker</Badge>;
  return null;
}

function Wallet() {
  const { address, isConnected, connector } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const injectedConnector = connectors.find((c) => c.type === "injected");
  const mockConnectors = connectors.filter((c) => c.type === "mock");

  const switchPersona = (key: string) => {
    const p = PERSONAS.find((x) => x.key === key);
    if (!p) return;
    const c = mockConnectors[PERSONAS.indexOf(p)];
    if (c) connect({ connector: c });
  };

  return (
    <div className="flex items-center gap-2">
      {IS_LOCAL && (
        <select
          aria-label="Demo persona"
          value={connector?.type === "mock" ? (personaOf(address)?.key ?? "") : ""}
          onChange={(e) => (e.target.value ? switchPersona(e.target.value) : disconnect())}
          className="!py-1.5 text-xs"
        >
          <option value="">Persona…</option>
          {PERSONAS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label} · {p.role}
            </option>
          ))}
        </select>
      )}
      {isConnected ? (
        <button onClick={() => disconnect()} className="num rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-surface-2" title="Disconnect">
          {personaOf(address)?.label ?? short(address)}
        </button>
      ) : (
        <button
          onClick={() => injectedConnector && connect({ connector: injectedConnector, chainId: chain.id })}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg"
        >
          Connect wallet
        </button>
      )}
    </div>
  );
}

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-base font-bold tracking-tight">
            Open<span className="text-accent">Share</span>
          </span>
          <span className="hidden text-[11px] text-dim sm:inline">pledge-backed stock tokens</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {NAV.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={`rounded-md px-2.5 py-1.5 ${path === href ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <MarketPill />
          <RoleBadge />
          {DEMO_MODE && <Badge tone="mock">demo</Badge>}
          <Wallet />
        </div>
      </div>
    </header>
  );
}
