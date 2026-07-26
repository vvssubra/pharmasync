
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

const drugSchema = z.object({
  drug_name: z.string().trim().min(1, "Drug name is required").max(200),
  quota_limit: z.coerce.number().int().min(0).optional().default(0),
});

type DrugFormValues = z.infer<typeof drugSchema>;

interface Drug {
  id: string;
  drug_name: string;
  is_active: boolean;
}

interface DrugFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drug?: Drug | null;
}

export function DrugFormDialog({ open, onOpenChange, drug }: DrugFormDialogProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isEdit = !!drug;
  const currentYear = new Date().getFullYear();

  const { data: existingQuota } = useQuery({
    queryKey: ["drug-quota", drug?.id, currentYear],
    enabled: open && isEdit,
    queryFn: async () => {
      const { data } = await supabase
        .from("drug_quotas")
        .select("quota_limit")
        .eq("drug_id", drug!.id)
        .eq("year", currentYear)
        .maybeSingle();
      return data as { quota_limit: number } | null;
    },
  });

  const form = useForm<DrugFormValues>({
    resolver: zodResolver(drugSchema),
    defaultValues: {
      drug_name: "",
      quota_limit: 0,
    },
  });

  useEffect(() => {
    if (open) {
      if (drug) {
        form.reset({
          drug_name: drug.drug_name,
          quota_limit: existingQuota?.quota_limit ?? 0,
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
          .update({ drug_name: values.drug_name })
          .eq("id", drug.id);
        if (error) throw error;
        drugId = drug.id;
      } else {
        const { data: inserted, error } = await supabase
          .from("drugs")
          .insert([{ drug_name: values.drug_name }])
          .select("id")
          .single();
        if (error) throw error;
        drugId = inserted.id;
      }

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
          if (baliError) throw baliError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drugs"] });
      queryClient.invalidateQueries({ queryKey: ["drugs-for-request"] });
      queryClient.invalidateQueries({ queryKey: ["drug-quota"] });
      queryClient.invalidateQueries({ queryKey: ["drug-quota-usage"] });
      queryClient.invalidateQueries({ queryKey: ["fms-drug-stock"] });
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
            <FormField control={form.control} name="quota_limit" render={({ field }) => (
              <FormItem>
                <FormLabel>Number of Quota</FormLabel>
                <FormControl><Input type="number" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

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
