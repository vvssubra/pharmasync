// Mirrored verbatim from src/lib/quotaHelpers.ts (parity-tested) because the
// edge bundle cannot import outside supabase/functions/.

// <<<shared-quotahelpers
// Mirrored verbatim into supabase/functions/_shared/quotaHelpers.ts (parity-tested)
// because the edge bundle cannot import outside supabase/functions/.
export function forecastStatus(days: number | null): "critical" | "warning" | "healthy" | "no-data" {
  if (days === null) return "no-data";
  if (days < 7) return "critical";
  if (days < 14) return "warning";
  return "healthy";
}

export function daysRemaining(stock: number, avgDaily: number): number | null {
  if (avgDaily === 0) return null;
  return Math.floor(stock / avgDaily);
}

export function projectedExhaustion(remaining: number, avgPerMonth: number): string {
  if (remaining <= 0) return "Exhausted";
  if (avgPerMonth === 0) return "No usage data";
  const monthsLeft = remaining / avgPerMonth;
  const date = new Date();
  date.setDate(date.getDate() + Math.ceil(monthsLeft * 30));
  return date.toLocaleDateString("en-MY", { month: "short", year: "numeric" });
}

export type QuotaBadgeState = "healthy" | "warning" | "exhausted" | "no-quota";

export function quotaBadgeState(used: number, limit: number | null, alertThresholdPct = 20): QuotaBadgeState {
  if (limit === null) return "no-quota";
  if (used >= limit) return "exhausted";
  if (used >= limit * (1 - alertThresholdPct / 100)) return "warning";
  return "healthy";
}
// shared-quotahelpers>>>
