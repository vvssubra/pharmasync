import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type MasterPatientRow =
  Database["public"]["Functions"]["get_master_patient_registry"]["Returns"][number];

export const MASTER_PATIENT_PAGE_SIZE = 50;

/**
 * HQ-only, read-only view of the national patient registry: one row per
 * distinct patient (deduped by normalized IC across every clinic — see
 * get_master_patient_registry, supabase/migrations and Task 6's report),
 * paginated server-side via p_limit/p_offset.
 *
 * Deliberately NOT a live-ops surface (no refetchInterval) — this is a
 * lookup table, not something that needs to tick in the background like the
 * quota dashboards. The caller is expected to debounce `search` itself
 * (300ms, matching the pattern in useDoseSuggestion.ts/usePathwayCheck.ts)
 * before it lands in this hook's queryKey.
 */
export function useMasterPatientRegistry(search: string, page: number) {
  const offset = page * MASTER_PATIENT_PAGE_SIZE;

  const query = useQuery({
    queryKey: ["hq-master-patients", search, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_master_patient_registry", {
        p_search: search || null,
        p_limit: MASTER_PATIENT_PAGE_SIZE,
        p_offset: offset,
      });
      if (error) throw error;
      return (data ?? []) as MasterPatientRow[];
    },
  });

  const rows = query.data ?? [];
  const totalCount = rows[0]?.total_count ?? 0;

  return {
    rows,
    totalCount,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
