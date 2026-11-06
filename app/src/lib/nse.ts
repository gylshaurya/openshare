import calendar from "../../../services/relay/src/calendar/nse-holidays.json";

/** NSE equity session in IST (UTC+05:30): 09:15–15:30 on weekdays that are not exchange holidays. */
const IST_OFFSET_MIN = 330;
const OPEN_MIN = 9 * 60 + 15;
const CLOSE_MIN = 15 * 60 + 30;
const HOLIDAYS = new Set<string>((calendar as { holidays: string[] }).holidays);

/** Shifts a UTC instant so its UTC fields read as IST wall-clock time. */
const toIst = (d: Date) => new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
const ymd = (ist: Date) => ist.toISOString().slice(0, 10);

export function isTradingDay(ist: Date) {
  const dow = ist.getUTCDay();
  return dow !== 0 && dow !== 6 && !HOLIDAYS.has(ymd(ist));
}

/** Whether NSE is open now and when that changes next. */
export function nseClock(now = new Date()): { open: boolean; next: Date } {
  const ist = toIst(now);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const dayStartUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MIN * 60_000;
  if (isTradingDay(ist) && minutes >= OPEN_MIN && minutes < CLOSE_MIN) {
    return { open: true, next: new Date(dayStartUtc + CLOSE_MIN * 60_000) };
  }
  for (let i = 0; i < 15; i++) {
    const start = dayStartUtc + i * 86_400_000;
    const day = toIst(new Date(start + 12 * 3_600_000));
    if (!isTradingDay(day)) continue;
    const open = start + OPEN_MIN * 60_000;
    if (open > now.getTime()) return { open: false, next: new Date(open) };
  }
  return { open: false, next: new Date(now.getTime() + 86_400_000) };
}

/** Sessions of the current IST week (Mon–Sun) as fractions of the week, plus "now". */
export function weekSessions(now = new Date()) {
  const ist = toIst(now);
  const dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
  const mondayIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - dow * 86_400_000;
  const week = 7 * 1440;
  const sessions: Array<{ start: number; end: number; holiday: boolean }> = [];
  for (let i = 0; i < 5; i++) {
    const day = new Date(mondayIst + i * 86_400_000);
    sessions.push({ start: (i * 1440 + OPEN_MIN) / week, end: (i * 1440 + CLOSE_MIN) / week, holiday: HOLIDAYS.has(ymd(day)) });
  }
  const nowFrac = (ist.getTime() - mondayIst) / (week * 60_000);
  const openShare = sessions.filter((s) => !s.holiday).reduce((a, s) => a + (s.end - s.start), 0);
  return { sessions, nowFrac, openShare };
}

export function untilLabel(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}
