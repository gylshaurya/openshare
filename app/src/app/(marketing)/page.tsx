"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { SHARE, formatBps, formatUsd6 } from "@openshare/shared";
import { Wordmark } from "@/components/Brand";
import { AssetName, BackingMeter, Skeleton, inr, premiumPct, ticker } from "@/components/ui";
import { chain } from "@/lib/config";
import { ago, useSnapshot } from "@/lib/hooks";
import { nseClock, untilLabel, weekSessions } from "@/lib/nse";

/* ------------------------------------------------------------------ hero: the week, and the live board */

function useNow(ms = 30_000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function WeekStrip() {
  const now = useNow();
  if (!now) return <Skeleton dark className="h-[132px] w-full rounded-2xl" />;
  const { sessions, nowFrac, openShare } = weekSessions(now);
  const clock = nseClock(now);
  return (
    <figure className="rounded-2xl border border-dark-line bg-dark-2 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <figcaption className="text-[13px] text-on-dark-soft">This week, India time</figcaption>
        <span className="num text-[13px] text-on-dark-soft">
          {clock.open ? `NSE closes in ${untilLabel(clock.next.getTime() - now.getTime())}` : `NSE opens in ${untilLabel(clock.next.getTime() - now.getTime())}`}
        </span>
      </div>
      <div className="relative mt-5">
        <div className="grid grid-cols-[88px_1fr] items-center gap-x-4 gap-y-3">
          <span className="text-[13px] font-medium text-on-dark">NSE</span>
          <div className="relative h-3 rounded-full bg-dark-line">
            {sessions.map((s, i) => (
              <span
                key={i}
                className={`absolute inset-y-0 rounded-[3px] ${s.holiday ? "bg-on-dark-soft/25" : "bg-on-dark-soft"}`}
                style={{ left: `${s.start * 100}%`, width: `${(s.end - s.start) * 100}%` }}
                title={s.holiday ? "Exchange holiday" : "09:15–15:30 IST"}
              />
            ))}
          </div>
          <span className="text-[13px] font-medium text-on-dark">Bull Street</span>
          <div className="h-3 rounded-full bg-accent-dark" />
        </div>
        <div className="pointer-events-none absolute inset-y-[-6px] left-[104px] right-0">
          <span className="absolute inset-y-0 w-px bg-white" style={{ left: `${Math.min(100, Math.max(0, nowFrac * 100))}%` }}>
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-white" />
          </span>
        </div>
        <div className="mt-2 grid grid-cols-[88px_1fr] gap-x-4">
          <span />
          <div className="grid grid-cols-7 text-[11.5px] text-on-dark-soft">
            {DAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-4 text-[13px] text-on-dark-soft">
        NSE trades <span className="num text-on-dark">{(openShare * 100).toFixed(0)}%</span> of this week. Bull Street markets stay open the rest of the time.
      </p>
    </figure>
  );
}

function LiveBoard() {
  const { data: s } = useSnapshot();
  return (
    <div className="overflow-hidden rounded-2xl border border-dark-line bg-dark-2">
      <div className="flex items-center justify-between border-b border-dark-line px-5 py-3.5">
        <span className="text-[13px] font-medium text-on-dark">Markets</span>
        <span className="flex items-center gap-2 text-[12.5px] text-on-dark-soft">
          <span className="size-1.5 rounded-full bg-up-dark" /> Live on {chain.name}
        </span>
      </div>
      {!s ? (
        <div className="flex flex-col gap-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} dark className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <ul>
          {s.assets.map((a) => (
            <li key={a.assetId} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 border-b border-dark-line px-5 py-4 last:border-0 md:grid-cols-[1.4fr_0.9fr_0.9fr_1.4fr_auto]">
              <AssetName isin={a.isin} symbol={a.symbol} dark />
              <div className="hidden text-right md:block">
                <div className="num text-[15px] text-on-dark">{a.supply > 0n && a.poolPriceUsd6 ? formatUsd6(a.poolPriceUsd6) : "–"}</div>
                <div className="text-[12px] text-on-dark-soft">token</div>
              </div>
              <div className="hidden text-right md:block">
                <div className="num text-[14px] text-on-dark-soft">{inr(a.inrPaise)}</div>
                <div className="text-[12px] text-on-dark-soft">
                  NSE{a.supply > 0n ? <> · <PremiumDark pct={premiumPct(a.poolPriceUsd6, a.priceUsd6)} /></> : null}
                </div>
              </div>
              <BackingMeter dark tokens={a.supply / SHARE} pledged={a.totalPledged} reserve={a.reserveShares} className="col-span-2 md:col-span-1" />
              <Link
                href={`/trade?asset=${a.assetId}`}
                className="col-start-2 row-start-1 inline-flex h-9 items-center gap-1.5 justify-self-end rounded-full bg-on-dark px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-accent-dark md:col-start-auto md:row-start-auto"
              >
                Trade {ticker(a.isin)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PremiumDark({ pct }: { pct?: number }) {
  if (pct === undefined) return <span>–</span>;
  return (
    <span className={`num ${pct > 0 ? "text-up-dark" : pct < 0 ? "text-down-dark" : ""}`}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

/* ------------------------------------------------------------------ sections */

const STEPS = [
  {
    title: "Pledge from your demat",
    body: "Create a pledge to a bonded Bull Street broker at your depository. Your shares never leave your account; the pledge locks them.",
    detail: "100 RELIANCE pledged",
  },
  {
    title: "Mint and trade, any hour",
    body: "Prove the pledge on-chain with zkTLS or your broker's API, then mint one token per share and trade on the pool around the clock.",
    detail: "100 oRELIANCE minted",
  },
  {
    title: "Redeem for USDT",
    body: "Any holder can redeem. The broker sells the shares on NSE and pays within three trading sessions, or its bond pays 105%.",
    detail: "paid within 3 sessions",
  },
];

const ROLES = [
  {
    who: "Shareholders",
    what: "Unlock liquidity from shares you keep. Mint against a pledge and sell when you choose, including into weekend demand when the token trades above NSE.",
    href: "/mint",
    cta: "Start minting",
  },
  {
    who: "Traders",
    what: "Buy and sell Indian large caps at 2 a.m. on a Sunday. Every token is backed by a pledged share and redeemable for USDT.",
    href: "/trade",
    cta: "Open the market",
  },
  {
    who: "Pledge brokers",
    what: "Hold pledges, post a USDT bond, earn 0.10% on mints and 0.20% on redemptions. Settlement runs through your existing NSE access.",
    href: "/broker",
    cta: "Become a broker",
  },
];

const GUARANTEES = [
  ["Backing, enforced", "For every stock, tokens in existence can never exceed shares still pledged plus the bond-funded reserve. The contracts check it on every mint, burn and redemption."],
  ["Bonded brokers", "Brokers keep USDT worth 110% of pledged value, 125% across weekends and holidays. A broker below the line has 24 hours to top up before it is declared in default."],
  ["Deadline-bound redemptions", "A redemption is paid from an NSE sale within three trading sessions. If the broker misses the deadline, anyone can trigger a 105% payout from its bond."],
  ["One person, one role", "World ID confirms every minter and broker is a unique person, so no one can be both sides of a pledge. Transfers to blocked accounts are refused by the token itself."],
] as const;

function BackingSection() {
  const { data: s } = useSnapshot();
  const bonds = s?.brokers.reduce((a, b) => a + b.bond, 0n) ?? 0n;
  return (
    <section className="bg-soft">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:gap-20">
        <div>
          <h2 className="display text-[40px] text-ink sm:text-[44px]">Backing you can check, not just trust.</h2>
          <p className="mt-5 max-w-[46ch] text-[16px] leading-relaxed text-body">
            Every market shows its tokens against the shares pledged behind them, read straight from the contracts. No custodian
            report, no monthly attestation.
          </p>
          <Link href="/markets" className="mt-8 inline-flex items-center gap-1.5 text-[15px] font-semibold text-accent hover:underline">
            See all markets <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <div className="rounded-3xl border border-line bg-canvas p-6 sm:p-8">
          {!s ? (
            <div className="flex flex-col gap-6">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-7">
                {s.assets.map((a) => (
                  <li key={a.assetId} className="grid grid-cols-[1fr_1.2fr] items-center gap-6">
                    <AssetName isin={a.isin} symbol={a.symbol} />
                    <BackingMeter tokens={a.supply / SHARE} pledged={a.totalPledged} reserve={a.reserveShares} />
                  </li>
                ))}
              </ul>
              <dl className="mt-8 grid grid-cols-2 gap-6 border-t border-line pt-6">
                <div>
                  <dt className="text-[13px] text-muted">Broker bonds posted</dt>
                  <dd className="num mt-1 text-[22px]">{formatUsd6(bonds, 0)}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-muted">Current bond requirement</dt>
                  <dd className="num mt-1 text-[22px]">{formatBps(s.requiredBondBps)}</dd>
                </div>
              </dl>
              <p className="mt-4 text-[12.5px] text-muted">Updated {ago(s.assets[0]?.priceUpdatedAt ?? 0n, s.blockTime)} from the chain.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="bg-canvas">
      {/* Hero */}
      <section className="bg-dark text-on-dark">
        <header className="mx-auto flex h-16 max-w-[1200px] items-center gap-8 px-4 sm:px-6">
          <Wordmark dark />
          <nav className="hidden items-center gap-6 text-[14px] text-on-dark-soft md:flex" aria-label="Sections">
            <a href="#how" className="hover:text-on-dark">How it works</a>
            <a href="#roles" className="hover:text-on-dark">Who it&apos;s for</a>
            <a href="#guarantees" className="hover:text-on-dark">Guarantees</a>
          </nav>
          <Link href="/markets" className="ml-auto inline-flex h-9 items-center rounded-full bg-on-dark px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-accent-dark">
            Launch app
          </Link>
        </header>

        <div className="mx-auto max-w-[1200px] px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <div className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-end">
            <div>
              <h1 className="display text-[44px] sm:text-[64px] lg:text-[72px]">Indian stocks, open when NSE isn&apos;t.</h1>
              <p className="mt-6 max-w-[52ch] text-[17px] leading-relaxed text-on-dark-soft">
                Shareholders mint a token for every share they pledge from their own demat account. Anyone can trade those tokens
                around the clock and redeem them for USDT through bonded brokers.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/trade" className="inline-flex h-12 items-center gap-2 rounded-full bg-accent-dark px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-white">
                  Start trading <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link href="/mint" className="inline-flex h-12 items-center rounded-full border border-on-dark/30 px-6 text-[15px] font-semibold text-on-dark transition-colors hover:border-on-dark">
                  Mint against your shares
                </Link>
              </div>
            </div>
            <WeekStrip />
          </div>
          <div className="mt-14">
            <LiveBoard />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-[1200px] scroll-mt-8 px-4 py-24 sm:px-6">
        <h2 className="display max-w-[18ch] text-[40px] sm:text-[44px]">From your demat account to a 24/7 market, in three steps.</h2>
        <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative border-t border-ink pt-6">
              <span className="num text-[13px] text-muted">Step {i + 1}</span>
              <h3 className="mt-3 text-[20px] font-semibold tracking-[-0.01em]">{s.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-body">{s.body}</p>
              <p className="num mt-5 inline-flex rounded-full bg-strong px-3 py-1 text-[12.5px] text-ink">{s.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <BackingSection />

      {/* Roles */}
      <section id="roles" className="mx-auto max-w-[1200px] scroll-mt-8 px-4 py-24 sm:px-6">
        <h2 className="display max-w-[20ch] text-[40px] sm:text-[44px]">One market, three ways in.</h2>
        <div className="mt-12 border-t border-line">
          {ROLES.map((r) => (
            <Link
              key={r.who}
              href={r.href}
              className="group grid gap-3 border-b border-line py-8 transition-colors hover:bg-soft sm:grid-cols-[220px_1fr_auto] sm:items-center sm:gap-10 sm:px-4"
            >
              <span className="text-[22px] font-semibold tracking-[-0.01em]">{r.who}</span>
              <span className="max-w-[60ch] text-[15px] leading-relaxed text-body">{r.what}</span>
              <span className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-accent">
                {r.cta} <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Guarantees */}
      <section id="guarantees" className="scroll-mt-8 bg-dark text-on-dark">
        <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
          <h2 className="display max-w-[20ch] text-[40px] sm:text-[44px]">Guarantees written into the contracts.</h2>
          <dl className="mt-14 grid gap-px overflow-hidden rounded-3xl bg-dark-line md:grid-cols-2">
            {GUARANTEES.map(([t, b]) => (
              <div key={t} className="bg-dark p-8">
                <dt className="text-[18px] font-semibold">{t}</dt>
                <dd className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-on-dark-soft">{b}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Closing */}
      <section className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <h2 className="display max-w-[16ch] text-[40px] sm:text-[52px]">Your shares, working around the clock.</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/markets" className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-[15px] font-semibold text-white transition-colors hover:bg-accent-hover">
              Launch app <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/broker" className="inline-flex h-12 items-center rounded-full bg-strong px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-[#e2e5e9]">
              Become a broker
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-[44ch]">
            <Wordmark />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Pledge-backed tokens for Indian equities. Shares stay in their owners&apos; demat accounts; backing is enforced on-chain.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-[13.5px] text-body sm:grid-cols-3" aria-label="Footer">
            <Link href="/markets" className="hover:text-ink">Markets</Link>
            <Link href="/trade" className="hover:text-ink">Trade</Link>
            <Link href="/mint" className="hover:text-ink">Mint</Link>
            <Link href="/broker" className="hover:text-ink">Broker</Link>
            <Link href="/redeem" className="hover:text-ink">Redeem</Link>
          </nav>
        </div>
        <div className="border-t border-line">
          <p className="mx-auto max-w-[1200px] px-4 py-5 text-[12.5px] text-muted sm:px-6">
            © {new Date().getFullYear()} Bull Street. Testnet. Not an offer of securities. Token prices are set by traders and can differ
            from NSE prices.
          </p>
        </div>
      </footer>
    </div>
  );
}
