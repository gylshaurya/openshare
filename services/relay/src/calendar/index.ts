import data from "./nse-holidays.json" with { type: "json" };

/** NSE regular session, IST (UTC+5:30). SPEC §10.1. */
export const OPEN_MIN = 9 * 60 + 15;
export const CLOSE_MIN = 15 * 60 + 30;
/** Minutes after close when the official close is considered final and the session is closed on-chain. */
export const CLOSE_POST_MIN = CLOSE_MIN + 15;

const HOLIDAYS = new Set<string>(data.holidays);
const IST_OFFSET_MS = 330 * 60 * 1000;

export interface IstParts {
  date: string; // YYYY-MM-DD in IST
  minutes: number; // minutes since IST midnight
  weekday: number; // 0 = Sunday
}

export function ist(d: Date): IstParts {
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    date: t.toISOString().slice(0, 10),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
    weekday: t.getUTCDay(),
  };
}

export function isTradingDay(date: string): boolean {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !HOLIDAYS.has(date);
}

export function isSessionOpen(d: Date): boolean {
  const p = ist(d);
  return isTradingDay(p.date) && p.minutes >= OPEN_MIN && p.minutes < CLOSE_MIN;
}

export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function nextTradingDay(date: string): string {
  let d = addDays(date, 1);
  for (let i = 0; i < 30 && !isTradingDay(d); i++) d = addDays(d, 1);
  return d;
}

/** True if the next session is more than one calendar day after `date` (weekend or holiday gap, D1). */
export function nextIsExtendedClosure(date: string): boolean {
  return nextTradingDay(date) !== addDays(date, 1);
}
