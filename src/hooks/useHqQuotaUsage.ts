import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type NationalQuotaUsage =
  Database["public"]["Functions"]["get_drug_quota_usage"]["Returns"][number];

export type ClinicQuotaUsage =
  Database["public"]["Functions"]["get_quota_usage_by_clinic"]["Returns"][number];

/**
 * HQ-only view of the national controlled-drug quota pool: the national
 * per-drug totals (from get_drug_quota_usage, per-drug/national since
 * supabase/migrations/20260819000300_national_quota_pool.sql) alongside the
 * per-clinic breakdown of who consumed that pool (get_quota_usage_by_clinic).
 *
 * This is a sibling of useDrugQuotaUsage, not a replacement — the seven
 * existing clinic-facing pages keep using that hook unchanged. Note that its
 * figures are national too (it calls the same RPC); what is exclusive to this
 * hook is the per-clinic breakdown, which only the HQ dashboard needs.
 */
export function useHqQuotaUsage(year: number) {
  const nationalQuery = useQuery({
    queryKey: ["hq-quota-usage", year],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_drug_quota_usage", { p_year: year });
      if (error) throw error;
      return (data ?? []) as NationalQuotaUsage[];
    },
    refetchInterval: 30000,
  });

  const byClinicQuery = useQuery({
    queryKey: ["hq-quota-usage-by-clinic", year],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_quota_usage_by_clinic", { p_year: year });
      if (error) throw error;
      return (data ?? []) as ClinicQuotaUsage[];
    },
    refetchInterval: 30000,
  });

  const byClinicDrug = useMemo(() => {
    const map = new Map<string, ClinicQuotaUsage>();
    for (const row of byClinicQuery.data ?? []) {
      map.set(`${row.clinic_id}|${row.drug_id}`, row);
    }
    return map;
  }, [byClinicQuery.data]);

  return {
    national: nationalQuery.data ?? [],
    isLoading: nationalQuery.isLoading || byClinicQuery.isLoading,
    isError: nationalQuery.isError || byClinicQuery.isError,
    error: nationalQuery.error ?? byClinicQuery.error,
    byClinicDrug,
    nationalQuery,
    byClinicQuery,
  };
}
