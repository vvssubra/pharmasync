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
 * shared by every page that shows a quota badge (DoctorRequest, DrugMaster,
 * MoDashboard, FmsDashboard, SpecialistDashboard, PatientRegistry).
 *
 * Backed by the get_drug_quota_usage() RPC (security definer, clinic-scoped
 * server-side), which counts enrolments in drug_quota_patients (sum(kuota))
 * plus any dispensing_requests not already covered by an enrolment — see
 * supabase/migrations/20260727000000_drug_quota_patients.sql. Computing this
 * client-side per page was the previous approach and is what caused
 * DrugMaster / MoDashboard / DoctorRequest / FmsDashboard / SpecialistDashboard
 * to each show slightly different "remaining" numbers.
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
