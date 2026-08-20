import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { UserCog, Users, Plus, KeyRound, UserPlus, Search, MoreHorizontal, Trash2 } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  super_admin: "Super Admin",
  logistic_pharmacist: "Logistic Pharmacist",
};

// Every role this page can name. Which of them the *current* caller may
// actually assign is narrower — see assignableRolesFor() below.
const ASSIGNABLE_ROLES = ["admin", "fms", "mo", "pharmacist", "logistic_pharmacist"] as const;

// logistic_pharmacist is national in scope (it governs the shared
// controlled-drug quota pool every clinic draws from) rather than clinic-scoped,
// so a plain clinic admin must not be able to mint one. The database is the
// real enforcement — the clinic-admin user_roles policies and
// approve_clinic_member() both refuse it
// (supabase/migrations/20260819000100_logistic_role_helpers.sql), and
// admin-user-mgmt rejects it for non-super_admin callers — but a role an admin
// cannot grant should not be offered to them either, or every pick ends in an
// unexplained RLS error.
const SUPER_ADMIN_ONLY_ROLES: readonly string[] = ["logistic_pharmacist"];

function assignableRolesFor(isSuperAdmin: boolean): readonly string[] {
  return isSuperAdmin
    ? ASSIGNABLE_ROLES
    : ASSIGNABLE_ROLES.filter((r) => !SUPER_ADMIN_ONLY_ROLES.includes(r));
}

// The user_roles.role column is the Postgres `app_role` enum, so a plain string
// cannot be upserted. Narrow whatever the Select produced back to a real role.
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

function isAssignableRole(value: string): value is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

// Role is a category, not a state. Four saturated pastels repeated down a
// 30-row list made every row shout equally and none of them readable; finding
// a role is the filter's job now. Colour is spent only where it means
// "this account can change other accounts".
const PRIVILEGED_BADGE = "bg-amber-50 text-amber-800 border-amber-300";
const PLAIN_BADGE = "bg-muted/50 text-foreground/80 border-border";

function roleBadgeClass(role: string) {
  return role === "admin" || role === "super_admin" ? PRIVILEGED_BADGE : PLAIN_BADGE;
}

const ROLE_FILTER_ALL = "all";

export default function RoleManagement() {
  const { user: currentUser, role: currentRole } = useAuth();
  const isSuperAdmin = currentRole === "super_admin";
  // Drives every role picker on this page (add user, approve pending, change
  // role) and the role filter, so a plain admin never sees a role the server
  // would refuse them.
  const assignableRoles = assignableRolesFor(isSuperAdmin);
  const queryClient = useQueryClient();

  // The list outgrew scrolling once several clinics shared it, so it is
  // searched and filtered rather than read top to bottom.
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>(ROLE_FILTER_ALL);

  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<string>("mo");
  const [newClinicId, setNewClinicId] = useState("");
  const [addUserError, setAddUserError] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<"invite" | "manual">("invite");

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

  // Deleting an account is irreversible and the row actions sit in a dense
  // list, so the confirmation asks for the email back rather than a button
  // one stray tap away from the menu item.
  const [deleteTarget, setDeleteTarget] = useState<UserWithRole | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openDelete(u: UserWithRole) {
    setDeleteTarget(u);
    setDeleteConfirm("");
    setDeleteError(null);
  }

  const { data: users = [], isLoading, error: usersError } = useQuery<UserWithRole[]>({
    queryKey: ["all-users-with-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_all_users_with_roles");
      if (error) throw error;
      return (data as UserWithRole[]) ?? [];
    },
  });

  // Commits on selection — there is no Save button. A row-level save button
  // spends a permanently-disabled control on every row to guard a one-field
  // change that is trivially reversible, so the guard is an Undo instead.
  const assignRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string; previousRole?: string; isUndo?: boolean }) => {
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
    onSuccess: (_data, { userId, role, previousRole, isUndo }) => {
      queryClient.invalidateQueries({ queryKey: ["all-users-with-roles"] });
      if (isUndo) {
        toast.success("Change reverted.");
        return;
      }
      const label = role === "unassigned" ? "Unassigned" : ROLE_LABELS[role] ?? role;
      toast.success(`Role set to ${label}.`, {
        action: previousRole
          ? {
              label: "Undo",
              onClick: () =>
                assignRole.mutate({ userId, role: previousRole, isUndo: true }),
            }
          : undefined,
      });
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
      toast.success("User created. They will be asked to change this password at first login.");
      setAddUserOpen(false);
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("mo"); setNewClinicId("");
      setAddUserError(null);
    },
    onError: (err: Error) => {
      setAddUserError(err.message);
    },
  });

  const inviteUser = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(ADMIN_MGMT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: "invite_user",
          full_name: newName.trim(),
          email: newEmail.trim(),
          role: newRole,
          redirect_to: window.location.origin,
          ...(isSuperAdmin ? { clinic_id: newClinicId } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to send invite");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-users-with-roles"] });
      toast.success("Invite sent. User will set their password by email.");
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
      toast.success("Kata laluan berjaya ditukar. User will be asked to change it at next login.");
      setResetOpen(false);
      setResetPassword("");
      setResetError(null);
      setResetTarget(null);
    },
    onError: (err: Error) => setResetError(err.message),
  });

  // super_admin only, and enforced again server-side — the menu item merely
  // hides what the function would refuse anyway.
  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(ADMIN_MGMT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action: "delete_user", user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to delete user");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-users-with-roles"] });
      queryClient.invalidateQueries({ queryKey: ["unassigned-user-count"] });
      toast.success("Account deleted.");
      setDeleteTarget(null);
      setDeleteConfirm("");
      setDeleteError(null);
    },
    // The 409 path explains which records hold the account down, so it is
    // shown in the dialog rather than a toast that scrolls away mid-read.
    onError: (err: Error) => setDeleteError(err.message),
  });

  // A user with no clinic cannot read or write anything clinic-scoped —
  // stamp_clinic_id() raises on every insert — so these are shown apart from
  // the working membership rather than as rows with a blank clinic.
  // super_admin is the exception: no clinic by design, never pending.
  const pendingUsers = users.filter(u => u.clinic_id === null && u.role !== "super_admin");
  const activeUsers = users.filter(u => u.clinic_id !== null || u.role === "super_admin");

  // One clinic on screen means the clinic line is the same string on every
  // row — noise. It earns its place only when the list actually spans clinics,
  // which is the super_admin view.
  const showClinic = new Set(activeUsers.map(u => u.clinic_name).filter(Boolean)).size > 1;

  const term = search.trim().toLowerCase();
  const visibleUsers = activeUsers.filter(u => {
    const matchesRole =
      roleFilter === ROLE_FILTER_ALL ||
      (roleFilter === "unassigned" ? !u.role : u.role === roleFilter);
    if (!matchesRole) return false;
    if (!term) return true;
    return (
      u.full_name?.toLowerCase().includes(term) ||
      u.email?.toLowerCase().includes(term) ||
      (u.clinic_name?.toLowerCase().includes(term) ?? false)
    );
  });
  const isFiltered = term !== "" || roleFilter !== ROLE_FILTER_ALL;

  const approveMember = useMutation({
    mutationFn: async ({ userId, role, clinicId }: { userId: string; role: string; clinicId: string | null }) => {
      if (!isAssignableRole(role)) throw new Error(`Unknown role: ${role}`);
      const { error } = await supabase.rpc("approve_clinic_member", {
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
                  <div key={u.user_id} className="flex flex-wrap items-center justify-between py-3 gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{u.full_name || "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {u.pending_clinic_name
                          ? `Requested: ${u.pending_clinic_name}`
                          : "No clinic requested"}
                      </p>
                    </div>

                    <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:shrink-0">
                      {isSuperAdmin && (
                        <Select
                          value={clinicId}
                          onValueChange={(val) =>
                            setApproveClinic(prev => ({ ...prev, [u.user_id]: val }))
                          }
                        >
                          <SelectTrigger className="w-full sm:w-48 h-8 text-xs" data-testid={`clinic-${u.user_id}`}>
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
                          {assignableRoles.map((r) => (
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

                      {isSuperAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Delete ${u.full_name || u.email}`}
                          onClick={() => openDelete(u)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="all-users-card">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-muted-foreground" />
              All Users
              {!isLoading && (
                <Badge variant="secondary" className="ml-1">
                  {isFiltered ? `${visibleUsers.length} of ${activeUsers.length}` : activeUsers.length}
                </Badge>
              )}
            </CardTitle>
            <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setAddUserOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add User
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name or email"
                aria-label="Search users"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-8 w-full text-xs sm:w-44" aria-label="Filter by role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROLE_FILTER_ALL} className="text-xs">All roles</SelectItem>
                {assignableRoles.map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">{ROLE_LABELS[r]}</SelectItem>
                ))}
                <SelectItem value="unassigned" className="text-xs">Unassigned</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
          ) : visibleUsers.length === 0 ? (
            <div className="space-y-2 py-2">
              <p className="text-sm text-muted-foreground">
                No user matches {term ? <span className="font-medium text-foreground">“{search.trim()}”</span> : "this filter"}.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => { setSearch(""); setRoleFilter(ROLE_FILTER_ALL); }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {visibleUsers.map((u) => {
                const currentRoleValue = u.role ?? "unassigned";
                const self = isSelf(u.user_id);

                return (
                  <div key={u.user_id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium">{u.full_name || "—"}</span>
                        <span className="min-w-0 truncate text-xs text-muted-foreground">{u.email}</span>
                        {self && <span className="text-xs italic text-muted-foreground">you</span>}
                      </div>
                      {showClinic && u.clinic_name && (
                        <p className="truncate text-xs text-muted-foreground">{u.clinic_name}</p>
                      )}
                    </div>

                    <Badge
                      variant="outline"
                      className={`shrink-0 text-[11px] font-normal ${u.role ? roleBadgeClass(u.role) : "border-dashed text-muted-foreground"}`}
                    >
                      {u.role ? ROLE_LABELS[u.role] ?? u.role : "Unassigned"}
                    </Badge>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 shrink-0 p-0"
                          aria-label={`Actions for ${u.full_name || u.email}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                          {self ? "You cannot change your own role" : "Change role"}
                        </DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={currentRoleValue}
                          onValueChange={(val) => {
                            if (val === currentRoleValue) return;
                            assignRole.mutate({
                              userId: u.user_id,
                              role: val,
                              previousRole: currentRoleValue,
                            });
                          }}
                        >
                          {assignableRoles.map((r) => (
                            <DropdownMenuRadioItem key={r} value={r} className="text-xs" disabled={self}>
                              {ROLE_LABELS[r]}
                            </DropdownMenuRadioItem>
                          ))}
                          <DropdownMenuRadioItem value="unassigned" className="text-xs" disabled={self}>
                            Unassigned
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-xs"
                          onSelect={() => {
                            setResetTarget({ id: u.user_id, email: u.email });
                            setResetPassword("");
                            setResetError(null);
                            setResetOpen(true);
                          }}
                        >
                          <KeyRound className="mr-2 h-3.5 w-3.5" />
                          Set password
                        </DropdownMenuItem>
                        {isSuperAdmin && !self && u.role !== "super_admin" && (
                          <DropdownMenuItem
                            className="text-xs text-destructive focus:text-destructive"
                            onSelect={() => openDelete(u)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Delete user
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
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

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteConfirm(""); setDeleteError(null); } }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this account?</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 rounded-md border bg-muted/40 p-3">
            <p className="text-sm font-medium">{deleteTarget?.full_name || "—"}</p>
            <p className="text-xs text-muted-foreground">{deleteTarget?.email}</p>
            <p className="text-xs text-muted-foreground">
              {deleteTarget?.clinic_name ?? deleteTarget?.pending_clinic_name ?? "No clinic"}
              {" · "}
              {deleteTarget?.role ? ROLE_LABELS[deleteTarget.role] ?? deleteTarget.role : "Unassigned"}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            This permanently removes the login, its profile and its role. It cannot be undone.
            An account that authored any clinical or stock record cannot be deleted — set its
            role to Unassigned instead.
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); if (deleteTarget) deleteUser.mutate(deleteTarget.user_id); }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">
                Type <span className="font-mono font-medium text-foreground">{deleteTarget?.email}</span> to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                autoComplete="off"
                placeholder={deleteTarget?.email}
              />
            </div>
            {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={deleteUser.isPending || deleteConfirm.trim() !== deleteTarget?.email}
              >
                {deleteUser.isPending ? "Deleting…" : "Delete account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addUserOpen} onOpenChange={(open) => { setAddUserOpen(open); if (!open) { setAddUserError(null); setDeliveryMode("invite"); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (deliveryMode === "invite") inviteUser.mutate();
              else createUser.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Login details</Label>
              <RadioGroup
                value={deliveryMode}
                onValueChange={(v) => setDeliveryMode(v as "invite" | "manual")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="invite" id="mode-invite" />
                  <Label htmlFor="mode-invite" className="font-normal">Send email invite</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="manual" id="mode-manual" />
                  <Label htmlFor="mode-manual" className="font-normal">Set password manually</Label>
                </div>
              </RadioGroup>
            </div>
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
            {deliveryMode === "manual" && (
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
            )}
            <div className="space-y-2">
              <Label htmlFor="add-role">Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger id="add-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => (
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
              <Button type="submit" disabled={createUser.isPending || inviteUser.isPending || (isSuperAdmin && !newClinicId)}>
                {createUser.isPending || inviteUser.isPending
                  ? (deliveryMode === "invite" ? "Sending…" : "Creating…")
                  : (deliveryMode === "invite" ? "Send Invite" : "Create User")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
