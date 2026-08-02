import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { NoPermission } from "@/components/NoPermission";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PendingApproval } from "@/components/PendingApproval";
import { ClinicRequest } from "@/components/ClinicRequest";

/** Declares which roles can access each route prefix. */
const ROUTE_PERMISSIONS: Array<{ prefix: string; roles: AppRole[] }> = [
  { prefix: "/role-management", roles: ["admin", "super_admin"] },
  { prefix: "/fms",             roles: ["admin", "fms", "pharmacist", "super_admin"] },
  { prefix: "/mo",              roles: ["admin", "mo", "pharmacist", "super_admin"] },
  { prefix: "/request",         roles: ["admin", "mo", "pharmacist", "super_admin"] },
  { prefix: "/specialist",      roles: ["admin", "fms", "super_admin"] },
  { prefix: "/fulfilment",      roles: ["admin", "fms", "pharmacist", "super_admin"] },
  { prefix: "/arkib-antibiotik", roles: ["admin", "fms", "pharmacist", "super_admin"] },
  { prefix: "/drugs",           roles: ["admin", "fms", "pharmacist", "super_admin"] },
  { prefix: "/terimaan",        roles: ["admin", "fms", "pharmacist", "super_admin"] },
  { prefix: "/pesakit",         roles: ["admin", "fms", "pharmacist", "super_admin"] },
  { prefix: "/laporan",         roles: ["admin", "fms", "pharmacist", "super_admin"] },
  { prefix: "/",                roles: ["admin", "fms", "mo", "pharmacist", "super_admin"] },
  // NB /change-password is deliberately absent: it is open to every signed-in
  // user and short-circuits before this table is consulted (see below).
];

function getAllowedRoles(pathname: string): AppRole[] {
  for (const { prefix, roles } of ROUTE_PERMISSIONS) {
    if (pathname === prefix || pathname.startsWith(prefix === "/" ? "/?" : prefix)) {
      return roles;
    }
  }
  return ["admin", "pharmacist", "super_admin"];
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, role, loading, profile, mustChangePassword } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <AppLayout>
        <PageSkeleton />
      </AppLayout>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Ahead of the clinic and role gates on purpose: an admin-created account
  // arrives with a shared temporary password, and that has to be replaced
  // before the account is worth anything — including before it is told to wait
  // for approval. Navigating away from /change-password lands back here.
  if (mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  // Changing your own password reads and writes nothing clinic-scoped, so the
  // clinic and role gates below do not apply. Without this, a user held here by
  // must_change_password but not yet approved into a clinic would be shown
  // ClinicRequest and could never reach the form they were sent to.
  if (location.pathname === "/change-password") {
    return <>{children}</>;
  }

  // No clinic → nothing in the app works: every clinic-scoped insert raises in
  // stamp_clinic_id(). Ask for the clinic if they have not requested one (the
  // Google path never collects it), otherwise wait for an admin. A null profile
  // means the fetch failed rather than that a clinic is missing, so it falls
  // through to the role check below. super_admin is exempt: it spans all
  // clinics and legitimately has none of its own.
  if (profile && !profile.clinic_id && role !== "super_admin") {
    return profile.pending_clinic_id ? <PendingApproval /> : <ClinicRequest />;
  }

  // authenticated but no role → pending approval (outside AppLayout)
  if (!role) {
    return <PendingApproval />;
  }

  const allowedRoles = getAllowedRoles(location.pathname);

  if (!allowedRoles.includes(role)) {
    return <AppLayout><NoPermission /></AppLayout>;
  }

  return <>{children}</>;
}
