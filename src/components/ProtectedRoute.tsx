import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { NoPermission } from "@/components/NoPermission";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PendingApproval } from "@/components/PendingApproval";

/** Declares which roles can access each route prefix. */
const ROUTE_PERMISSIONS: Array<{ prefix: string; roles: AppRole[] }> = [
  { prefix: "/role-management", roles: ["admin"] },
  { prefix: "/fms",             roles: ["admin", "fms", "pharmacist"] },
  { prefix: "/mo",              roles: ["admin", "mo", "pharmacist"] },
  { prefix: "/request",         roles: ["admin", "mo", "pharmacist"] },
  { prefix: "/specialist",      roles: ["admin", "fms"] },
  { prefix: "/fulfilment",      roles: ["admin", "fms", "pharmacist"] },
  { prefix: "/drugs",           roles: ["admin", "fms", "pharmacist"] },
  { prefix: "/terimaan",        roles: ["admin", "fms", "pharmacist"] },
  { prefix: "/pesakit",         roles: ["admin", "fms", "pharmacist"] },
  { prefix: "/laporan",         roles: ["admin", "fms", "pharmacist"] },
  { prefix: "/",                roles: ["admin", "pharmacist"] },
];

function getAllowedRoles(pathname: string): AppRole[] {
  for (const { prefix, roles } of ROUTE_PERMISSIONS) {
    if (pathname === prefix || pathname.startsWith(prefix === "/" ? "/?" : prefix)) {
      return roles;
    }
  }
  return ["admin", "pharmacist"];
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth();
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
