import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type ScopeClinic = { id: string; name: string };

/**
 * Which single clinic a page's figures are about.
 *
 * Every clinic-scoped RLS policy reads `is_super_admin() or clinic_id =
 * user_clinic_id()`, so for all roles but one the database has already
 * narrowed the rows and there is nothing to choose. A super_admin is the
 * exception: they see every clinic's rows, and the ledger aggregations on
 * /laporan and / group by drug_id ALONE. Fifteen clinics' rows folded on
 * drug_id do not add up to a district total — they produce a number that
 * looks like one clinic's and is nobody's. computeStockByDrug is worse than
 * wrong-by-summing: a baki_awal SETS the running total rather than adding to
 * it (src/lib/stock.ts), so one clinic's opening balance silently REPLACES
 * whatever the others contributed.
 *
 * So: scope to one clinic and say which, rather than roll up. That is the
 * choice this codebase already makes elsewhere — ai-query refuses a
 * multi-clinic question rather than blending it
 * (supabase/functions/ai-query/index.ts), RoleManagement shows its clinic
 * column only when the list spans clinics, and LogistikDashboard prints
 * clinic_name on every row.
 *
 * A real district roll-up would need computeStockByClinicDrug added INSIDE
 * the `<<<shared-stock` markers in src/lib/stock.ts and mirrored byte-for-byte
 * into supabase/functions/_shared/stock.ts (parity.test.ts enforces this), plus
 * clinic_id on StockTxn. Deliberately not done here.
 *
 * `ready` is the gate every caller must put on its queries: it is false until
 * a clinic is resolved, so an unfiltered — i.e. blended — query never runs,
 * not even for one render.
 */
export function useClinicScope() {
  const { role, profile } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const [picked, setPicked] = useState<string | null>(null);

  const { data: clinics = [] } = useQuery<ScopeClinic[]>({
    queryKey: ["clinics-scope"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clinics").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: isSuperAdmin,
  });

  // Derived rather than synced through an effect: with an effect there is a
  // render in between where nothing is selected, and a caller that forgot to
  // check `ready` would fire an unscoped query in that gap.
  const clinicId = isSuperAdmin
    ? picked ?? clinics[0]?.id ?? null
    : profile?.clinic_id ?? null;

  return {
    isSuperAdmin,
    /** The clinic every figure on the page is about. Null until resolved. */
    clinicId,
    /** Empty for everyone but super_admin — nobody else has a choice to make. */
    clinics,
    setClinicId: setPicked,
    ready: !!clinicId,
  };
}
