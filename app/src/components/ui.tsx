"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertCircle, ArrowUpRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { COMPANY } from "@openshare/shared";
import { personaOf } from "@/lib/personas";
import { short } from "@/lib/hooks";
import { EXPLORER } from "@/lib/config";

/* ------------------------------------------------------------------ layout */

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-[68ch] text-[14px] leading-relaxed text-body">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  flush = false,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-line bg-canvas ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "overflow-x-auto border-t border-line" : "px-5 pb-5 pt-1"}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ controls */

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variantClass: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover disabled:bg-[#a9c4ca]",
  secondary: "bg-strong text-ink hover:bg-[#e2e5e9] disabled:text-muted",
  ghost: "border border-line bg-canvas text-ink hover:bg-soft disabled:text-muted",
  danger: "border border-down/30 bg-down-soft text-down hover:bg-[#f7dadc] disabled:opacity-50",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const s = size === "sm" ? "h-8 px-3.5 text-[13px]" : size === "lg" ? "h-12 px-6 text-[15px]" : "h-10 px-5 text-[14px]";
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-colors duration-150 ease-out disabled:cursor-not-allowed ${s} ${variantClass[variant]} ${className}`}
    >
      {loading && <Loader2 className="spin size-4" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "primary", className = "" }: { href: string; children: ReactNode; variant?: Variant; className?: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-semibold transition-colors duration-150 ${variantClass[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: ReadonlyArray<readonly [T, ReactNode]>;
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className="inline-flex rounded-full bg-strong p-1">
      {options.map(([k, label]) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={`rounded-full font-semibold transition-colors duration-150 ${size === "sm" ? "h-7 px-3 text-[12.5px]" : "h-8 px-4 text-[13.5px]"} ${
            value === k ? "bg-canvas text-ink shadow-[0_1px_2px_rgba(11,13,16,.08)]" : "text-muted hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-[12.5px] font-medium text-body">{label}</span>
      {children}
      {hint && <span className="text-[12px] leading-snug text-muted">{hint}</span>}
    </label>
  );
}

/** Numeric input with a unit suffix. */
export function AmountInput({
  value,
  onChange,
  unit,
  integer = false,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  unit?: ReactNode;
  integer?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <input
        inputMode={integer ? "numeric" : "decimal"}
        className="num !pr-20 text-[15px]"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(integer ? e.target.value.replace(/\D/g, "") : e.target.value.replace(/[^\d.]/g, ""))}
      />
      {unit && <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-medium text-muted">{unit}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ data display */

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "up" | "down" | "warn" }) {
  const c = tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="min-w-0">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className={`num mt-1 truncate text-[22px] font-medium leading-tight ${c}`}>{value}</div>
      {sub && <div className="mt-1 truncate text-[12.5px] text-muted">{sub}</div>}
    </div>
  );
}

type Tone = "up" | "down" | "warn" | "accent" | "neutral";
const pillTone: Record<Tone, string> = {
  up: "bg-up-soft text-up",
  down: "bg-down-soft text-down",
  warn: "bg-warn-soft text-warn",
  accent: "bg-accent-soft text-accent",
  neutral: "bg-strong text-body",
};
const dotTone: Record<Tone, string> = { up: "bg-up", down: "bg-down", warn: "bg-warn", accent: "bg-accent", neutral: "bg-muted" };

export function StatusPill({ tone = "neutral", children, dot = true, title }: { tone?: Tone; children: ReactNode; dot?: boolean; title?: string }) {
  return (
    <span title={title} className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium ${pillTone[tone]}`}>
      {dot && <span className={`size-1.5 rounded-full ${dotTone[tone]}`} />}
      {children}
    </span>
  );
}

export function ticker(isin: string, symbol?: string) {
  return COMPANY[isin]?.ticker ?? symbol?.replace(/^o/, "") ?? "";
}

export function AssetMark({ isin, size = 32, dark = false }: { isin: string; size?: number; dark?: boolean }) {
  const t = ticker(isin);
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${dark ? "bg-dark-line text-on-dark" : "bg-strong text-ink"}`}
    >
      {t.slice(0, 1)}
    </span>
  );
}

export function AssetName({ isin, symbol, dark = false }: { isin: string; symbol: string; dark?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <AssetMark isin={isin} dark={dark} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={`truncate text-[14px] font-semibold ${dark ? "text-on-dark" : "text-ink"}`}>{COMPANY[isin]?.name ?? symbol}</span>
        <span className={`num text-[12px] ${dark ? "text-on-dark-soft" : "text-muted"}`}>{symbol}</span>
      </span>
    </span>
  );
}

/**
 * Signature: tokens outstanding against what backs them (shares pledged + bond-funded reserve).
 */
export function BackingMeter({
  tokens,
  pledged,
  reserve = 0n,
  dark = false,
  showLabel = true,
  className = "",
}: {
  tokens: bigint;
  pledged: bigint;
  reserve?: bigint;
  dark?: boolean;
  showLabel?: boolean;
  className?: string;
}) {
  const backing = pledged + reserve;
  const ok = tokens <= backing;
  const pct = backing === 0n ? 0 : Math.min(100, Number((tokens * 1000n) / backing) / 10);
  const fill = ok ? (dark ? "bg-accent-dark" : "bg-accent") : dark ? "bg-down-dark" : "bg-down";
  return (
    <div className={`min-w-0 ${className}`}>
      <div className={`h-1.5 overflow-hidden rounded-full ${dark ? "bg-dark-line" : "bg-strong"}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Tokens outstanding vs backing">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.max(pct, tokens > 0n ? 2 : 0)}%` }} />
      </div>
      {showLabel && (
        <div className={`num mt-1.5 flex justify-between gap-3 text-[11.5px] ${dark ? "text-on-dark-soft" : "text-muted"}`}>
          <span>{tokens.toLocaleString("en-US")} tokens</span>
          <span>
            {backing.toLocaleString("en-US")} backed
            {reserve > 0n ? ` (${reserve} reserve)` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

/** Generic ratio meter (e.g. bond coverage vs requirement). */
export function RatioMeter({ value, required, className = "" }: { value: number; required: number; className?: string }) {
  const max = Math.max(required * 2, value, 1);
  const ok = value >= required;
  return (
    <div className={`relative h-1.5 rounded-full bg-strong ${className}`}>
      <div className={`h-full rounded-full ${ok ? "bg-up" : "bg-down"}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      <span className="absolute -top-1 h-3.5 w-px bg-ink/50" style={{ left: `${(required / max) * 100}%` }} title={`Required ${required}%`} />
    </div>
  );
}

export function brokerName(name?: string) {
  return (name ?? "").replace(/\s*\(.*\)\s*$/, "") || "Broker";
}

export function Addr({ a, label }: { a?: string; label?: string }) {
  const p = personaOf(a);
  const text = label ?? p?.label ?? short(a);
  return EXPLORER && a ? (
    <a className="num text-[13px] text-ink decoration-line hover:text-accent hover:underline" href={`${EXPLORER}/address/${a}`} target="_blank" rel="noreferrer" title={a}>
      {text}
    </a>
  ) : (
    <span className="num text-[13px]" title={a}>
      {text}
    </span>
  );
}

/** How a pledge was proven. */
export function ProofLabel({ kind }: { kind: number }) {
  const label = kind === 1 ? "zkTLS proof" : kind === 2 ? "Zerodha" : "Attested";
  const title =
    kind === 1
      ? "Proven with a Reclaim zkTLS proof of the depository record"
      : kind === 2
        ? "Read from the Zerodha Kite API and signed by the Bull Street attestor"
        : "Pledge details signed by an approved attestor";
  return (
    <span title={title} className="inline-flex items-center gap-1.5 text-[13px] text-body">
      <ShieldCheck className="size-3.5 text-accent" aria-hidden />
      {label}
    </span>
  );
}

export function TxStatus({ pending, error, success }: { pending: string | null; error: string | null; success?: string | null }) {
  if (pending)
    return (
      <p className="flex items-center gap-2 text-[13px] text-accent" role="status">
        <Loader2 className="spin size-3.5" aria-hidden /> {pending}…
      </p>
    );
  if (error)
    return (
      <p className="flex items-start gap-2 break-words text-[13px] text-down" role="alert">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {error}
      </p>
    );
  if (success)
    return (
      <p className="flex items-center gap-2 text-[13px] text-up" role="status">
        <CheckCircle2 className="size-3.5" aria-hidden /> {success}
      </p>
    );
  return null;
}

export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-[44ch] text-[13px] leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "accent" }) {
  const c = tone === "warn" ? "bg-warn-soft text-warn" : tone === "accent" ? "bg-accent-soft text-accent-hover" : "bg-soft text-body";
  return <div className={`rounded-xl px-4 py-3 text-[13px] leading-relaxed ${c}`}>{children}</div>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </a>
  );
}

export function Skeleton({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return <div className={`${dark ? "skeleton-dark" : "skeleton"} ${className}`} />;
}

export const inr = (paise: bigint) => `₹${(Number(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function premiumPct(pool: bigint, ref: bigint): number | undefined {
  if (pool === 0n || ref === 0n) return undefined;
  return Math.round((Number(pool) / Number(ref) - 1) * 10_000) / 100 || 0;
}

export function Change({ pct }: { pct?: number }) {
  if (pct === undefined) return <span className="text-muted">–</span>;
  const tone = pct > 0 ? "text-up" : pct < 0 ? "text-down" : "text-body";
  return (
    <span className={`num ${tone}`}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

export const PLEDGE_LABEL = ["None", "Awaiting broker", "Active", "Closed"] as const;
export const TICKET_LABEL = ["None", "In progress", "Paid", "Paid from bond"] as const;
