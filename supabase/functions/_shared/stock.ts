// <<<shared-stock
// Pure stock-ledger math shared between the frontend and the AI edge functions.
// Mirrored verbatim into supabase/functions/_shared/stock.ts (parity-tested)
// because the edge bundle cannot import outside supabase/functions/.

export interface StockTxn {
  drug_id: string;
  jenis: string;
  kuantiti: number;
  tarikh?: string | null;
  created_at?: string | null;
}

function sortAscending<T extends StockTxn>(txns: T[]): T[] {
  return [...txns].sort((a, b) => {
    const aKey = a.tarikh ?? a.created_at ?? "";
    const bKey = b.tarikh ?? b.created_at ?? "";
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}

/**
 * baki_awal (opening balance) is a declarative "physical count as of this
 * date" — it SETS the running total rather than adding to it. terimaan adds,
 * keluaran subtracts. Transactions must be sorted ascending by (tarikh ??
 * created_at) before folding, otherwise a baki_awal recorded out of order can
 * silently wipe out transactions that should have preceded it.
 */
export function computeStockByDrug(txns: StockTxn[]): Map<string, number> {
  const sorted = sortAscending(txns);
  const map = new Map<string, number>();
  for (const t of sorted) {
    const curr = map.get(t.drug_id) ?? 0;
    if (t.jenis === "baki_awal") map.set(t.drug_id, t.kuantiti);
    else if (t.jenis === "terimaan") map.set(t.drug_id, curr + t.kuantiti);
    else if (t.jenis === "keluaran") map.set(t.drug_id, curr - t.kuantiti);
  }
  return map;
}

export function computeStock(drugId: string, txns: StockTxn[]): number {
  return computeStockByDrug(txns.filter((t) => t.drug_id === drugId)).get(drugId) ?? 0;
}

export function stockStatus(stock: number, min: number, reorder: number): "critical" | "low" | "normal" {
  if (stock <= min) return "critical";
  if (stock <= reorder) return "low";
  return "normal";
}

/** Average daily keluaran (dispensed-out) for a drug over the trailing `days`. */
export function avgDailyOut(txns: StockTxn[], drugId: string, days: number): number {
  const cutoff = Date.now() - days * 86400000;
  let total = 0;
  for (const t of txns) {
    if (t.drug_id !== drugId || t.jenis !== "keluaran") continue;
    const dateStr = t.tarikh ?? t.created_at;
    if (!dateStr) continue;
    const ts = new Date(dateStr).getTime();
    if (Number.isNaN(ts) || ts < cutoff) continue;
    total += t.kuantiti;
  }
  return total / days;
}
// shared-stock>>>
