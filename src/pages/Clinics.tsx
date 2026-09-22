import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Building2, Plus, Pencil, AlertTriangle, CheckCircle2, Users, ShieldAlert, Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandableStatCard } from "@/components/ui/expandable-stat-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/errors";

type Clinic = {
  id: string;
  name: string;
  is_hq: boolean;
};

// Same shape RoleManagement reads. Only the two fields this page counts on are
// named — get_all_users_with_roles() returns more.
type UserRow = {
  clinic_id: string | null;
  role: string | null;
};

// The roles a clinic needs before it can actually operate. FMS is the hard one:
// AntibioticForm.tsx refuses to submit without an assigned FMS and its dropdown
// is scoped to the submitter's own clinic, so a clinic with zero FMS leaves
// every MO permanently unable to file an antibiotic form — a broken clinic that
// looks provisioned. The other three are warnings, not blockers.
const PROVISIONING_ROLES = ["admin", "fms", "mo", "pharmacist"] as const;
const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  fms: "FMS",
  mo: "MO",
  pharmacist: "Pharmacist",
};

type StatusFilter = "all" | "staffed" | "missing-fms" | "hq";

/**
 * Clinic management — super_admin only (gated in ProtectedRoute's
 * ROUTE_PERMISSIONS, whose /clinics entry must sit before the "/" entry:
 * that lookup is first-match-wins and "/" prefixes everything).
 *
 * Create and rename only, deliberately. There is NO delete:
 * clinics.id is referenced without ON DELETE CASCADE by profiles and eight
 * other tables, so deleting a clinic anyone has ever used is a raw 23503 the
 * UI cannot explain, and deleting an unused one is a footgun with no upside.
 *
 * is_hq is displayed but never editable. Moving that flag makes hq_clinic_id()
 * return null, and enforce_dispensing_request_limits() fails closed on it —
 * every controlled-drug request at every clinic starts raising.
 */
export default function Clinics() {
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<Clinic | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const { data: clinics = [], isLoading } = useQuery<Clinic[]>({
    queryKey: ["clinics-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name, is_hq")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Provisioning counts. get_all_users_with_roles() already returns every user
  // with their clinic_id and role, so no new RPC is needed — the counts are a
  // client-side fold over the same list RoleManagement renders.
  const { data: users = [], isLoading: usersLoading } = useQuery<UserRow[]>({
    queryKey: ["all-users-with-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_all_users_with_roles");
      if (error) throw error;
      return (data as UserRow[]) ?? [];
    },
  });

  const countsByClinic = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const u of users) {
      if (!u.clinic_id || !u.role) continue;
      const counts = map.get(u.clinic_id) ?? {};
      counts[u.role] = (counts[u.role] ?? 0) + 1;
      map.set(u.clinic_id, counts);
    }
    return map;
  }, [users]);

  // HQ is staffed by logistic pharmacists, not by the clinical roles tracked
  // here — it sees no patients, so "no FMS" is its normal state, not a fault.
  const isMissingFms = (clinic: Clinic) =>
    !clinic.is_hq && !usersLoading && !(countsByClinic.get(clinic.id)?.fms ?? 0);
  const isFullyStaffed = (clinic: Clinic) => {
    const counts = countsByClinic.get(clinic.id) ?? {};
    return !clinic.is_hq && !!counts.fms && !!counts.mo;
  };

  // Telemetry cards — derived entirely from data already fetched above.
  const totalFacilities = clinics.length;
  const hqCount = clinics.filter((c) => c.is_hq).length;
  const fullyStaffedCount = clinics.filter(isFullyStaffed).length;
  const missingFmsCount = clinics.filter(isMissingFms).length;
  const roleTotals = useMemo(() => {
    const totals: Record<string, number> = { admin: 0, fms: 0, mo: 0, pharmacist: 0 };
    for (const counts of countsByClinic.values()) {
      for (const r of PROVISIONING_ROLES) totals[r] += counts[r] ?? 0;
    }
    return totals;
  }, [countsByClinic]);
  const totalStaffCount = PROVISIONING_ROLES.reduce((sum, r) => sum + roleTotals[r], 0);

  const filteredClinics = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clinics.filter((c) => {
      if (statusFilter === "staffed" && !isFullyStaffed(c)) return false;
      if (statusFilter === "missing-fms" && !isMissingFms(c)) return false;
      if (statusFilter === "hq" && !c.is_hq) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinics, countsByClinic, statusFilter, search, usersLoading]);

  // 23505 is clinics_name_key (unique on lower(name), added in
  // 20260821000300). Raw, it surfaces as an index name the user has no way to
  // act on; every clinic picker in the app renders name only, so a duplicate
  // name would be genuinely unrecoverable from the UI.
  function describeWriteError(err: unknown, fallback: string): string {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") return "A clinic with that name already exists.";
    return getErrorMessage(err, fallback);
  }

  const createClinic = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("clinics").insert({ name });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinics-admin"] });
      // Every other clinic picker in the app reads its own key.
      queryClient.invalidateQueries({ queryKey: ["clinics-role-mgmt"] });
      queryClient.invalidateQueries({ queryKey: ["clinics-request"] });
      queryClient.invalidateQueries({ queryKey: ["clinics-signup"] });
      toast.success("Clinic created.");
      setAddOpen(false);
      setNewName("");
      setAddError(null);
    },
    onError: (err: unknown) => setAddError(describeWriteError(err, "Failed to create clinic.")),
  });

  const renameClinic = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("clinics").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinics-admin"] });
      queryClient.invalidateQueries({ queryKey: ["clinics-role-mgmt"] });
      queryClient.invalidateQueries({ queryKey: ["clinics-request"] });
      queryClient.invalidateQueries({ queryKey: ["clinics-signup"] });
      // Carried on every profile, so a rename must not leave stale copies in
      // the header or the user list.
      queryClient.invalidateQueries({ queryKey: ["all-users-with-roles"] });
      toast.success("Clinic renamed.");
      setRenameTarget(null);
      setRenameError(null);
    },
    onError: (err: unknown) => setRenameError(describeWriteError(err, "Failed to rename clinic.")),
  });

  function openRename(clinic: Clinic) {
    setRenameTarget(clinic);
    setRenameName(clinic.name);
    setRenameError(null);
  }

  const FILTER_TABS: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: "All Clinics", count: totalFacilities },
    { key: "staffed", label: "Fully Staffed", count: fullyStaffedCount },
    { key: "missing-fms", label: "Missing FMS", count: missingFmsCount },
    { key: "hq", label: "HQ Logistics", count: hqCount },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
            <Building2 className="h-3 w-3" />
            Live Directory
          </span>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </span>
            Clinics
          </h1>
          <p className="text-sm text-muted-foreground">
            Every clinic on this deployment, and whether each one has the staff it needs to operate.
          </p>
        </div>
        <Button onClick={() => { setNewName(""); setAddError(null); setAddOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Add Clinic
        </Button>
      </div>

      {/* Telemetry cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ExpandableStatCard
          icon={Building2}
          count={totalFacilities}
          label="Total Facilities"
          bgClassName="bg-primary/5"
          colorClassName="text-primary"
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        <ExpandableStatCard
          icon={CheckCircle2}
          count={fullyStaffedCount}
          label="Fully Staffed (FMS + MO)"
          bgClassName="bg-emerald-50"
          colorClassName="text-emerald-700"
          active={statusFilter === "staffed"}
          onClick={() => setStatusFilter((f) => (f === "staffed" ? "all" : "staffed"))}
        />
        <ExpandableStatCard
          icon={AlertTriangle}
          count={missingFmsCount}
          label="Pending FMS Assignment"
          bgClassName="bg-rose-50"
          colorClassName="text-rose-700"
          active={statusFilter === "missing-fms"}
          onClick={() => setStatusFilter((f) => (f === "missing-fms" ? "all" : "missing-fms"))}
        />
        <ExpandableStatCard
          icon={Users}
          count={totalStaffCount}
          label="Staff Provisioned"
          bgClassName="bg-teal-50"
          colorClassName="text-teal-700"
          breakdown={PROVISIONING_ROLES.map((r) => ({ label: ROLE_LABELS[r], value: roleTotals[r] }))}
        />
      </div>

      {/* Governance advisory — only when it's true */}
      {!usersLoading && missingFmsCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground shadow-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed text-foreground/90">
            <span className="font-semibold">FMS Assignment Advisory: </span>
            {missingFmsCount} clinical health {missingFmsCount === 1 ? "centre" : "centres"} currently lack an
            assigned Family Medicine Specialist. Category B restricted antibiotic sanction forms cannot be
            authorized at these facilities until an FMS is provisioned.
          </p>
        </div>
      )}

      {/* Filter + search toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                statusFilter === tab.key
                  ? "border border-primary/30 bg-primary/10 text-primary shadow-sm"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter clinics…"
            className="pl-8 text-xs"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="border-b bg-muted/30 py-4">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" />
            </span>
            Clinic Directory
            {(statusFilter !== "all" || search) && (
              <span className="ml-1 text-sm font-normal text-muted-foreground">— filtered</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clinic</TableHead>
                <TableHead>Staff Provisioning</TableHead>
                <TableHead>Clinical Governance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6">
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ) : clinics.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Building2 className="mb-2 h-8 w-8" />
                      <p className="text-sm">No clinics yet. Click 'Add Clinic' to start.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredClinics.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Search className="mb-2 h-8 w-8" />
                      <p className="text-sm">No clinics match this filter.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredClinics.map((clinic) => {
                  const counts = countsByClinic.get(clinic.id) ?? {};
                  const missingFms = isMissingFms(clinic);
                  const fullyStaffed = isFullyStaffed(clinic);
                  return (
                    <TableRow key={clinic.id} className={cn(fullyStaffed && "bg-emerald-50/30 hover:bg-emerald-50/50")}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {clinic.name}
                          {clinic.is_hq && (
                            <Badge variant="outline" className="text-xs">HQ</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {usersLoading ? (
                          <Skeleton className="h-5 w-40" />
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {PROVISIONING_ROLES.map((r) => (
                              <Badge
                                key={r}
                                variant="outline"
                                className={
                                  counts[r]
                                    ? "text-xs"
                                    : "text-xs text-muted-foreground border-dashed"
                                }
                              >
                                {ROLE_LABELS[r]} {counts[r] ?? 0}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {usersLoading ? (
                          <Skeleton className="h-5 w-48" />
                        ) : missingFms ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            No FMS — antibiotic forms cannot be submitted at this clinic
                          </span>
                        ) : clinic.is_hq ? (
                          <span className="text-xs text-muted-foreground">Logistics facility — no clinical staffing required</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-100/70 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            Antibiotic forms enabled
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-[44px]"
                          onClick={() => openRename(clinic)}
                        >
                          <Pencil className="mr-1 h-4 w-4" /> Rename
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Clinic</DialogTitle>
            <DialogDescription>
              The name is what every clinic picker in the app shows, so make it the one staff will recognise.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-clinic-name">Clinic Name</Label>
            <Input
              id="new-clinic-name"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setAddError(null); }}
              placeholder="e.g. Klinik Kesihatan Larkin"
            />
            {addError && <p className="text-sm text-destructive">{addError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createClinic.mutate(newName.trim())}
              disabled={!newName.trim() || createClinic.isPending}
            >
              {createClinic.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Clinic</DialogTitle>
            <DialogDescription>
              Renaming changes what every user of this clinic sees. It does not move anyone between clinics.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-clinic-name">Clinic Name</Label>
            <Input
              id="rename-clinic-name"
              value={renameName}
              onChange={(e) => { setRenameName(e.target.value); setRenameError(null); }}
            />
            {renameError && <p className="text-sm text-destructive">{renameError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button
              onClick={() => renameTarget && renameClinic.mutate({ id: renameTarget.id, name: renameName.trim() })}
              disabled={!renameName.trim() || renameName.trim() === renameTarget?.name || renameClinic.isPending}
            >
              {renameClinic.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
