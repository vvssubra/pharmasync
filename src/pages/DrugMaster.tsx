
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDrugQuotaUsage } from "@/hooks/useDrugQuotaUsage";
import { useClinicDrugSettings, resolveDrugSettings } from "@/hooks/useClinicDrugSettings";
import { useMasterPatientRegistry, MASTER_PATIENT_PAGE_SIZE } from "@/hooks/useMasterPatientRegistry";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  FileText, Plus, Search, Pencil, Ban, RotateCcw, BookOpen, CalendarRange, Lock, Unlock,
  PackagePlus, MoreHorizontal, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DrugFormDialog } from "@/components/DrugFormDialog";
import DrugQuotaDialog from "@/components/DrugQuotaDialog";
import ReplenishQuotaDialog from "@/components/ReplenishQuotaDialog";

// Search input is debounced 300ms before it lands in the RPC queryKey,
// matching the setTimeout/useRef pattern used by useDoseSuggestion.ts and
// usePathwayCheck.ts elsewhere in this codebase (no debounce library in
// package.json).
const SEARCH_DEBOUNCE_MS = 300;

type Drug = {
  id: string;
  drug_name: string;
  is_active: boolean;
  is_blocked: boolean;
  perlu_kelulusan_pakar: boolean;
  stok_min: number | null;
  stok_reorder: number | null;
  stok_max: number | null;
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
  // Matches the drugs INSERT/UPDATE RLS predicate exactly
  // (20260821000200_clinic_drug_settings_enforcement.sql section 3): drugs
  // is now the HQ-owned district formulary. A non-HQ admin still owns their
  // clinic's thresholds and local block via clinic_drug_settings, gated
  // separately below — this flag only covers identity/is_active/is_blocked.
  const isHqRole = role === "super_admin" || role === "logistic_pharmacist";

  // Master patient registry — HQ-only (see isHqRole above), moved here from
  // LogistikDashboard.tsx so it lives under Drug Master instead of as a
  // standalone section on the Logistik dashboard. Search input debounced
  // 300ms before it drives the query; changing the search resets to page 0.
  const [patientSearchInput, setPatientSearchInput] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [patientPage, setPatientPage] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setPatientSearch(patientSearchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [patientSearchInput]);

  useEffect(() => {
    setPatientPage(0);
  }, [patientSearch]);

  const {
    rows: patientRows,
    totalCount: patientTotalCount,
    isLoading: patientsLoading,
    isError: patientsError,
  } = useMasterPatientRegistry(patientSearch, patientPage, { enabled: isHqRole });

  const patientPageCount = Math.max(1, Math.ceil(patientTotalCount / MASTER_PATIENT_PAGE_SIZE));

  // Namespaced — this query selects * and, unlike the other two, does not
  // filter on is_active. Prefix invalidation on ["drugs"] still applies.
  const { data: drugs = [], isLoading } = useQuery({
    queryKey: ["drugs", "master"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drugs")
        .select("*")
        .order("drug_name");
      if (error) throw error;
      return data as Drug[];
    },
  });

  // Server-computed usage — also fixes this page's previous omission of the
  // is_pesara filter, which made it disagree with DoctorRequest's number.
  const { byDrugId: quotaUsageByDrug } = useDrugQuotaUsage(currentYear);
  const { byDrugId: settingsByDrugId } = useClinicDrugSettings();

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

  // LOCAL block only — "we don't stock it at this clinic". drugs.is_blocked
  // is the separate NATIONAL block (MOH withdrawal); this page's toggle has
  // never had authority over that and now writes its own clinic's row
  // instead of the shared drugs one. Upsert, not update: the row may not
  // exist yet (a clinic created after Migration A's backfill, or the very
  // first time this clinic blocks this drug).
  const blockMutation = useMutation({
    mutationFn: async ({ id, is_blocked }: { id: string; is_blocked: boolean }) => {
      const { error } = await supabase
        .from("clinic_drug_settings")
        .upsert({ drug_id: id, is_blocked }, { onConflict: "clinic_id,drug_id" });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["clinic-drug-settings"] });
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
        {isHqRole && (
          <Button onClick={handleAdd}>
            <Plus className="mr-1 h-4 w-4" /> Add Drug
          </Button>
        )}
      </div>

      <div className="relative w-full sm:max-w-sm">
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
                  const quotaRow = quotaUsageByDrug.get(drug.id);
                  const localBlocked = resolveDrugSettings(settingsByDrugId, drug.id).is_blocked;
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
                          const remaining = quotaRow.remaining;
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
                            <Badge variant="outline" className="border-red-700 text-red-700 dark:text-red-500 text-xs">
                              Blocked nationally
                            </Badge>
                          )}
                          {localBlocked && (
                            <Badge variant="outline" className="border-red-500 text-red-600 dark:text-red-400 text-xs">
                              Blocked
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Up to six actions used to sit in this one cell, three
                            of them 28px and 4px apart. Resizing them was not an
                            option — they would overflow the cell — so they moved
                            into an overflow menu, whose items are 44px tall by
                            default and which also removes the misclick surface
                            between Deactivate and Block. */}
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-touch" aria-label={`Actions for ${drug.drug_name}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem className="min-h-[44px]" onClick={() => navigate(`/drugs/${drug.id}/ledger`)}>
                                <BookOpen className="mr-2 h-4 w-4" /> View Ledger
                              </DropdownMenuItem>
                              <DropdownMenuItem className="min-h-[44px]" onClick={() => handleEdit(drug)}>
                                <Pencil className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              {isHqRole && (
                                <DropdownMenuItem
                                  className="min-h-[44px]"
                                  onClick={() =>
                                    drug.is_active
                                      ? setDeactivateTarget(drug)
                                      : toggleMutation.mutate({ id: drug.id, is_active: true })
                                  }
                                >
                                  {drug.is_active
                                    ? <><Ban className="mr-2 h-4 w-4" /> Deactivate</>
                                    : <><RotateCcw className="mr-2 h-4 w-4" /> Reactivate</>}
                                </DropdownMenuItem>
                              )}
                              {(role === "admin" || role === "super_admin") && (
                                <DropdownMenuItem className="min-h-[44px]" onClick={() => setQuotaTarget(drug)}>
                                  <CalendarRange className="mr-2 h-4 w-4" /> Set Annual Quota
                                </DropdownMenuItem>
                              )}
                              {(role === "admin" || role === "super_admin") && quotaRow && (
                                <DropdownMenuItem className="min-h-[44px]" onClick={() => setReplenishTarget(drug)}>
                                  <PackagePlus className="mr-2 h-4 w-4" /> Replenish Quota
                                </DropdownMenuItem>
                              )}
                              {(role === "admin" || role === "super_admin") && (
                                <DropdownMenuItem
                                  className="min-h-[44px]"
                                  onClick={() => blockMutation.mutate({ id: drug.id, is_blocked: !localBlocked })}
                                >
                                  {localBlocked
                                    ? <><Unlock className="mr-2 h-4 w-4" /> Unblock requests</>
                                    : <><Lock className="mr-2 h-4 w-4" /> Block requests</>}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      {/* Master patient registry — read-only, HQ-wide, deduped by IC across
          every clinic (get_master_patient_registry). No row click-through
          and no history drill-down: patient dispensing history stays
          clinic-scoped by design (see PatientRegistry.tsx / PatientHistorySheet
          for the clinic-scoped equivalent). HQ-only (super_admin,
          logistic_pharmacist) — moved here from LogistikDashboard.tsx. */}
      {isHqRole && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Master Patient Registry
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search patient name or IC…"
                value={patientSearchInput}
                onChange={(e) => setPatientSearchInput(e.target.value)}
                className="pl-9"
                aria-label="Search patients"
              />
            </div>

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>IC</TableHead>
                    <TableHead>Clinics Visited</TableHead>
                    <TableHead className="text-right"># Clinics</TableHead>
                    <TableHead>First Seen</TableHead>
                    <TableHead>Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patientsLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 6 }).map((__, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : patientsError ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-destructive">
                        Failed to load the patient registry. Try again shortly.
                      </TableCell>
                    </TableRow>
                  ) : patientRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {patientSearch ? `No patients match "${patientSearch}".` : "No patients registered yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    patientRows.map((row) => {
                      const visibleClinics = row.clinic_names.slice(0, 3);
                      const overflowCount = row.clinic_names.length - visibleClinics.length;
                      return (
                        <TableRow key={row.normalized_ic}>
                          <TableCell className="font-medium">{row.patient_name}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{row.display_ic}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {visibleClinics.map((name) => (
                                <Badge key={name} variant="outline" className="text-[10px] font-normal">
                                  {name}
                                </Badge>
                              ))}
                              {overflowCount > 0 && (
                                <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                                  +{overflowCount}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm">{row.clinic_count}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(row.first_seen).toLocaleDateString("en-MY")}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(row.last_seen).toLocaleDateString("en-MY")}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {!patientsLoading && !patientsError && patientTotalCount > MASTER_PATIENT_PAGE_SIZE && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      aria-disabled={patientPage === 0}
                      className={cn(patientPage === 0 && "pointer-events-none opacity-50")}
                      onClick={(e) => {
                        e.preventDefault();
                        setPatientPage((p) => Math.max(0, p - 1));
                      }}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="px-2 text-sm text-muted-foreground">
                      Page {patientPage + 1} of {patientPageCount}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      aria-disabled={patientPage + 1 >= patientPageCount}
                      className={cn(patientPage + 1 >= patientPageCount && "pointer-events-none opacity-50")}
                      onClick={(e) => {
                        e.preventDefault();
                        setPatientPage((p) => Math.min(patientPageCount - 1, p + 1));
                      }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </CardContent>
        </Card>
      )}

      <DrugFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        drug={editDrug}
        nationalQuota={editDrug ? quotaUsageByDrug.get(editDrug.id) ?? null : null}
      />

      <DrugQuotaDialog
        open={!!quotaTarget}
        onOpenChange={open => { if (!open) setQuotaTarget(null); }}
        drugId={quotaTarget?.id ?? ""}
        drugName={quotaTarget?.drug_name ?? ""}
        isControlled={!!quotaTarget?.perlu_kelulusan_pakar}
        nationalQuota={quotaTarget ? quotaUsageByDrug.get(quotaTarget.id) ?? null : null}
      />

      <ReplenishQuotaDialog
        open={!!replenishTarget}
        onOpenChange={open => { if (!open) setReplenishTarget(null); }}
        drugId={replenishTarget?.id ?? ""}
        drugName={replenishTarget?.drug_name ?? ""}
        currentQuotaLimit={replenishTarget ? quotaUsageByDrug.get(replenishTarget.id)?.quota_limit ?? 0 : 0}
        isControlled={!!replenishTarget?.perlu_kelulusan_pakar}
        nationalQuota={replenishTarget ? quotaUsageByDrug.get(replenishTarget.id) ?? null : null}
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
