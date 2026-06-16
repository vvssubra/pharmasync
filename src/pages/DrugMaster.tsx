
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { FileText, Plus, Search, Pencil, Ban, RotateCcw, BookOpen, CreditCard, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DrugFormDialog } from "@/components/DrugFormDialog";
import { OpeningBalanceDialog } from "@/components/OpeningBalanceDialog";
import DrugQuotaDialog from "@/components/DrugQuotaDialog";

type Drug = {
  id: string;
  drug_name: string;
  no_kod: string;
  unit_pengukuran: string;
  kumpulan: string;
  pergerakan: string;
  gudang_seksyen: string;
  baris: string;
  rak: string;
  tingkat: string;
  petak: string;
  kod_lokasi_penuh: string;
  stok_min: number;
  stok_reorder: number;
  stok_max: number;
  is_active: boolean;
  perlu_kelulusan_pakar: boolean;
};

type BakiAwal = {
  id: string;
  drug_id: string;
  kuantiti: number;
  tarikh: string;
};

export default function DrugMaster() {
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editDrug, setEditDrug] = useState<Drug | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Drug | null>(null);
  const [balanceTarget, setBalanceTarget] = useState<Drug | null>(null);
  const [quotaTarget, setQuotaTarget] = useState<Drug | null>(null);
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = role === "admin" || role === "pharmacist";

  const { data: drugs = [], isLoading } = useQuery({
    queryKey: ["drugs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drugs")
        .select("*")
        .order("drug_name");
      if (error) throw error;
      return data as Drug[];
    },
  });

  const { data: bakiMap = {} } = useQuery({
    queryKey: ["transactions-baki-awal"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id, drug_id, kuantiti, tarikh")
        .eq("jenis", "baki_awal");
      if (error) throw error;
      const map: Record<string, BakiAwal> = {};
      (data ?? []).forEach((t) => {
        map[t.drug_id] = t as BakiAwal;
      });
      return map;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("drugs").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drugs"] });
      toast.success("Status updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = drugs
    .filter((d) => d.drug_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aHas = !!bakiMap[a.id];
      const bHas = !!bakiMap[b.id];
      if (aHas !== bHas) return aHas ? 1 : -1;
      return a.drug_name.localeCompare(b.drug_name);
    });

  const handleEdit = (drug: Drug) => {
    setEditDrug(drug);
    setFormOpen(true);
  };

  const handleAdd = () => {
    setEditDrug(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Drug Master</h1>
          <p className="text-sm text-muted-foreground">Monitored drug list (KEW.PS-3)</p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="mr-1 h-4 w-4" /> Add Drug
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search drugs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Drug Name</TableHead>
                <TableHead>No. Kod</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Storage Location</TableHead>
                <TableHead>Stock Levels</TableHead>
                <TableHead>Opening Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9}>
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <FileText className="mb-2 h-8 w-8" />
                      <p className="text-sm">
                        {search ? "No drugs found." : "Click 'Add Drug' to start."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((drug) => {
                  const baki = bakiMap[drug.id];
                  return (
                    <TableRow key={drug.id} className={drug.is_active ? "" : "opacity-50"}>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="text-left cursor-pointer hover:text-primary hover:underline underline-offset-2 transition-colors min-h-[44px] flex items-center"
                          onClick={() => navigate(`/drugs/${drug.id}/bincard`)}
                        >
                          {drug.drug_name}
                        </button>
                      </TableCell>
                      <TableCell>{drug.no_kod}</TableCell>
                      <TableCell className="capitalize">{drug.unit_pengukuran}</TableCell>
                      <TableCell>{drug.kumpulan}</TableCell>
                      <TableCell className="text-xs">{drug.kod_lokasi_penuh}</TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {drug.stok_min} / {drug.stok_reorder} / {drug.stok_max}
                      </TableCell>
                      <TableCell>
                        {baki ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-green-600 dark:text-green-400">
                              {baki.kuantiti} {drug.unit_pengukuran} — {format(new Date(baki.tarikh), "dd/MM/yyyy")}
                            </span>
                            {isAdmin && (
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setBalanceTarget(drug)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="border-yellow-500 text-yellow-600 dark:text-yellow-400 text-xs">
                              Not Set
                            </Badge>
                            {isAdmin && (
                              <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setBalanceTarget(drug)}>
                                Set Balance
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={drug.is_active ? "default" : "secondary"}>
                          {drug.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => navigate(`/drugs/${drug.id}/bincard`)} title="View Card">
                            <CreditCard className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => navigate(`/drugs/${drug.id}/ledger`)} title="View Ledger">
                            <BookOpen className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(drug)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              drug.is_active
                                ? setDeactivateTarget(drug)
                                : toggleMutation.mutate({ id: drug.id, is_active: true })
                            }
                          >
                            {drug.is_active ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                          </Button>
                          {role === "admin" && drug.perlu_kelulusan_pakar && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Set Annual Quota" onClick={() => setQuotaTarget(drug)}>
                              <CalendarRange className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DrugFormDialog open={formOpen} onOpenChange={setFormOpen} drug={editDrug} />

      <DrugQuotaDialog
        open={!!quotaTarget}
        onOpenChange={open => { if (!open) setQuotaTarget(null); }}
        drugId={quotaTarget?.id ?? ""}
        drugName={quotaTarget?.drug_name ?? ""}
      />

      <OpeningBalanceDialog
        open={!!balanceTarget}
        onOpenChange={(o) => !o && setBalanceTarget(null)}
        drug={balanceTarget}
        existing={balanceTarget ? bakiMap[balanceTarget.id] ?? null : null}
      />

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this drug?</AlertDialogTitle>
            <AlertDialogDescription>
              Drug <strong>{deactivateTarget?.drug_name}</strong> will be deactivated. It can still be reactivated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deactivateTarget) {
                  toggleMutation.mutate({ id: deactivateTarget.id, is_active: false });
                  setDeactivateTarget(null);
                }
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
