import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface NationalQuota {
  quota_limit: number;
  used: number;
  remaining: number;
  alert_threshold_pct: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drugId: string;
  drugName: string;
  /**
   * perlu_kelulusan_pakar — controlled drugs are quota-pooled nationally
   * (supabase/migrations/20260819000300_national_quota_pool.sql) and set only
   * via set_national_drug_quota by logistic_pharmacist/super_admin from the
   * Logistik HQ dashboard. A clinic admin's direct drug_quotas upsert is now
   * denied by RLS for these drugs, so for isControlled this dialog shows the
   * national figure read-only instead of attempting that write.
   */
  isControlled: boolean;
  /** National quota/usage for this drug this year, e.g. from useDrugQuotaUsage's byDrugId on the calling page. Only read when isControlled. */
  nationalQuota?: NationalQuota | null;
}

export default function DrugQuotaDialog({ open, onOpenChange, drugId, drugName, isControlled, nationalQuota }: Props) {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const currentYear = new Date().getFullYear();
  const [quotaInput, setQuotaInput] = useState<string>("");
  const [alertPctInput, setAlertPctInput] = useState<string>("20");

  const { data: existing } = useQuery({
    queryKey: ["drug-quota", drugId, currentYear, profile?.clinic_id],
    enabled: open && !isControlled,
    queryFn: async () => {
      // drug_quotas is now clinic-scoped (a drug can hold a different quota
      // per clinic) — without this filter a super_admin, who can see every
      // clinic's row, would get more than one row and maybeSingle() throws.
      const { data } = await supabase
        .from("drug_quotas")
        .select("quota_limit, alert_threshold_pct")
        .eq("drug_id", drugId)
        .eq("year", currentYear)
        .eq("clinic_id", profile?.clinic_id ?? "")
        .maybeSingle();
      return data as { quota_limit: number; alert_threshold_pct: number } | null;
    },
  });

  useEffect(() => {
    setQuotaInput(existing ? String(existing.quota_limit) : "");
    setAlertPctInput(existing ? String(existing.alert_threshold_pct) : "20");
  }, [existing, open]);

  const save = useMutation({
    mutationFn: async () => {
      const limit = parseInt(quotaInput, 10);
      if (isNaN(limit) || limit < 0) throw new Error("Invalid quota value");
      const alertPct = parseInt(alertPctInput, 10);
      if (isNaN(alertPct) || alertPct < 0 || alertPct > 100) throw new Error("Invalid alert threshold");
      const { error } = await supabase
        .from("drug_quotas")
        .upsert(
          { drug_id: drugId, year: currentYear, quota_limit: limit, alert_threshold_pct: alertPct },
          { onConflict: "clinic_id,drug_id,year" },
        );
      if (error) throw error;

      // Opening balance = allocated quota. Seed it once, only if this drug has never
      // had a stock movement recorded (avoids clobbering a real ledger on correction).
      if (limit > 0) {
        const { count, error: countError } = await supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("drug_id", drugId);
        if (countError) throw countError;
        if (!count) {
          const { error: baliError } = await supabase.from("transactions").insert({
            drug_id: drugId,
            jenis: "baki_awal",
            kuantiti: limit,
            tarikh: format(new Date(), "yyyy-MM-dd"),
            created_by: user?.id,
            catatan: "Auto-seeded from annual quota",
          });
          if (baliError) throw baliError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drug-quota"] });
      queryClient.invalidateQueries({ queryKey: ["drug-quota-usage"] });
      queryClient.invalidateQueries({ queryKey: ["fms-drug-stock"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-baki-awal"] });
      toast.success("Quota saved.");
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save quota."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Annual Quota — {drugName}</DialogTitle>
        </DialogHeader>
        {isControlled ? (
          <>
            <div className="space-y-3 py-2">
              <div className="rounded-md border bg-muted/40 p-3 space-y-1">
                <p className="text-sm font-medium">National Quota — {currentYear}</p>
                {nationalQuota ? (
                  <p className="text-sm text-muted-foreground">
                    {nationalQuota.remaining} / {nationalQuota.quota_limit} remaining
                    {" "}(alert at {nationalQuota.alert_threshold_pct}% remaining)
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No national quota set for {currentYear} yet.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                This drug requires specialist approval and is quota-pooled nationally across every clinic. Its
                quota is set nationally by PKD Logistik on the Logistik HQ dashboard — not editable here.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Set the maximum number of patients that may receive this controlled drug in {currentYear}.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="quota-input">Annual Patient Quota</Label>
                <Input
                  id="quota-input"
                  type="number"
                  min={0}
                  value={quotaInput}
                  onChange={e => setQuotaInput(e.target.value)}
                  placeholder="e.g. 60"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alert-threshold-input">Low-Quota Alert Threshold (%)</Label>
                <Input
                  id="alert-threshold-input"
                  type="number"
                  min={0}
                  max={100}
                  value={alertPctInput}
                  onChange={e => setAlertPctInput(e.target.value)}
                  placeholder="e.g. 20"
                />
                <p className="text-xs text-muted-foreground">
                  Warn when remaining quota drops to this percentage or below.
                </p>
              </div>
              {existing && (
                <p className="text-xs text-muted-foreground">
                  Current quota for {currentYear}: {existing.quota_limit} patients, alert at {existing.alert_threshold_pct}% remaining
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending || quotaInput === "" || alertPctInput === ""}>
                {save.isPending ? "Saving..." : "Save Quota"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
