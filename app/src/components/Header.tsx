"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Check, ChevronDown, Copy, ExternalLink, LogOut, Wallet } from "lucide-react";
import { Role, formatUsd6 } from "@openshare/shared";
import { EXPLORER, IS_LOCAL, chain } from "@/lib/config";
import { PERSONAS, personaOf } from "@/lib/personas";
import { short, useSnapshot } from "@/lib/hooks";
import { Wordmark } from "./Brand";
import { StatusPill } from "./ui";

const NAV = [
  ["/markets", "Markets"],
  ["/trade", "Trade"],
  ["/mint", "Mint"],
  ["/broker", "Broker"],
  ["/redeem", "Redeem"],
] as const;

export function MarketStatus() {
  const { data: s } = useSnapshot();
  if (!s) return <StatusPill>NSE</StatusPill>;
  if (s.marketOpen) return <StatusPill tone="up">NSE open</StatusPill>;
  return (
    <StatusPill tone="warn" title={s.extendedClosure ? "Closed until the next trading session; brokers post a 125% bond" : "Closed until the next trading session"}>
      NSE closed
    </StatusPill>
  );
}

function WalletMenu() {
  const { address, isConnected, connector } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: s } = useSnapshot();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const injected = connectors.find((c) => c.type === "injected");
  const local = connectors.filter((c) => c.type === "mock");

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const role = s?.user?.role === Role.Minter ? "Minter" : s?.user?.role === Role.Broker ? "Broker" : null;
  const label = personaOf(address)?.label ?? short(address);

  if (!isConnected) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => (IS_LOCAL ? setOpen((o) => !o) : injected && connect({ connector: injected, chainId: chain.id }))}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          <Wallet className="size-4" aria-hidden />
          Connect wallet
        </button>
        {open && IS_LOCAL && (
          <AccountList
            onPick={(i) => {
              connect({ connector: local[i] });
              setOpen(false);
            }}
            onInjected={() => injected && connect({ connector: injected, chainId: chain.id })}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-canvas pl-1.5 pr-3 text-[13.5px] font-medium text-ink transition-colors hover:bg-soft"
      >
        <span className="size-6 rounded-full bg-[conic-gradient(from_200deg,#0f6b7d,#5fcbd9,#0b5463,#0f6b7d)]" aria-hidden />
        <span className="num">{label}</span>
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-72 overflow-hidden rounded-2xl border border-line bg-canvas shadow-[var(--shadow-float)]">
          <div className="border-b border-line px-4 py-3.5">
            <div className="flex items-center justify-between">
              <span className="num text-[13.5px] font-medium">{short(address)}</span>
              {role && <StatusPill tone="accent">{role}</StatusPill>}
            </div>
            <div className="num mt-1 text-[12.5px] text-muted">{formatUsd6(s?.user?.usdt ?? 0n)} USDT</div>
          </div>
          <div className="p-1.5 text-[13.5px]">
            <MenuItem
              onClick={() => {
                if (address) void navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? <Check className="size-4 text-up" /> : <Copy className="size-4 text-muted" />} {copied ? "Copied" : "Copy address"}
            </MenuItem>
            {EXPLORER && (
              <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 hover:bg-soft">
                <ExternalLink className="size-4 text-muted" /> View on explorer
              </a>
            )}
            {IS_LOCAL && connector?.type === "mock" && (
              <div className="mt-1 border-t border-line pt-1">
                <div className="px-2.5 pb-1 pt-2 text-[12px] text-muted">Switch account</div>
                {PERSONAS.map((p, i) => (
                  <MenuItem key={p.key} onClick={() => (connect({ connector: local[i] }), setOpen(false))}>
                    <span className="flex-1">{p.label}</span>
                    <span className="text-[12px] text-muted">{p.role}</span>
                  </MenuItem>
                ))}
              </div>
            )}
            <div className="mt-1 border-t border-line pt-1">
              <MenuItem onClick={() => (disconnect(), setOpen(false))}>
                <LogOut className="size-4 text-muted" /> Disconnect
              </MenuItem>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-soft">
      {children}
    </button>
  );
}

function AccountList({ onPick, onInjected }: { onPick: (i: number) => void; onInjected: () => void }) {
  return (
    <div className="absolute right-0 top-11 z-30 w-64 overflow-hidden rounded-2xl border border-line bg-canvas p-1.5 text-[13.5px] shadow-[var(--shadow-float)]">
      <MenuItem onClick={onInjected}>
        <Wallet className="size-4 text-muted" /> Browser wallet
      </MenuItem>
      <div className="mt-1 border-t border-line pt-1">
        <div className="px-2.5 pb-1 pt-2 text-[12px] text-muted">Accounts</div>
        {PERSONAS.map((p, i) => (
          <MenuItem key={p.key} onClick={() => onPick(i)}>
            <span className="flex-1">{p.label}</span>
            <span className="text-[12px] text-muted">{p.role}</span>
          </MenuItem>
        ))}
      </div>
    </div>
  );
}

export function AppHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 px-4 sm:px-6">
        <div className="flex h-16 items-center">
          <Wordmark />
        </div>
        <nav className="order-last -mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto border-t border-line px-4 py-2 md:order-none md:mx-0 md:w-auto md:border-0 md:p-0" aria-label="Main">
          {NAV.map(([href, label]) => {
            const active = path === href || path.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors ${active ? "bg-strong text-ink" : "text-muted hover:text-ink"}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex h-16 items-center gap-3">
          <span className="hidden sm:inline-flex">
            <MarketStatus />
          </span>
          <WalletMenu />
        </div>
      </div>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[12.5px] text-muted sm:px-6">
        <span>© {new Date().getFullYear()} OpenShare. Testnet. Not an offer of securities.</span>
        <span>Every token is backed by a pledged share or the bond-funded reserve, enforced on-chain.</span>
      </div>
    </footer>
  );
}
