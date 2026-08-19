import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
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
  currentQuotaLimit: number;
  /**
   * perlu_kelulusan_pakar — see DrugQuotaDialog for why controlled drugs no
   * longer write drug_quotas from this clinic-level dialog (national pool,
   * set only via set_national_drug_quota from the Logistik HQ dashboard).
   */
  isControlled: boolean;
  /** National quota/usage for this drug this year. Only read when isControlled. */
  nationalQuota?: NationalQuota | null;
}

export default function ReplenishQuotaDialog({ open, onOpenChange, drugId, drugName, currentQuotaLimit, isControlled, nationalQuota }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const currentYear = new Date().getFullYear();
  const [amountInput, setAmountInput] = useState<string>("");

  useEffect(() => {
    if (open) setAmountInput("");
  }, [open]);

  const replenish = useMutation({
    mutationFn: async () => {
      const amount = parseInt(amountInput, 10);
      if (isNaN(amount) || amount <= 0) throw new Error("Enter a valid amount to add");

      const newLimit = currentQuotaLimit + amount;
      const { error: quotaError } = await supabase
        .from("drug_quotas")
        .upsert(
          { drug_id: drugId, year: currentYear, quota_limit: newLimit },
          { onConflict: "clinic_id,drug_id,year" },
        );
      if (quotaError) throw quotaError;

      const { error: txnError } = await supabase.from("transactions").insert({
        drug_id: drugId,
        jenis: "terimaan",
        kuantiti: amount,
        tarikh: format(new Date(), "yyyy-MM-dd"),
        created_by: user?.id,
        catatan: "Quota replenishment",
      });
      if (txnError) throw txnError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drugs"] });
      queryClient.invalidateQueries({ queryKey: ["drug-quota"] });
      queryClient.invalidateQueries({ queryKey: ["drug-quota-usage"] });
      queryClient.invalidateQueries({ queryKey: ["fms-drug-stock"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-baki-awal"] });
      queryClient.invalidateQueries({ queryKey: ["drug-stock"] });
      toast.success("Quota replenished.");
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to replenish quota."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {isControlled ? (
          <>
            <DialogHeader>
              <DialogTitle>Quota — {drugName}</DialogTitle>
              <DialogDescription>
                This drug requires specialist approval and is quota-pooled nationally.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="rounded-md border bg-muted/40 p-3 space-y-1">
                <p className="text-sm font-medium">National Quota — {currentYear}</p>
                {nationalQuota ? (
                  <p className="text-sm text-muted-foreground">
                    {nationalQuota.remaining} / {nationalQuota.quota_limit} remaining
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No national quota set for {currentYear} yet.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Set nationally by PKD Logistik on the Logistik HQ dashboard — not editable here.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Replenish Quota — {drugName}</DialogTitle>
              <DialogDescription>
                Add extra units to this drug's {currentYear} quota. Also adds the same amount to physical stock.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-xs text-muted-foreground">Current quota: {currentQuotaLimit}</p>
              <div className="space-y-1.5">
                <Label htmlFor="replenish-input">Amount to Add</Label>
                <Input
                  id="replenish-input"
                  type="number"
                  min={1}
                  value={amountInput}
                  onChange={e => setAmountInput(e.target.value)}
                  placeholder="e.g. 10"
                />
              </div>
              {amountInput && !isNaN(parseInt(amountInput, 10)) && (
                <p className="text-xs text-muted-foreground">
                  New quota total: {currentQuotaLimit + parseInt(amountInput, 10)}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => replenish.mutate()} disabled={replenish.isPending || amountInput === ""}>
                {replenish.isPending ? "Saving..." : "Replenish"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
