import { describe, it, expect } from "vitest";
import { computeStock, computeStockByDrug, stockStatus, avgDailyOut, type StockTxn } from "./stock";

const D = "drug-1";

describe("computeStock", () => {
  it("returns 0 for an empty ledger", () => {
    expect(computeStock(D, [])).toBe(0);
  });

  it("adds terimaan and subtracts keluaran", () => {
    const txns: StockTxn[] = [
      { drug_id: D, jenis: "terimaan", kuantiti: 100, tarikh: "2026-01-01" },
      { drug_id: D, jenis: "keluaran", kuantiti: 30, tarikh: "2026-01-02" },
    ];
    expect(computeStock(D, txns)).toBe(70);
  });

  it("baki_awal sets the running total rather than adding to it", () => {
    const txns: StockTxn[] = [
      { drug_id: D, jenis: "terimaan", kuantiti: 20, tarikh: "2026-01-01" },
      { drug_id: D, jenis: "baki_awal", kuantiti: 100, tarikh: "2026-01-02" },
      { drug_id: D, jenis: "terimaan", kuantiti: 10, tarikh: "2026-01-03" },
    ];
    // baki_awal on 01-02 overrides the prior 20, then +10 after it
    expect(computeStock(D, txns)).toBe(110);
  });

  it("sorts by tarikh before folding, so an unsorted baki_awal mid-ledger does not silently wipe later entries", () => {
    const txns: StockTxn[] = [
      { drug_id: D, jenis: "terimaan", kuantiti: 10, tarikh: "2026-01-03" },
      { drug_id: D, jenis: "baki_awal", kuantiti: 100, tarikh: "2026-01-02" },
      { drug_id: D, jenis: "terimaan", kuantiti: 20, tarikh: "2026-01-01" },
    ];
    // Chronological order: terimaan 20 (01-01) -> baki_awal 100 (01-02, overrides) -> terimaan 10 (01-03)
    expect(computeStock(D, txns)).toBe(110);
  });

  it("falls back to created_at when tarikh is absent", () => {
    const txns: StockTxn[] = [
      { drug_id: D, jenis: "terimaan", kuantiti: 5, created_at: "2026-01-02T00:00:00Z" },
      { drug_id: D, jenis: "baki_awal", kuantiti: 50, created_at: "2026-01-01T00:00:00Z" },
    ];
    expect(computeStock(D, txns)).toBe(55);
  });

  it("can go negative if keluaran exceeds recorded stock", () => {
    const txns: StockTxn[] = [
      { drug_id: D, jenis: "keluaran", kuantiti: 15, tarikh: "2026-01-01" },
    ];
    expect(computeStock(D, txns)).toBe(-15);
  });

  it("ignores transactions for other drugs", () => {
    const txns: StockTxn[] = [
      { drug_id: D, jenis: "terimaan", kuantiti: 10, tarikh: "2026-01-01" },
      { drug_id: "drug-2", jenis: "terimaan", kuantiti: 999, tarikh: "2026-01-01" },
    ];
    expect(computeStock(D, txns)).toBe(10);
  });
});

describe("computeStockByDrug", () => {
  it("computes balances for multiple drugs independently", () => {
    const txns: StockTxn[] = [
      { drug_id: "a", jenis: "baki_awal", kuantiti: 50, tarikh: "2026-01-01" },
      { drug_id: "b", jenis: "terimaan", kuantiti: 20, tarikh: "2026-01-01" },
      { drug_id: "a", jenis: "keluaran", kuantiti: 5, tarikh: "2026-01-02" },
    ];
    const map = computeStockByDrug(txns);
    expect(map.get("a")).toBe(45);
    expect(map.get("b")).toBe(20);
  });
});

describe("stockStatus", () => {
  it("is critical at or below min", () => {
    expect(stockStatus(5, 5, 20)).toBe("critical");
    expect(stockStatus(4, 5, 20)).toBe("critical");
  });
  it("is low at or below reorder but above min", () => {
    expect(stockStatus(15, 5, 20)).toBe("low");
  });
  it("is normal above reorder", () => {
    expect(stockStatus(25, 5, 20)).toBe("normal");
  });
});

describe("avgDailyOut", () => {
  it("returns 0 when there is no keluaran in the window", () => {
    expect(avgDailyOut([], D, 90)).toBe(0);
  });

  it("averages keluaran quantity over the window length", () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 1 * 86400000).toISOString();
    const txns: StockTxn[] = [
      { drug_id: D, jenis: "keluaran", kuantiti: 90, created_at: recent },
    ];
    expect(avgDailyOut(txns, D, 90)).toBe(1);
  });

  it("excludes keluaran outside the trailing window", () => {
    const old = new Date(Date.now() - 200 * 86400000).toISOString();
    const txns: StockTxn[] = [
      { drug_id: D, jenis: "keluaran", kuantiti: 90, created_at: old },
    ];
    expect(avgDailyOut(txns, D, 90)).toBe(0);
  });
});
