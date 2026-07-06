
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const units = ["tablet", "vial", "sachet", "capsule", "other"] as const;

const drugSchema = z.object({
  drug_name: z.string().trim().min(1, "Drug name is required").max(200),
  no_kod: z.string().max(50).optional().default(""),
  unit_pengukuran: z.string().min(1).default("tablet"),
  kumpulan: z.string().max(50).optional().default(""),
  pergerakan: z.string().max(50).optional().default(""),
  stok_min: z.coerce.number().int().min(0).optional().default(0),
  stok_reorder: z.coerce.number().int().min(0).optional().default(0),
  stok_max: z.coerce.number().int().min(0).optional().default(0),
});

type DrugFormValues = z.infer<typeof drugSchema>;

interface Drug {
  id: string;
  drug_name: string;
  no_kod: string;
  unit_pengukuran: string;
  kumpulan: string;
  pergerakan: string;
  stok_min: number;
  stok_reorder: number;
  stok_max: number;
  is_active: boolean;
}

interface DrugFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drug?: Drug | null;
}

export function DrugFormDialog({ open, onOpenChange, drug }: DrugFormDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = !!drug;

  const form = useForm<DrugFormValues>({
    resolver: zodResolver(drugSchema),
    defaultValues: {
      drug_name: "",
      no_kod: "",
      unit_pengukuran: "tablet",
      kumpulan: "",
      pergerakan: "",
      stok_min: 0,
      stok_reorder: 0,
      stok_max: 0,
    },
  });

  useEffect(() => {
    if (open) {
      if (drug) {
        form.reset({
          drug_name: drug.drug_name,
          no_kod: drug.no_kod ?? "",
          unit_pengukuran: drug.unit_pengukuran,
          kumpulan: drug.kumpulan ?? "",
          pergerakan: drug.pergerakan ?? "",
          stok_min: drug.stok_min ?? 0,
          stok_reorder: drug.stok_reorder ?? 0,
          stok_max: drug.stok_max ?? 0,
        });
      } else {
        form.reset();
      }
    }
  }, [open, drug, form]);

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

      const payload = { ...values, drug_name: values.drug_name } as { drug_name: string; [key: string]: unknown };
      if (isEdit && drug) {
        const { error } = await supabase
          .from("drugs")
          .update(payload)
          .eq("id", drug.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("drugs").insert([payload as any]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drugs"] });
      queryClient.invalidateQueries({ queryKey: ["drugs-for-request"] });
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
            {/* Basic info */}
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="drug_name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Drug Name *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="no_kod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Code No.</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="unit_pengukuran" render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit of Measure</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {units.map((u) => (
                        <SelectItem key={u} value={u} className="capitalize">{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="kumpulan" render={({ field }) => (
                <FormItem>
                  <FormLabel>Group</FormLabel>
                  <FormControl><Input placeholder="e.g. A/KK" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="pergerakan" render={({ field }) => (
                <FormItem>
                  <FormLabel>Movement</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                </FormItem>
              )} />
            </div>

            {/* Stock levels */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">Stock Levels (Current Year)</h4>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="stok_min" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Minimum</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="stok_reorder" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Reorder</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="stok_max" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Maximum</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
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
