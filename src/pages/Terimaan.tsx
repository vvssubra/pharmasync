import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon, Check, ChevronsUpDown, Pencil, FileText } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { computeStock } from "@/lib/stock";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const formSchema = z.object({
  drug_id: z.string().min(1, "Please select a drug"),
  tarikh: z.date({ required_error: "Date is required" }),
  jenis_rujukan: z.string().optional(),
  no_rujukan: z.string().min(1, "Reference number is required"),
  terima_daripada: z.string().optional(),
  kuantiti: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  harga_seunit: z.coerce.number().min(0, "Price must be >= 0").default(0),
  nama_pegawai: z.string().optional(),
  catatan: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function Terimaan() {
  const { profile, role, user } = useAuth();
  const queryClient = useQueryClient();
  const [drugPopoverOpen, setDrugPopoverOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<string | null>(null);
  const [editDrugPopoverOpen, setEditDrugPopoverOpen] = useState(false);

  // Fetch drugs
  const { data: drugs = [] } = useQuery({
    queryKey: ["drugs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drugs")
        .select("id, drug_name, unit_pengukuran")
        .eq("is_active", true)
        .order("drug_name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch recent terimaan
  const { data: recentTerimaan = [] } = useQuery({
    queryKey: ["terimaan-recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, drugs(drug_name)")
        .eq("jenis", "terimaan")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  // Main form
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      drug_id: "",
      tarikh: new Date(),
      jenis_rujukan: "",
      no_rujukan: "",
      terima_daripada: "",
      kuantiti: 0,
      harga_seunit: 0,
      nama_pegawai: profile?.full_name || "",
      catatan: "",
    },
  });

  // Edit form
  const editForm = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      drug_id: "",
      tarikh: new Date(),
      jenis_rujukan: "",
      no_rujukan: "",
      terima_daripada: "",
      kuantiti: 0,
      harga_seunit: 0,
      nama_pegawai: "",
      catatan: "",
    },
  });

  const watchDrugId = form.watch("drug_id");
  const watchKuantiti = form.watch("kuantiti");
  const watchHarga = form.watch("harga_seunit");
  const jumlahRm = (watchKuantiti || 0) * (watchHarga || 0);

  const editWatchKuantiti = editForm.watch("kuantiti");
  const editWatchHarga = editForm.watch("harga_seunit");
  const editJumlahRm = (editWatchKuantiti || 0) * (editWatchHarga || 0);

  const selectedDrug = useMemo(
    () => drugs.find((d) => d.id === watchDrugId),
    [drugs, watchDrugId]
  );

  // Get current baki for selected drug
  const { data: currentBaki } = useQuery({
    queryKey: ["drug-baki", watchDrugId],
    enabled: !!watchDrugId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("drug_id, jenis, kuantiti, tarikh, created_at")
        .eq("drug_id", watchDrugId);
      if (error) throw error;
      return computeStock(watchDrugId, data || []);
    },
  });

  // Insert mutation
  const insertMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const { error } = await supabase.from("transactions").insert({
        drug_id: values.drug_id,
        tarikh: format(values.tarikh, "yyyy-MM-dd"),
        jenis: "terimaan",
        kuantiti: values.kuantiti,
        jenis_rujukan: values.jenis_rujukan || null,
        no_rujukan: values.no_rujukan,
        terima_daripada: values.terima_daripada || null,
        harga_seunit: values.harga_seunit,
        jumlah_rm: values.kuantiti * values.harga_seunit,
        nama_pegawai: values.nama_pegawai || null,
        catatan: values.catatan || null,
        created_by: user?.id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Receipt saved successfully");
      form.reset({
        drug_id: "",
        tarikh: new Date(),
        jenis_rujukan: "",
        no_rujukan: "",
        terima_daripada: "",
        kuantiti: 0,
        harga_seunit: 0,
        nama_pegawai: profile?.full_name || "",
        catatan: "",
      });
      queryClient.invalidateQueries({ queryKey: ["terimaan-recent"] });
      queryClient.invalidateQueries({ queryKey: ["drug-baki"] });
    },
    onError: () => toast.error("Failed to save receipt"),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: FormValues }) => {
      const { error } = await supabase
        .from("transactions")
        .update({
          drug_id: values.drug_id,
          tarikh: format(values.tarikh, "yyyy-MM-dd"),
          kuantiti: values.kuantiti,
          jenis_rujukan: values.jenis_rujukan || null,
          no_rujukan: values.no_rujukan,
          terima_daripada: values.terima_daripada || null,
          harga_seunit: values.harga_seunit,
          jumlah_rm: values.kuantiti * values.harga_seunit,
          nama_pegawai: values.nama_pegawai || null,
          catatan: values.catatan || null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Receipt updated successfully");
      setEditingTx(null);
      queryClient.invalidateQueries({ queryKey: ["terimaan-recent"] });
      queryClient.invalidateQueries({ queryKey: ["drug-baki"] });
    },
    onError: () => toast.error("Failed to update receipt"),
  });

  const onSubmit = (values: FormValues) => insertMutation.mutate(values);
  const onEditSubmit = (values: FormValues) => {
    if (editingTx) updateMutation.mutate({ id: editingTx, values });
  };

  const openEdit = (tx: any) => {
    setEditingTx(tx.id);
    editForm.reset({
      drug_id: tx.drug_id,
      tarikh: new Date(tx.tarikh),
      jenis_rujukan: tx.jenis_rujukan || "",
      no_rujukan: tx.no_rujukan || "",
      terima_daripada: tx.terima_daripada || "",
      kuantiti: tx.kuantiti,
      harga_seunit: Number(tx.harga_seunit) || 0,
      nama_pegawai: tx.nama_pegawai || "",
      catatan: tx.catatan || "",
    });
  };

  const canEdit = (tx: any) => {
    if (role !== "pharmacist" && role !== "admin" && role !== "super_admin") return false;
    const created = new Date(tx.created_at);
    const diff = Date.now() - created.getTime();
    return diff < 24 * 60 * 60 * 1000;
  };

  const renderDrugCombobox = (
    fieldValue: string,
    onChange: (val: string) => void,
    open: boolean,
    setOpen: (o: boolean) => void
  ) => (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn("w-full justify-between", !fieldValue && "text-muted-foreground")}
        >
          {fieldValue
            ? drugs.find((d) => d.id === fieldValue)?.drug_name ?? "Select drug..."
            : "Select drug..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search drugs..." />
          <CommandList>
            <CommandEmpty>No drugs found.</CommandEmpty>
            <CommandGroup>
              {drugs.map((d) => (
                <CommandItem
                  key={d.id}
                  value={d.drug_name}
                  onSelect={() => {
                    onChange(d.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", fieldValue === d.id ? "opacity-100" : "opacity-0")} />
                  {d.drug_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );

  const renderFormFields = (
    f: typeof form,
    jumlah: number,
    drugOpen: boolean,
    setDrugOpen: (o: boolean) => void
  ) => (
    <div className="space-y-4">
      <FormField
        control={f.control}
        name="drug_id"
        render={({ field }) => (
          <FormItem className="flex flex-col">
            <FormLabel>Drug *</FormLabel>
            <FormControl>
              {renderDrugCombobox(field.value, field.onChange, drugOpen, setDrugOpen)}
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={f.control}
        name="tarikh"
        render={({ field }) => (
          <FormItem className="flex flex-col">
            <FormLabel>Receipt Date *</FormLabel>
            <Popover>
              <PopoverTrigger asChild>
                <FormControl>
                  <Button
                    variant="outline"
                    className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                  >
                    {field.value ? format(field.value, "dd/MM/yyyy") : "Select date"}
                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                  </Button>
                </FormControl>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={field.value}
                  onSelect={field.onChange}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={f.control}
          name="jenis_rujukan"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reference Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {["PK", "BTB", "BPSS", "BPSI", "BPIN"].map((j) => (
                    <SelectItem key={j} value={j}>{j}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={f.control}
          name="no_rujukan"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reference No. *</FormLabel>
              <FormControl>
                <Input placeholder="Enter document reference number" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={f.control}
        name="terima_daripada"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Received From</FormLabel>
            <FormControl>
              <Input placeholder="e.g. Stor Utama, Hospital Sultanah Aminah" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-3 gap-4">
        <FormField
          control={f.control}
          name="kuantiti"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Quantity *</FormLabel>
              <FormControl>
                <Input type="number" min={1} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={f.control}
          name="harga_seunit"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Unit Price (RM)</FormLabel>
              <FormControl>
                <Input type="number" step="0.0001" min={0} placeholder="0.0000" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormItem>
          <FormLabel>Total (RM)</FormLabel>
          <Input
            readOnly
            value={jumlah.toFixed(2)}
            className="bg-muted"
          />
        </FormItem>
      </div>

      <FormField
        control={f.control}
        name="nama_pegawai"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Officer Name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={f.control}
        name="catatan"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Notes</FormLabel>
            <FormControl>
              <Textarea placeholder="Additional notes (optional)" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Stock Receipt</h1>
        <p className="text-sm text-muted-foreground">Record new stock receipts from the store</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — Entry Form */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add New Receipt</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  {renderFormFields(form, jumlahRm, drugPopoverOpen, setDrugPopoverOpen)}

                  <div className="flex gap-2 pt-2">
                    <Button type="submit" disabled={insertMutation.isPending}>
                      {insertMutation.isPending ? "Saving..." : "Save Receipt"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        form.reset({
                          drug_id: "",
                          tarikh: new Date(),
                          jenis_rujukan: "",
                          no_rujukan: "",
                          terima_daripada: "",
                          kuantiti: 0,
                          harga_seunit: 0,
                          nama_pegawai: profile?.full_name || "",
                          catatan: "",
                        })
                      }
                    >
                      Reset
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* Live preview */}
          {selectedDrug && watchKuantiti > 0 && currentBaki !== undefined && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-4 pb-4">
                <p className="text-sm text-muted-foreground">
                  After saving, balance of{" "}
                  <span className="font-semibold text-foreground">{selectedDrug.drug_name}</span>{" "}
                  will change from{" "}
                  <span className="font-semibold text-foreground">{currentBaki}</span> to{" "}
                  <span className="font-semibold text-primary">{currentBaki + watchKuantiti}</span>{" "}
                  {selectedDrug.unit_pengukuran}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT — Recent Log */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Receipts</CardTitle>
          </CardHeader>
          <CardContent>
            {recentTerimaan.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <FileText className="mb-2 h-8 w-8" />
                <p className="text-sm">No receipt records yet.</p>
              </div>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Drug</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Total (RM)</TableHead>
                      <TableHead>Reference No.</TableHead>
                      <TableHead>Officer</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentTerimaan.map((tx: any) => (
                      <TableRow key={tx.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(tx.tarikh), "dd/MM/yyyy")}
                        </TableCell>
                        <TableCell>{(tx.drugs as any)?.drug_name ?? "-"}</TableCell>
                        <TableCell className="text-right">{tx.kuantiti}</TableCell>
                        <TableCell className="text-right">
                          {Number(tx.jumlah_rm || 0).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {tx.jenis_rujukan && (
                            <Badge variant="outline" className="mr-1 text-xs">
                              {tx.jenis_rujukan}
                            </Badge>
                          )}
                          {tx.no_rujukan || "-"}
                        </TableCell>
                        <TableCell>{tx.nama_pegawai || "-"}</TableCell>
                        <TableCell>
                          {canEdit(tx) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEdit(tx)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingTx} onOpenChange={(open) => !open && setEditingTx(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Receipt</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              {renderFormFields(editForm, editJumlahRm, editDrugPopoverOpen, setEditDrugPopoverOpen)}
              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Updating..." : "Update"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditingTx(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
