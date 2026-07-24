
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { FileText, Plus, Search, Pencil, Ban, RotateCcw, BookOpen, CalendarRange, Lock, Unlock, PackagePlus } from "lucide-react";
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
import DrugQuotaDialog from "@/components/DrugQuotaDialog";
import ReplenishQuotaDialog from "@/components/ReplenishQuotaDialog";

type Drug = {
  id: string;
  drug_name: string;
  is_active: boolean;
  is_blocked: boolean;
  perlu_kelulusan_pakar: boolean;
};

type DrugQuota = {
  drug_id: string;
  quota_limit: number;
};

export default function DrugMaster() {
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editDrug, setEditDrug] = useState<Drug | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Drug | null>(null);
  const [quotaTarget, setQuotaTarget] = useState<Drug | null>(null);
  const [replenishTarget, setReplenishTarget] = useState<Drug | null>(null);
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();

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

  const { data: drugQuotas = [] } = useQuery({
    queryKey: ["drug-master-quotas", currentYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drug_quotas")
        .select("drug_id, quota_limit")
        .eq("year", currentYear);
      if (error) throw error;
      return data as DrugQuota[];
    },
  });

  const { data: ytdCounts = {} } = useQuery({
    queryKey: ["drug-master-ytd-counts", currentYear],
    queryFn: async () => {
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear + 1}-01-01`;
      const { data, error } = await supabase
        .from("dispensing_requests")
        .select("drug_id")
        .neq("status", "rejected")
        .gte("created_at", yearStart)
        .lt("created_at", yearEnd);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of data ?? []) counts[r.drug_id] = (counts[r.drug_id] ?? 0) + 1;
      return counts;
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

  const blockMutation = useMutation({
    mutationFn: async ({ id, is_blocked }: { id: string; is_blocked: boolean }) => {
      const { error } = await supabase.from("drugs").update({ is_blocked }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["drugs"] });
      queryClient.invalidateQueries({ queryKey: ["drugs-for-request"] });
      toast.success(vars.is_blocked ? "Drug blocked — MO can no longer request it" : "Drug unblocked");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = drugs
    .filter((d) => d.drug_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.drug_name.localeCompare(b.drug_name));

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
                <TableHead>Quota Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
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
                  const quotaRow = drugQuotas.find((q) => q.drug_id === drug.id);
                  return (
                    <TableRow key={drug.id} className={drug.is_active ? "" : "opacity-50"}>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="text-left cursor-pointer hover:text-primary hover:underline underline-offset-2 transition-colors min-h-[44px] flex items-center"
                          onClick={() => navigate(`/drugs/${drug.id}/ledger`)}
                        >
                          {drug.drug_name}
                        </button>
                      </TableCell>
                      <TableCell>
                        {!quotaRow ? (
                          <Badge variant="outline" className="text-xs text-muted-foreground">No quota set</Badge>
                        ) : (() => {
                          const remaining = quotaRow.quota_limit - (ytdCounts[drug.id] ?? 0);
                          const pct = quotaRow.quota_limit > 0 ? remaining / quotaRow.quota_limit : 0;
                          const cls = pct <= 0.1
                            ? "bg-red-100 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-400"
                            : pct <= 0.25
                            ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-400"
                            : "bg-green-100 text-green-700 border-green-300 dark:bg-green-950 dark:text-green-400";
                          return <Badge variant="outline" className={`text-xs ${cls}`}>{remaining} / {quotaRow.quota_limit}</Badge>;
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant={drug.is_active ? "default" : "secondary"}>
                            {drug.is_active ? "Active" : "Inactive"}
                          </Badge>
                          {drug.is_blocked && (
                            <Badge variant="outline" className="border-red-500 text-red-600 dark:text-red-400 text-xs">
                              Blocked
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
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
                          {(role === "admin" || role === "super_admin") && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Set Annual Quota" onClick={() => setQuotaTarget(drug)}>
                              <CalendarRange className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {(role === "admin" || role === "super_admin") && quotaRow && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Replenish Quota" onClick={() => setReplenishTarget(drug)}>
                              <PackagePlus className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {(role === "admin" || role === "super_admin") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title={drug.is_blocked ? "Unblock requests" : "Block requests"}
                              onClick={() => blockMutation.mutate({ id: drug.id, is_blocked: !drug.is_blocked })}
                            >
                              {drug.is_blocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
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

      <ReplenishQuotaDialog
        open={!!replenishTarget}
        onOpenChange={open => { if (!open) setReplenishTarget(null); }}
        drugId={replenishTarget?.id ?? ""}
        drugName={replenishTarget?.drug_name ?? ""}
        currentQuotaLimit={replenishTarget ? drugQuotas.find(q => q.drug_id === replenishTarget.id)?.quota_limit ?? 0 : 0}
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
