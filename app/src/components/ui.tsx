"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { PRICE_SOURCE_LABEL, PROOF_KIND_LABEL } from "@openshare/shared";
import { personaOf } from "@/lib/personas";
import { short } from "@/lib/hooks";
import { EXPLORER } from "@/lib/config";

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Tone = "ok" | "warn" | "mock" | "bad" | "manual" | "accent" | "neutral";
const toneClass: Record<Tone, string> = {
  ok: "text-ok border-ok/40 bg-ok/10",
  warn: "text-warn border-warn/40 bg-warn/10",
  mock: "text-mock border-mock/40 bg-mock/10",
  bad: "text-bad border-bad/40 bg-bad/10",
  manual: "text-manual border-manual/40 bg-manual/10",
  accent: "text-accent border-accent/40 bg-accent/10",
  neutral: "text-muted border-line bg-surface-2",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

/** Mandatory trust labels (SPEC §11.7). */
export function ProofBadge({ kind }: { kind: number }) {
  const tone: Tone = kind === 1 ? "ok" : kind === 2 ? "warn" : "mock";
  const title =
    kind === 1
      ? "Pledge proven with a Reclaim zkTLS proof"
      : kind === 2
        ? "Pledge read via the Zerodha Kite API and signed by a trusted attestor"
        : "Mock pledge proof (demo only)";
  return <Badge tone={tone} title={title}>{PROOF_KIND_LABEL[kind] ?? "?"}</Badge>;
}

export function SourceBadge({ source }: { source: number }) {
  const tone: Tone = source === 3 ? "ok" : source === 2 ? "manual" : source === 1 ? "warn" : "neutral";
  return <Badge tone={tone} title="Price source">{PRICE_SOURCE_LABEL[source] ?? "?"}</Badge>;
}

export function Button({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v =
    variant === "primary"
      ? "bg-accent text-bg hover:brightness-110"
      : variant === "danger"
        ? "bg-bad/15 text-bad border border-bad/40 hover:bg-bad/25"
        : "border border-line text-ink hover:bg-surface-2";
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${v} ${className}`}
    />
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "bad" | "warn" }) {
  const c = tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`num mt-1 truncate text-xl font-semibold ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-dim">{sub}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-dim">{hint}</span>}
    </label>
  );
}

export function Addr({ a }: { a?: string }) {
  const p = personaOf(a);
  const label = p ? p.label : short(a);
  return EXPLORER && a ? (
    <a className="num text-accent hover:underline" href={`${EXPLORER}/address/${a}`} target="_blank" rel="noreferrer" title={a}>
      {label}
    </a>
  ) : (
    <span className="num" title={a}>
      {label}
    </span>
  );
}

export function TxStatus({ pending, error }: { pending: string | null; error: string | null }) {
  if (pending) return <p className="text-xs text-accent">⏳ {pending}…</p>;
  if (error) return <p className="break-words text-xs text-bad">✗ {error}</p>;
  return null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-dim">{children}</p>;
}

export function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "mock" }) {
  const c = tone === "warn" ? "border-warn/30 bg-warn/5 text-warn" : tone === "mock" ? "border-mock/30 bg-mock/5 text-mock" : "border-line bg-surface-2 text-muted";
  return <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${c}`}>{children}</div>;
}
