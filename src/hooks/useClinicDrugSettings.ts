import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type DrugSettings = {
  stok_min: number;
  stok_reorder: number;
  stok_max: number;
  is_blocked: boolean;
};

// Identical to a fresh drugs row's own column defaults — a clinic with no
// clinic_drug_settings row (not yet backfilled, or created after Migration A)
// behaves exactly as a fresh drug does today.
export const DEFAULT_DRUG_SETTINGS: DrugSettings = {
  stok_min: 0,
  stok_reorder: 0,
  stok_max: 0,
  is_blocked: false,
};

export function resolveDrugSettings(
  map: Map<string, DrugSettings>,
  drugId: string,
): DrugSettings {
  return map.get(drugId) ?? DEFAULT_DRUG_SETTINGS;
}

/**
 * Single source of truth for "what are this clinic's stock thresholds and
 * local block for a drug", shared by every page that used to read
 * drugs.stok_min/stok_reorder/stok_max/is_blocked directly
 * (Index, MoDashboard, FmsDashboard, DrugLedger, PharmacistFulfilment,
 * RefillWalkinDialog, DoctorRequest, DrugMaster).
 *
 * These figures are per-clinic (supabase/migrations/20260821000100_
 * clinic_drug_settings.sql), unlike drug_quota_usage which is national.
 * is_blocked here is the LOCAL block only — "we don't stock it at this
 * clinic". drugs.is_blocked is the separate NATIONAL block (MOH withdrawal);
 * callers that need "is this drug requestable at all" must OR the two.
 *
 * Computing this client-side per page was the previous approach (reading
 * drugs.stok_* straight off the shared row) and is exactly what made one
 * clinic admin's threshold edit corrupt every other clinic's dashboard.
 *
 * Explicitly filters to the caller's own clinic_id rather than relying on
 * RLS alone: super_admin AND logistic_pharmacist both read past the
 * clinic-scoped RLS branch (20260819000400's cross-clinic SELECT grant), so
 * an unfiltered query would return every clinic's rows and a drug_id-keyed
 * map would silently keep whichever arrived last — the same bug
 * src/lib/stock.ts:34's blended-clinic map would have if RLS ever returned
 * more than one clinic's transactions. Returns scopeAmbiguous: true with an
 * empty map when profile.clinic_id is null (a super_admin with no clinic of
 * their own), mirroring supabase/functions/ai-query/index.ts:202-209, which
 * already refuses to blend rather than guess.
 */
export function useClinicDrugSettings(clinicIdOverride?: string | null) {
  const { profile } = useAuth();
  // An explicit clinic wins. That is how a super_admin gets real thresholds
  // instead of the all-zero default: they have no clinic of their own, so
  // without an override every drug grades as "NO LEVEL" on a page that has
  // otherwise been scoped to a clinic (see useClinicScope). Passing undefined
  // — every caller that has no clinic picker — keeps the old behaviour.
  const clinicId = clinicIdOverride !== undefined
    ? clinicIdOverride
    : profile?.clinic_id ?? null;
  const scopeAmbiguous = clinicId === null;

  const query = useQuery({
    queryKey: ["clinic-drug-settings", clinicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinic_drug_settings")
        .select("drug_id, stok_min, stok_reorder, stok_max, is_blocked")
        .eq("clinic_id", clinicId as string);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !scopeAmbiguous,
    refetchInterval: 30000,
  });

  const byDrugId = useMemo(() => {
    const map = new Map<string, DrugSettings>();
    if (scopeAmbiguous) return map;
    for (const row of query.data ?? []) {
      map.set(row.drug_id, {
        stok_min: row.stok_min,
        stok_reorder: row.stok_reorder,
        stok_max: row.stok_max,
        is_blocked: row.is_blocked,
      });
    }
    return map;
  }, [query.data, scopeAmbiguous]);

  return { ...query, byDrugId, scopeAmbiguous };
}
