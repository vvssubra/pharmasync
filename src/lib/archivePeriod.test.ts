import { describe, it, expect } from "vitest";
import { resolvePeriodRange, groupByDay, formatDayLabel, WEEK_STARTS_ON } from "./archivePeriod";

describe("WEEK_STARTS_ON", () => {
  it("is Sunday", () => {
    expect(WEEK_STARTS_ON).toBe(0);
  });
});

describe("resolvePeriodRange", () => {
  const now = new Date("2026-07-15T10:00:00Z"); // Wednesday

  it("returns null when no period is selected", () => {
    expect(resolvePeriodRange("", now)).toBeNull();
  });

  it("returns null for custom range missing an endpoint", () => {
    expect(resolvePeriodRange("custom", now, new Date("2026-07-01"))).toBeNull();
    expect(resolvePeriodRange("custom", now, undefined, new Date("2026-07-10"))).toBeNull();
  });

  it("resolves today to a single-day range", () => {
    expect(resolvePeriodRange("today", now)).toEqual({ from: "2026-07-15", to: "2026-07-15" });
  });

  it("resolves this week (Sunday start) around mid-week", () => {
    expect(resolvePeriodRange("week", now)).toEqual({ from: "2026-07-12", to: "2026-07-18" });
  });

  it("resolves this week when now is a Sunday", () => {
    const sunday = new Date("2026-07-12T00:00:00Z");
    expect(resolvePeriodRange("week", sunday)).toEqual({ from: "2026-07-12", to: "2026-07-18" });
  });

  it("resolves this week when now is a Saturday", () => {
    const saturday = new Date("2026-07-18T00:00:00Z");
    expect(resolvePeriodRange("week", saturday)).toEqual({ from: "2026-07-12", to: "2026-07-18" });
  });

  it("resolves this month", () => {
    expect(resolvePeriodRange("month", now)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("resolves this month across a leap February", () => {
    const feb = new Date("2028-02-10T00:00:00Z");
    expect(resolvePeriodRange("month", feb)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("resolves a custom range", () => {
    expect(
      resolvePeriodRange("custom", now, new Date("2026-06-01"), new Date("2026-06-15")),
    ).toEqual({ from: "2026-06-01", to: "2026-06-15" });
  });

  it("swaps a reversed custom range", () => {
    expect(
      resolvePeriodRange("custom", now, new Date("2026-06-15"), new Date("2026-06-01")),
    ).toEqual({ from: "2026-06-01", to: "2026-06-15" });
  });
});

describe("groupByDay", () => {
  it("groups rows with newest day first", () => {
    const rows = [
      { tarikh: "2026-07-14", acknowledged_at: "2026-07-14T09:00:00Z" },
      { tarikh: "2026-07-15", acknowledged_at: "2026-07-15T09:00:00Z" },
    ];
    const groups = groupByDay(rows);
    expect(groups.map((g) => g.date)).toEqual(["2026-07-15", "2026-07-14"]);
  });

  it("sorts rows within a day by acknowledged_at descending", () => {
    const rows = [
      { tarikh: "2026-07-15", acknowledged_at: "2026-07-15T09:00:00Z", id: "early" },
      { tarikh: "2026-07-15", acknowledged_at: "2026-07-15T14:00:00Z", id: "late" },
    ];
    const groups = groupByDay(rows);
    expect(groups[0].forms.map((f) => f.id)).toEqual(["late", "early"]);
  });

  it("sorts rows with a null acknowledged_at last within a day", () => {
    const rows = [
      { tarikh: "2026-07-15", acknowledged_at: null, id: "no-ack" },
      { tarikh: "2026-07-15", acknowledged_at: "2026-07-15T09:00:00Z", id: "acked" },
    ];
    const groups = groupByDay(rows);
    expect(groups[0].forms.map((f) => f.id)).toEqual(["acked", "no-ack"]);
  });
});

describe("formatDayLabel", () => {
  const now = new Date("2026-07-15T10:00:00Z");

  it("labels today", () => {
    expect(formatDayLabel("2026-07-15", now)).toBe("Today — Wed, 15 Jul 2026");
  });

  it("labels yesterday", () => {
    expect(formatDayLabel("2026-07-14", now)).toBe("Yesterday — Tue, 14 Jul 2026");
  });

  it("labels an older date plainly", () => {
    expect(formatDayLabel("2026-07-01", now)).toBe("Wed, 1 Jul 2026");
  });
});
