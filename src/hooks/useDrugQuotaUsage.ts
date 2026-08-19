import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DrugQuotaUsage = {
  clinic_id: string;
  drug_id: string;
  year: number;
  quota_limit: number;
  alert_threshold_pct: number;
  used: number;
  remaining: number;
};

/**
 * Single source of truth for "how much of a drug's annual quota is used",
 * shared by every page that shows a quota badge (Index, DoctorRequest,
 * DrugMaster, MoDashboard, FmsDashboard, SpecialistDashboard, PatientRegistry).
 *
 * These figures are NATIONAL, not clinic-scoped. Backed by the
 * get_drug_quota_usage() RPC (security definer), which since
 * supabase/migrations/20260819000300_national_quota_pool.sql returns ONE ROW
 * PER DRUG sourced from the HQ clinic's drug_quotas row, with usage counted
 * across every clinic: enrolments in drug_quota_patients (sum(kuota), deduped
 * by normalized IC) plus any dispensing_requests not already covered by an
 * enrolment. `clinic_id` is still on the row but is always hq_clinic_id() —
 * never the caller's clinic. Anything rendering these numbers must say so, or
 * a clinic user reads a shared balance as their own.
 *
 * Computing this client-side per page was the previous approach and is what
 * caused DrugMaster / MoDashboard / DoctorRequest / FmsDashboard /
 * SpecialistDashboard to each show slightly different "remaining" numbers.
 */
export function useDrugQuotaUsage(year: number) {
  const query = useQuery({
    queryKey: ["drug-quota-usage", year],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_drug_quota_usage", { p_year: year });
      if (error) throw error;
      return (data ?? []) as DrugQuotaUsage[];
    },
    refetchInterval: 30000,
  });

  const byDrugId = useMemo(() => {
    const map = new Map<string, DrugQuotaUsage>();
    for (const row of query.data ?? []) map.set(row.drug_id, row);
    return map;
  }, [query.data]);

  return { ...query, byDrugId };
}
