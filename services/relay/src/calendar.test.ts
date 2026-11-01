import { describe, expect, it } from "vitest";
import { ist, isSessionOpen, isTradingDay, nextIsExtendedClosure, nextTradingDay } from "./calendar";

describe("NSE calendar", () => {
  it("knows weekends and holidays", () => {
    expect(isTradingDay("2026-11-06")).toBe(true); // Friday
    expect(isTradingDay("2026-11-07")).toBe(false); // Saturday
    expect(isTradingDay("2026-11-10")).toBe(false); // Diwali Balipratipada
    expect(isTradingDay("2026-12-25")).toBe(false);
  });
  it("finds the next trading day across weekends and holidays", () => {
    expect(nextTradingDay("2026-11-06")).toBe("2026-11-09");
    expect(nextTradingDay("2026-11-09")).toBe("2026-11-11"); // skips Nov 10 holiday
  });
  it("flags extended closures", () => {
    expect(nextIsExtendedClosure("2026-11-06")).toBe(true); // Fri -> Mon
    expect(nextIsExtendedClosure("2026-11-09")).toBe(true); // Mon -> Wed (holiday)
    expect(nextIsExtendedClosure("2026-11-11")).toBe(false); // Wed -> Thu
  });
  it("converts to IST and session hours", () => {
    // 2026-11-11 04:00 UTC = 09:30 IST
    expect(ist(new Date("2026-11-11T04:00:00Z")).minutes).toBe(9 * 60 + 30);
    expect(isSessionOpen(new Date("2026-11-11T04:00:00Z"))).toBe(true);
    expect(isSessionOpen(new Date("2026-11-11T03:40:00Z"))).toBe(false); // 09:10 IST
    expect(isSessionOpen(new Date("2026-11-11T10:05:00Z"))).toBe(false); // 15:35 IST
  });
});
