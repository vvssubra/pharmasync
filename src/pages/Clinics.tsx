import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Building2, Plus, Pencil, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Clinics</h1>
          <p className="text-sm text-muted-foreground">
            Every clinic on this deployment, and whether each one has the staff it needs to operate.
          </p>
        </div>
        <Button onClick={() => { setNewName(""); setAddError(null); setAddOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Add Clinic
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clinic</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6">
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ) : clinics.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Building2 className="mb-2 h-8 w-8" />
                      <p className="text-sm">No clinics yet. Click 'Add Clinic' to start.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                clinics.map((clinic) => {
                  const counts = countsByClinic.get(clinic.id) ?? {};
                  // HQ is staffed by logistic pharmacists, not by the clinical
                  // roles below — it sees no patients, so "no FMS" is its
                  // normal state rather than a fault.
                  const missingFms = !clinic.is_hq && !usersLoading && !counts.fms;
                  return (
                    <TableRow key={clinic.id}>
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
                            {missingFms && (
                              <span className="flex items-center gap-1 text-xs text-destructive">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                No FMS — antibiotic forms cannot be submitted at this clinic
                              </span>
                            )}
                          </div>
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
