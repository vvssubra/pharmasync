// src/components/NationalQuotaDialog.tsx
//
// Sets the NATIONAL controlled-drug quota (the HQ clinic's drug_quotas row,
// pooled across every clinic — see supabase/migrations/20260819000300_
// national_quota_pool.sql). Sibling of DrugQuotaDialog.tsx, which sets the
// pre-pooling per-clinic row and is still used nowhere in the national flow.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// PKDJB allocates this drug's national quota as a rate — a fixed amount per
// FMS (Family Medicine Specialist) unit — rather than a single number an
// admin has to reverse-engineer by hand. 29 is today's district FMS count,
// offered as the starting suggestion; it is fully editable per drug, same as
// the quota-per-FMS figure it's multiplied by.
const DEFAULT_FMS_COUNT = 29;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drugId: string;
  drugName: string;
  year: number;
  /**
   * Pre-filled from the row that opened this dialog (already loaded by
   * useHqQuotaUsage on LogistikDashboard) rather than re-fetched here — this
   * dialog is only ever opened from a row that is already on screen, so a
   * second read of the same data would just be a redundant round trip.
   */
  currentFmsCount: number | null;
  currentQuotaPerFms: number | null;
  /**
   * The enforced total as it stands today. Only used to surface a note when
   * a quota was set before the FMS-count x quota-per-FMS model existed (i.e.
   * currentFmsCount/currentQuotaPerFms are both null but a total is already
   * being enforced) — saving here always replaces it with fmsCount x
   * quotaPerFms, never reads it back as an input.
   */
  currentQuotaLimit: number | null;
  currentAlertThresholdPct: number | null;
}

export default function NationalQuotaDialog({
  open,
  onOpenChange,
  drugId,
  drugName,
  year,
  currentFmsCount,
  currentQuotaPerFms,
  currentQuotaLimit,
  currentAlertThresholdPct,
}: Props) {
  const queryClient = useQueryClient();
  const [fmsCountInput, setFmsCountInput] = useState<string>("");
  const [quotaPerFmsInput, setQuotaPerFmsInput] = useState<string>("");
  const [alertPctInput, setAlertPctInput] = useState<string>("20");

  useEffect(() => {
    if (!open) return;
    setFmsCountInput(currentFmsCount != null ? String(currentFmsCount) : String(DEFAULT_FMS_COUNT));
    setQuotaPerFmsInput(currentQuotaPerFms != null ? String(currentQuotaPerFms) : "");
    setAlertPctInput(currentAlertThresholdPct != null ? String(currentAlertThresholdPct) : "20");
  }, [open, currentFmsCount, currentQuotaPerFms, currentAlertThresholdPct]);

  const fmsCount = parseInt(fmsCountInput, 10);
  const quotaPerFms = parseInt(quotaPerFmsInput, 10);
  const computedTotal = !isNaN(fmsCount) && !isNaN(quotaPerFms) ? fmsCount * quotaPerFms : null;
  const showLegacyNote = currentFmsCount == null && currentQuotaPerFms == null && currentQuotaLimit != null;

  const save = useMutation({
    mutationFn: async () => {
      if (isNaN(fmsCount) || fmsCount < 0) throw new Error("Invalid FMS count");
      if (isNaN(quotaPerFms) || quotaPerFms < 0) throw new Error("Invalid quota per FMS");
      const alertPct = parseInt(alertPctInput, 10);
      if (isNaN(alertPct) || alertPct < 0 || alertPct > 100) throw new Error("Invalid alert threshold");
      const { error } = await supabase.rpc("set_national_drug_quota", {
        p_drug_id: drugId,
        p_year: year,
        p_fms_count: fmsCount,
        p_quota_per_fms: quotaPerFms,
        p_alert_threshold_pct: alertPct,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // Prefix invalidation, no year in either key, so every poll of either
      // hook picks this up without a page reload:
      //   - ["hq-quota-usage", year] — this dashboard (useHqQuotaUsage)
      //   - ["drug-quota-usage", year] — the seven clinic-scoped pages that
      //     read useDrugQuotaUsage (DoctorRequest, DrugMaster, MoDashboard,
      //     FmsDashboard, SpecialistDashboard, PatientRegistry, ...)
      // byClinicDrug's key (["hq-quota-usage-by-clinic", year]) is not
      // invalidated: get_quota_usage_by_clinic() returns per-clinic `used`
      // only, never quota_limit/alert_threshold_pct, so nothing this dialog
      // writes can change what it returns.
      queryClient.invalidateQueries({ queryKey: ["hq-quota-usage"] });
      queryClient.invalidateQueries({ queryKey: ["drug-quota-usage"] });
      toast.success("National quota saved.");
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save national quota."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>National Quota — {drugName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Set the {year} national quota for this controlled drug as FMS count × quota per FMS, pooled across every clinic nationally.
          </p>
          {showLegacyNote && (
            <p className="text-xs text-muted-foreground">
              Current enforced total: {currentQuotaLimit} (set before the FMS calculator existed — saving here replaces it).
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="national-fms-count-input">FMS Count</Label>
            <Input
              id="national-fms-count-input"
              type="number"
              min={0}
              value={fmsCountInput}
              onChange={e => setFmsCountInput(e.target.value)}
              placeholder="e.g. 29"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="national-quota-per-fms-input">Quota per FMS</Label>
            <Input
              id="national-quota-per-fms-input"
              type="number"
              min={0}
              value={quotaPerFmsInput}
              onChange={e => setQuotaPerFmsInput(e.target.value)}
              placeholder="e.g. 10"
            />
          </div>
          <p className="text-sm font-medium">
            {computedTotal != null ? `= ${computedTotal} total` : "Enter both fields to see the total"}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="national-alert-threshold-input">Low-Quota Alert Threshold (%)</Label>
            <Input
              id="national-alert-threshold-input"
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || fmsCountInput === "" || quotaPerFmsInput === "" || alertPctInput === ""}>
            {save.isPending ? "Saving..." : "Save National Quota"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
