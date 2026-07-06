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
