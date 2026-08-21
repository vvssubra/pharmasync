
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/errors";

const drugSchema = z.object({
  drug_name: z.string().trim().min(1, "Drug name is required").max(200),
  quota_limit: z.coerce.number().int().min(0).optional().default(0),
  stok_min: z.coerce.number().int().min(0).optional().default(0),
  stok_reorder: z.coerce.number().int().min(0).optional().default(0),
  stok_max: z.coerce.number().int().min(0).optional().default(0),
  unit_price: z.coerce.number().min(0).optional(),
}).refine(
  (v) => v.stok_min <= v.stok_reorder,
  { message: "Min must not exceed Reorder level", path: ["stok_min"] },
).refine(
  (v) => v.stok_reorder <= v.stok_max || v.stok_max === 0,
  { message: "Reorder must not exceed Max", path: ["stok_reorder"] },
);

type DrugFormValues = z.infer<typeof drugSchema>;

interface Drug {
  id: string;
  drug_name: string;
  is_active: boolean;
  stok_min?: number | null;
  stok_reorder?: number | null;
  stok_max?: number | null;
  unit_price?: number | null;
  /** perlu_kelulusan_pakar — see the isControlled comment below. */
  perlu_kelulusan_pakar?: boolean | null;
}

interface NationalQuota {
  quota_limit: number;
  used: number;
  remaining: number;
  alert_threshold_pct: number;
}

interface DrugFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drug?: Drug | null;
  /** National quota/usage for this drug this year, e.g. from useDrugQuotaUsage's byDrugId on the calling page. Only read when the drug is controlled. */
  nationalQuota?: NationalQuota | null;
}

export function DrugFormDialog({ open, onOpenChange, drug, nationalQuota }: DrugFormDialogProps) {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const isEdit = !!drug;
  const currentYear = new Date().getFullYear();
  // Staff stationed at the national HQ clinic ('Logistik PKDJB') have NO
  // drug_quotas write path at all — not just for controlled drugs. Their insert
  // is stamped with the HQ clinic_id by trg_stamp_clinic_id and then refused by
  // the write policies, which exclude the HQ clinic to keep the national pool
  // behind set_national_drug_quota
  // (supabase/migrations/20260819000600_drug_quotas_clinic_admin_write.sql).
  // `drugs` is a global table, so an HQ admin can open this dialog for any
  // drug; without this flag the upsert below would fire and fail — and since
  // the `drugs` write above it has already committed, the user would get an
  // error toast on an edit that actually succeeded.
  const isAtHqClinic = !!profile?.is_hq_clinic;
  // perlu_kelulusan_pakar — controlled drugs are quota-pooled nationally
  // (supabase/migrations/20260819000300_national_quota_pool.sql) and set only
  // via set_national_drug_quota by logistic_pharmacist/super_admin. A clinic
  // admin's direct drug_quotas upsert below is now denied by RLS for these
  // drugs, so this dialog shows the national figure read-only instead. A new
  // (not-yet-saved) drug has no perlu_kelulusan_pakar yet, so it is never
  // treated as controlled here.
  const isControlled = isEdit && !!drug?.perlu_kelulusan_pakar;

  // The two reasons this form must not touch drug_quotas. Both are RLS denials
  // if attempted, so both gate the same three things: the read below, the
  // upsert in the mutation, and the editable field in the form.
  const quotaWriteBlocked = isControlled || isAtHqClinic;

  const { data: existingQuota, error: existingQuotaError } = useQuery({
    queryKey: ["drug-quota", drug?.id, currentYear, profile?.clinic_id],
    // Also requires a clinic: drug_quotas rows are stamped with the caller's
    // clinic_id, so a user with none (super_admin) has no row of their own to
    // pre-fill from and no write path either.
    enabled: open && isEdit && !quotaWriteBlocked && !!profile?.clinic_id,
    queryFn: async () => {
      // clinic_id filter is not optional. Since the national pool landed, a
      // drug can hold BOTH an HQ row and a legacy per-clinic row for the same
      // (drug_id, year); a viewer who can see more than one clinic's rows would
      // then get 2+ rows back and maybeSingle() errors. That error used to be
      // dropped on the floor by destructuring only `data`, and the form quietly
      // pre-filled 0 — i.e. offered to overwrite a real quota with zero. Match
      // DrugQuotaDialog: scope to this clinic, and let the error surface.
      const { data, error } = await supabase
        .from("drug_quotas")
        .select("quota_limit")
        .eq("drug_id", drug!.id)
        .eq("year", currentYear)
        .eq("clinic_id", profile!.clinic_id!)
        .maybeSingle();
      if (error) throw error;
      return data as { quota_limit: number } | null;
    },
  });

  const form = useForm<DrugFormValues>({
    resolver: zodResolver(drugSchema),
    defaultValues: {
      drug_name: "",
      quota_limit: 0,
      stok_min: 0,
      stok_reorder: 0,
      stok_max: 0,
      unit_price: undefined,
    },
  });

  useEffect(() => {
    if (open) {
      if (drug) {
        form.reset({
          drug_name: drug.drug_name,
          quota_limit: existingQuota?.quota_limit ?? 0,
          stok_min: drug.stok_min ?? 0,
          stok_reorder: drug.stok_reorder ?? 0,
          stok_max: drug.stok_max ?? 0,
          unit_price: drug.unit_price ?? undefined,
        });
      } else {
        form.reset();
      }
    }
  }, [open, drug, existingQuota, form]);

  const mutation = useMutation({
    mutationFn: async (values: DrugFormValues) => {
      // Check duplicate name
      const { data: existing } = await supabase
        .from("drugs")
        .select("id")
        .eq("drug_name", values.drug_name)
        .maybeSingle();

      if (existing && (!isEdit || existing.id !== drug?.id)) {
        throw new Error("DUPLICATE");
      }

      let drugId: string;
      if (isEdit && drug) {
        const { error } = await supabase
          .from("drugs")
          .update({
            drug_name: values.drug_name,
            stok_min: values.stok_min,
            stok_reorder: values.stok_reorder,
            stok_max: values.stok_max,
            unit_price: values.unit_price ?? null,
          })
          .eq("id", drug.id);
        if (error) throw error;
        drugId = drug.id;
      } else {
        const { data: inserted, error } = await supabase
          .from("drugs")
          .insert([{
            drug_name: values.drug_name,
            stok_min: values.stok_min,
            stok_reorder: values.stok_reorder,
            stok_max: values.stok_max,
            unit_price: values.unit_price ?? null,
          }])
          .select("id")
          .single();
        if (error) throw error;
        drugId = inserted.id;
      }

      // Skipped for controlled drugs (national pool, set only via
      // set_national_drug_quota from the Logistik HQ dashboard) and for any
      // drug when the caller is stationed at the HQ clinic (no drug_quotas
      // write path at all). Both would be RLS denials, and the `drugs` write
      // above has already committed by this point — see quotaWriteBlocked.
      if (!quotaWriteBlocked) {
        const { error: quotaError } = await supabase
          .from("drug_quotas")
          .upsert(
            { drug_id: drugId, year: currentYear, quota_limit: values.quota_limit },
            { onConflict: "clinic_id,drug_id,year" },
          );
        if (quotaError) throw quotaError;

        // Opening balance = allocated quota. Seed it once, only if this drug has never
        // had a stock movement recorded (avoids clobbering a real ledger on edit).
        if (values.quota_limit > 0) {
          const { count, error: countError } = await supabase
            .from("transactions")
            .select("id", { count: "exact", head: true })
            .eq("drug_id", drugId);
          if (countError) throw countError;
          if (!count) {
            const { error: baliError } = await supabase.from("transactions").insert({
              drug_id: drugId,
              jenis: "baki_awal",
              kuantiti: values.quota_limit,
              tarikh: format(new Date(), "yyyy-MM-dd"),
              created_by: user?.id,
              catatan: "Auto-seeded from annual quota",
            });
            // 23505 = a concurrent writer already seeded this clinic's opening
            // balance for this drug (idx_one_baki_awal_per_clinic_drug) — fine.
            if (baliError && baliError.code !== "23505") throw baliError;
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drugs"] });
      queryClient.invalidateQueries({ queryKey: ["drugs-for-request"] });
      queryClient.invalidateQueries({ queryKey: ["drug-quota"] });
      queryClient.invalidateQueries({ queryKey: ["drug-quota-usage"] });
      queryClient.invalidateQueries({ queryKey: ["fms-drug-stock"] });
      queryClient.invalidateQueries({ queryKey: ["mo-drug-quota"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-baki-awal"] });
      queryClient.invalidateQueries({ queryKey: ["drug-stock"] });
      toast.success(isEdit ? "Drug updated" : "Drug added");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      if (err.message === "DUPLICATE") {
        form.setError("drug_name", { message: "Drug name already exists" });
      } else {
        toast.error("Ralat: " + err.message);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Drug" : "Add Drug"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update drug information." : "Fill in new drug details."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-6">
            <FormField control={form.control} name="drug_name" render={({ field }) => (
              <FormItem>
                <FormLabel>Drug Name *</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {/* isControlled is checked first on purpose: both branches are
                read-only, so when an HQ-stationed user opens a controlled drug
                the national figure is the more useful of the two to show. */}
            {isControlled ? (
              <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
                <p className="text-sm font-medium">National Quota — {currentYear}</p>
                {nationalQuota ? (
                  <p className="text-sm text-muted-foreground">
                    {nationalQuota.remaining} / {nationalQuota.quota_limit} remaining
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No national quota set for {currentYear} yet.</p>
                )}
                <p className="text-xs text-muted-foreground">
                  This drug requires specialist approval and is quota-pooled nationally. Set nationally by PKD
                  Logistik on the Logistik HQ dashboard — not editable here.
                </p>
              </div>
            ) : isAtHqClinic ? (
              <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
                <p className="text-sm font-medium">Quota not set from HQ</p>
                <p className="text-xs text-muted-foreground">
                  Annual quotas are not set from the HQ clinic. Controlled drugs are pooled nationally and set on
                  the Logistik HQ dashboard. Drugs that do not require specialist approval carry no quota at all —
                  nothing limits how many patients may receive them. The rest of this drug's details save normally.
                </p>
              </div>
            ) : (
              <FormField control={form.control} name="quota_limit" render={({ field }) => (
                <FormItem>
                  <FormLabel>Number of Quota</FormLabel>
                  <FormControl><Input type="number" {...field} /></FormControl>
                  {/* Without this the field silently shows 0 when the read
                      failed, which reads as "no quota set" and invites saving
                      a zero over a real value. */}
                  {existingQuotaError && (
                    <p className="text-xs text-destructive">
                      Could not load this drug's current quota ({getErrorMessage(existingQuotaError, "unknown error")}).
                      Saving will overwrite it with whatever is shown here.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )} />
            )}
            <FormField control={form.control} name="unit_price" render={({ field }) => (
              <FormItem>
                <FormLabel>Unit Price (RM)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    placeholder="Optional"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="space-y-2">
              <p className="text-sm font-medium">Stock Levels</p>
              <p className="text-xs text-muted-foreground">
                Drives the Critical/Low/Normal/Excess status shown on the dashboards. Leave all at 0 if you're not tracking physical stock levels for this drug.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FormField control={form.control} name="stok_min" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min</FormLabel>
                    <FormControl><Input type="number" min={0} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="stok_reorder" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reorder</FormLabel>
                    <FormControl><Input type="number" min={0} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="stok_max" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max</FormLabel>
                    <FormControl><Input type="number" min={0} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
