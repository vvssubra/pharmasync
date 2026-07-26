import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { UserCog, Users, Plus, KeyRound, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/errors";

const ADMIN_MGMT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-user-mgmt`;

type UserWithRole = {
  user_id: string;
  email: string;
  full_name: string;
  clinic_id: string | null;
  clinic_name: string | null;
  role: string | null;
  // Clinic the user asked for at signup — a request, not a grant. Null for
  // OAuth signups, which carry no clinic metadata at all.
  pending_clinic_id: string | null;
  pending_clinic_name: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  fms: "FMS",
  mo: "Medical Officer",
  pharmacist: "Pharmacist",
};

const ASSIGNABLE_ROLES = ["admin", "fms", "mo", "pharmacist"] as const;

// The user_roles.role column is the Postgres `app_role` enum, so a plain string
// cannot be upserted. Narrow whatever the Select produced back to a real role.
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

function isAssignableRole(value: string): value is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

const ROLE_BADGE_CLASSES: Record<string, string> = {
  admin:      "bg-purple-100 text-purple-700 border-purple-300",
  fms:        "bg-blue-100 text-blue-700 border-blue-300",
  mo:         "bg-teal-100 text-teal-700 border-teal-300",
  pharmacist: "bg-green-100 text-green-700 border-green-300",
};

export default function RoleManagement() {
  const { user: currentUser, role: currentRole } = useAuth();
  const isSuperAdmin = currentRole === "super_admin";
  const queryClient = useQueryClient();
  const [pendingRole, setPendingRole] = useState<Record<string, string>>({});

  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<string>("mo");
  const [newClinicId, setNewClinicId] = useState("");
  const [addUserError, setAddUserError] = useState<string | null>(null);

  // Clinic picker — only shown/required for super_admin (a plain admin can
  // only create users for their own clinic, resolved server-side).
  const { data: clinics } = useQuery({
    queryKey: ["clinics-role-mgmt"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clinics").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
    enabled: isSuperAdmin,
  });

  // Pending approval — role and clinic chosen per user before approving.
  const [approveRole, setApproveRole] = useState<Record<string, string>>({});
  const [approveClinic, setApproveClinic] = useState<Record<string, string>>({});

  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ id: string; email: string } | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);

  const { data: users = [], isLoading, error: usersError } = useQuery<UserWithRole[]>({
    queryKey: ["all-users-with-roles"],
    queryFn: async () => {
      // Not in the generated types, same as approve_clinic_member below.
      const rpc = supabase.rpc as unknown as
        (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { data, error } = await rpc("get_all_users_with_roles");
      if (error) throw error;
      return (data as UserWithRole[]) ?? [];
    },
  });

  const assignRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      if (role === "unassigned") {
        const { error } = await supabase.from("user_roles").delete().eq("user_id", userId);
        if (error) throw error;
      } else {
        if (!isAssignableRole(role)) throw new Error(`Unknown role: ${role}`);
        const { error } = await supabase
          .from("user_roles")
          .upsert({ user_id: userId, role }, { onConflict: "user_id" });
        if (error) throw error;
      }
    },
    onSuccess: (_data, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ["all-users-with-roles"] });
      setPendingRole(prev => { const next = { ...prev }; delete next[userId]; return next; });
      toast.success("Role updated successfully.");
    },
    onError: () => toast.error("Failed to update role."),
  });

  const createUser = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(ADMIN_MGMT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: "create_user",
          full_name: newName.trim(),
          email: newEmail.trim(),
          password: newPassword,
          role: newRole,
          ...(isSuperAdmin ? { clinic_id: newClinicId } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create user");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-users-with-roles"] });
      toast.success("User created successfully.");
      setAddUserOpen(false);
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("mo"); setNewClinicId("");
      setAddUserError(null);
    },
    onError: (err: Error) => {
      setAddUserError(err.message);
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(ADMIN_MGMT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action: "reset_password", user_id: userId, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to reset password");
      return json;
    },
    onSuccess: () => {
      toast.success("Kata laluan berjaya ditukar.");
      setResetOpen(false);
      setResetPassword("");
      setResetError(null);
      setResetTarget(null);
    },
    onError: (err: Error) => setResetError(err.message),
  });

  // A user with no clinic cannot read or write anything clinic-scoped —
  // stamp_clinic_id() raises on every insert — so these are shown apart from
  // the working membership rather than as rows with a blank clinic.
  const pendingUsers = users.filter(u => u.clinic_id === null);
  const activeUsers = users.filter(u => u.clinic_id !== null);

  const approveMember = useMutation({
    mutationFn: async ({ userId, role, clinicId }: { userId: string; role: string; clinicId: string | null }) => {
      // approve_clinic_member is newer than the generated types, so the client's
      // rpc overloads don't know it.
      const rpc = supabase.rpc as unknown as
        (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      const { error } = await rpc("approve_clinic_member", {
        target_user: userId,
        target_role: role,
        target_clinic: clinicId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ["all-users-with-roles"] });
      queryClient.invalidateQueries({ queryKey: ["unassigned-user-count"] });
      setApproveRole(prev => { const next = { ...prev }; delete next[userId]; return next; });
      setApproveClinic(prev => { const next = { ...prev }; delete next[userId]; return next; });
      toast.success("User approved.");
    },
    // The RPC raises with text written for the admin reading it ("Your own
    // profile has no clinic…"), so pass it straight through.
    onError: (err: unknown) => toast.error(getErrorMessage(err, "Failed to approve user.")),
  });

  const isSelf = (userId: string) => userId === currentUser?.id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <UserCog className="h-6 w-6" />
          Role Management
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Assign roles to registered users. Only admins can access this page.
        </p>
      </div>

      {!isLoading && pendingUsers.length > 0 && (
        <Card data-testid="pending-approval-card" className="border-amber-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-amber-600" />
              Pending Approval
              <Badge variant="secondary" className="ml-1">{pendingUsers.length}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These users have no clinic yet, so nothing in the app works for them.
              Approving grants the clinic and the role together.
            </p>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {pendingUsers.map((u) => {
                const role = approveRole[u.user_id] ?? "mo";
                const clinicId = isSuperAdmin ? (approveClinic[u.user_id] ?? "") : "";

                return (
                  <div key={u.user_id} className="flex items-center justify-between py-3 gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{u.full_name || "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {u.pending_clinic_name
                          ? `Requested: ${u.pending_clinic_name}`
                          : "No clinic requested"}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {isSuperAdmin && (
                        <Select
                          value={clinicId}
                          onValueChange={(val) =>
                            setApproveClinic(prev => ({ ...prev, [u.user_id]: val }))
                          }
                        >
                          <SelectTrigger className="w-48 h-8 text-xs" data-testid={`clinic-${u.user_id}`}>
                            <SelectValue placeholder="Select clinic" />
                          </SelectTrigger>
                          <SelectContent>
                            {(clinics ?? []).map((c) => (
                              <SelectItem key={c.id} value={c.id} className="text-xs">
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      <Select
                        value={role}
                        onValueChange={(val) =>
                          setApproveRole(prev => ({ ...prev, [u.user_id]: val }))
                        }
                      >
                        <SelectTrigger className="w-40 h-8 text-xs" data-testid={`role-${u.user_id}`}>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_ROLES.map((r) => (
                            <SelectItem key={r} value={r} className="text-xs">
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        data-testid={`approve-${u.user_id}`}
                        disabled={approveMember.isPending || (isSuperAdmin && !clinicId)}
                        onClick={() =>
                          approveMember.mutate({
                            userId: u.user_id,
                            role,
                            clinicId: clinicId || null,
                          })
                        }
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="all-users-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-muted-foreground" />
            All Users
            {!isLoading && (
              <Badge variant="secondary" className="ml-1">{activeUsers.length}</Badge>
            )}
          </CardTitle>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setAddUserOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add User
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)}
            </div>
          ) : usersError ? (
            // Without this the page renders "No users found" when the query
            // fails, which reads as an empty database and hides the cause.
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Could not load users.</p>
              <p className="text-xs text-muted-foreground">
                {getErrorMessage(usersError, "Unknown error.")}
              </p>
            </div>
          ) : activeUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users found.</p>
          ) : (
            <div className="divide-y">
              {activeUsers.map((u) => {
                const selectedRole = pendingRole[u.user_id] ?? u.role ?? "unassigned";
                const hasChange = pendingRole[u.user_id] !== undefined &&
                  pendingRole[u.user_id] !== (u.role ?? "unassigned");

                return (
                  <div key={u.user_id} className="flex items-center justify-between py-3 gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{u.full_name || "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      {u.clinic_name && (
                        <p className="text-xs text-muted-foreground">{u.clinic_name}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {u.role && ROLE_BADGE_CLASSES[u.role] && (
                        <Badge variant="outline" className={`text-[11px] ${ROLE_BADGE_CLASSES[u.role]}`}>
                          {ROLE_LABELS[u.role] ?? u.role}
                        </Badge>
                      )}

                      <Select
                        value={selectedRole}
                        onValueChange={(val) =>
                          setPendingRole(prev => ({ ...prev, [u.user_id]: val }))
                        }
                        disabled={isSelf(u.user_id)}
                      >
                        <SelectTrigger className="w-40 h-8 text-xs">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_ROLES.map((r) => (
                            <SelectItem key={r} value={r} className="text-xs">
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                          <SelectItem value="unassigned" className="text-xs text-muted-foreground">
                            Unassigned
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        disabled={!hasChange || assignRole.isPending || isSelf(u.user_id)}
                        onClick={() =>
                          assignRole.mutate({ userId: u.user_id, role: selectedRole })
                        }
                      >
                        Save
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0"
                        title="Set password"
                        onClick={() => {
                          setResetTarget({ id: u.user_id, email: u.email });
                          setResetPassword("");
                          setResetError(null);
                          setResetOpen(true);
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {isSelf(u.user_id) && (
                      <span className="text-xs text-muted-foreground italic shrink-0">you</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={resetOpen} onOpenChange={(open) => { setResetOpen(open); if (!open) { setResetError(null); setResetPassword(""); setResetTarget(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Password</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{resetTarget?.email}</p>
          <form
            onSubmit={(e) => { e.preventDefault(); if (resetTarget) resetPasswordMutation.mutate({ userId: resetTarget.id, password: resetPassword }); }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="reset-pw">Kata laluan baharu</Label>
              <Input
                id="reset-pw"
                type="password"
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Min 6 aksara"
              />
            </div>
            {resetError && <p className="text-sm text-destructive">{resetError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResetOpen(false)}>Batal</Button>
              <Button type="submit" disabled={resetPasswordMutation.isPending}>
                {resetPasswordMutation.isPending ? "Menyimpan…" : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addUserOpen} onOpenChange={(open) => { setAddUserOpen(open); if (!open) setAddUserError(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); createUser.mutate(); }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="add-name">Full Name</Label>
              <Input
                id="add-name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                required
                placeholder="Dr. Ahmad bin Ali"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-email">Email</Label>
              <Input
                id="add-email"
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                required
                placeholder="ahmad@example.gov.my"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-password">Password</Label>
              <Input
                id="add-password"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Min 6 characters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-role">Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger id="add-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isSuperAdmin && (
              <div className="space-y-2">
                <Label htmlFor="add-clinic">Clinic</Label>
                <Select value={newClinicId} onValueChange={setNewClinicId}>
                  <SelectTrigger id="add-clinic">
                    <SelectValue placeholder="Select clinic" />
                  </SelectTrigger>
                  <SelectContent>
                    {clinics?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {addUserError && (
              <p className="text-sm text-destructive">{addUserError}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddUserOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createUser.isPending || (isSuperAdmin && !newClinicId)}>
                {createUser.isPending ? "Creating…" : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
