export function quotaStatus(
  remaining: number | null,
  total: number | null,
): "critical" | "warning" | "healthy" | "no-quota" {
  if (total === null || remaining === null) return "no-quota";
  if (total === 0) return "critical";
  const pct = remaining / total;
  if (pct <= 0.1) return "critical";
  if (pct <= 0.25) return "warning";
  return "healthy";
}

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

/**
 * For a controlled drug (perlu_kelulusan_pakar), Critical/Low/Normal must
 * reflect annual patient quota remaining, not warehouse stock levels — these
 * drugs (e.g. insulin under the FMS quota register) aren't managed by
 * min/reorder/max shelf thresholds the way ordinary stock is. Returns null
 * when the drug isn't controlled or has no quota configured this year, so
 * callers fall back to their physical-stock-based status in that case.
 *
 * Inside the mirrored block because ai-query's FACTS block must apply the same
 * rule as the dashboards. It previously did not, so with an empty transactions
 * ledger the assistant reported every controlled drug as 0/critical while the
 * dashboard showed quota remaining — contradicting the screen the user was
 * looking at.
 */
export function quotaDerivedStatus(
  isControlled: boolean,
  quotaUsage: { used: number; quota_limit: number; alert_threshold_pct: number } | undefined,
): "critical" | "low" | "normal" | null {
  if (!isControlled || !quotaUsage) return null;
  const state = quotaBadgeState(quotaUsage.used, quotaUsage.quota_limit, quotaUsage.alert_threshold_pct);
  if (state === "exhausted") return "critical";
  if (state === "warning") return "low";
  if (state === "healthy") return "normal";
  return null;
}
// shared-quotahelpers>>>

export const QUOTA_BADGE_CLASS: Record<QuotaBadgeState, string> = {
  healthy: "bg-green-100 text-green-700 border-green-300",
  warning: "bg-amber-100 text-amber-700 border-amber-300",
  exhausted: "bg-red-100 text-red-700 border-red-300",
  "no-quota": "bg-gray-100 text-gray-600 border-gray-300",
};

export const QUOTA_BADGE_LABEL: Record<QuotaBadgeState, (used: number, limit: number | null) => string> = {
  healthy: (u, l) => `${u}/${l} patients`,
  warning: (u, l) => `${u}/${l} patients`,
  exhausted: (u, l) => `Quota Exhausted: ${u}/${l}`,
  "no-quota": () => "No quota set",
};

// quotaDerivedStatus now lives inside the shared-quotahelpers block above, so
// ai-query's FACTS builder applies the same quota-over-stock rule as the
// dashboards do.
