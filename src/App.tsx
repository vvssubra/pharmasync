import type React from "react";
import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import { PwaUpdatePrompt } from "@/components/PwaUpdatePrompt";
import { InstallPrompt } from "@/components/InstallPrompt";
import { NotificationSetup } from "@/components/NotificationSetup";
import { IdleTimeout } from "@/components/IdleTimeout";
import { PageSkeleton } from "@/components/PageSkeleton";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";

// Route-level code splitting: each page ships as its own chunk and is fetched
// on first navigation, so the initial load carries the login screen and the
// shell, not every dashboard in the app.
//
// A deploy renames every chunk. A tab opened before the deploy still holds the
// old chunk names, so its first navigation afterwards 404s. One reload picks
// up the new index; the sessionStorage flag stops a genuinely broken build
// from reload-looping.
const RELOAD_FLAG = "pharmasync:chunk-reloaded";
function lazyPage<T extends React.ComponentType>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().then((mod) => {
      sessionStorage.removeItem(RELOAD_FLAG);
      return mod;
    }).catch((err) => {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, "1");
        window.location.reload();
        return new Promise<never>(() => {});
      }
      throw err;
    }),
  );
}

const Dashboard = lazyPage(() => import("@/pages/Index"));
const FmsDashboard = lazyPage(() => import("@/pages/FmsDashboard"));
const MoDashboard = lazyPage(() => import("@/pages/MoDashboard"));
const DrugMaster = lazyPage(() => import("@/pages/DrugMaster"));
const Terimaan = lazyPage(() => import("@/pages/Terimaan"));
const Laporan = lazyPage(() => import("@/pages/Laporan"));
const DrugLedger = lazyPage(() => import("@/pages/DrugLedger"));
const DoctorLanding = lazyPage(() => import("@/pages/DoctorLanding"));
const DoctorRequest = lazyPage(() => import("@/pages/DoctorRequest"));
const AntibioticForm = lazyPage(() => import("@/pages/AntibioticForm"));
const SpecialistDashboard = lazyPage(() => import("@/pages/SpecialistDashboard"));
const PharmacistFulfilment = lazyPage(() => import("@/pages/PharmacistFulfilment"));
const AntibioticArchive = lazyPage(() => import("@/pages/AntibioticArchive"));
const PatientRegistry = lazyPage(() => import("@/pages/PatientRegistry"));
const RoleManagement = lazyPage(() => import("@/pages/RoleManagement"));
const Clinics = lazyPage(() => import("@/pages/Clinics"));
const Settings = lazyPage(() => import("@/pages/Settings"));
const ResetPassword = lazyPage(() => import("@/pages/ResetPassword"));
const ChangePassword = lazyPage(() => import("@/pages/ChangePassword"));
const PaedsDoseCalculator = lazyPage(() => import("@/pages/PaedsDoseCalculator"));
const G6pdDeficiency = lazyPage(() => import("@/pages/G6pdDeficiency"));
const Survey = lazyPage(() => import("@/pages/Survey"));
const LogistikDashboard = lazyPage(() => import("@/pages/LogistikDashboard"));

const queryClient = new QueryClient();

/** Sends fms → /fms and mo → /mo; everyone else sees the admin/pharmacist dashboard. */
function RoleRedirect() {
  const { role } = useAuth();
  if (role === "fms") return <Navigate to="/fms" replace />;
  if (role === "mo") return <Navigate to="/mo" replace />;
  if (role === "logistic_pharmacist") return <Navigate to="/logistik" replace />;
  return <Dashboard />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      {/* Above AuthProvider on purpose: the update toast must work on the
          login screen too. */}
      <PwaUpdatePrompt />
      <AuthProvider>
        {/* Inside AuthProvider: fires after login, every login, until the app
            is actually installed on the device. */}
        <InstallPrompt />
        {/* Approver roles only: subscribes the device to Web Push so request
            notifications arrive even with the app closed. */}
        <NotificationSetup />
        {/* Signs the user out after 1 hour with no activity; warns 2 min before. */}
        <IdleTimeout />
        <BrowserRouter>
          {/* Same skeleton ProtectedRoute shows while auth resolves, so a
              chunk fetch and an auth check look identical to the user. */}
          <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/survey" element={<Survey />} />
            {/* Every role: reachable from the navbar, and the only page a user
                with must_change_password can open. */}
            <Route path="/change-password" element={<ProtectedRoute><AppLayout><ChangePassword /></AppLayout></ProtectedRoute>} />
            {/* MO routes */}
            <Route path="/request" element={<ProtectedRoute><AppLayout><DoctorLanding /></AppLayout></ProtectedRoute>} />
            <Route path="/request/ubat" element={<ProtectedRoute><AppLayout><DoctorRequest /></AppLayout></ProtectedRoute>} />
            <Route path="/request/antibiotik" element={<ProtectedRoute><AppLayout><AntibioticForm /></AppLayout></ProtectedRoute>} />
            <Route path="/mo" element={<ProtectedRoute><AppLayout><MoDashboard /></AppLayout></ProtectedRoute>} />
            {/* Reference tool — read-only, no patient record is created. */}
            <Route path="/g6pd" element={<ProtectedRoute><AppLayout><G6pdDeficiency /></AppLayout></ProtectedRoute>} />
            <Route path="/dos-paediatrik" element={<ProtectedRoute><AppLayout><PaedsDoseCalculator /></AppLayout></ProtectedRoute>} />
            {/* FMS + Approvals */}
            <Route path="/fms" element={<ProtectedRoute><AppLayout><FmsDashboard /></AppLayout></ProtectedRoute>} />
            <Route path="/specialist" element={<ProtectedRoute><AppLayout><SpecialistDashboard /></AppLayout></ProtectedRoute>} />
            {/* Admin + Pharmacist routes */}
            <Route path="/" element={<ProtectedRoute><AppLayout><RoleRedirect /></AppLayout></ProtectedRoute>} />
            <Route path="/drugs" element={<ProtectedRoute><AppLayout><DrugMaster /></AppLayout></ProtectedRoute>} />
            <Route path="/drugs/:id/ledger" element={<ProtectedRoute><AppLayout><DrugLedger /></AppLayout></ProtectedRoute>} />
            <Route path="/terimaan" element={<ProtectedRoute><AppLayout><Terimaan /></AppLayout></ProtectedRoute>} />
            <Route path="/fulfilment" element={<ProtectedRoute><AppLayout><PharmacistFulfilment /></AppLayout></ProtectedRoute>} />
            <Route path="/abx-archive" element={<ProtectedRoute><AppLayout><AntibioticArchive /></AppLayout></ProtectedRoute>} />
            {/* Old bookmarked path; kept so existing links keep working. */}
            <Route path="/arkib-antibiotik" element={<Navigate to="/abx-archive" replace />} />
            <Route path="/pesakit" element={<ProtectedRoute><AppLayout><PatientRegistry /></AppLayout></ProtectedRoute>} />
            <Route path="/laporan" element={<ProtectedRoute><AppLayout><Laporan /></AppLayout></ProtectedRoute>} />
            <Route path="/role-management" element={<ProtectedRoute><AppLayout><RoleManagement /></AppLayout></ProtectedRoute>} />
            {/* super_admin only — see ROUTE_PERMISSIONS in ProtectedRoute. */}
            <Route path="/clinics" element={<ProtectedRoute><AppLayout><Clinics /></AppLayout></ProtectedRoute>} />
            {/* admin + super_admin — login page announcement ticker. */}
            <Route path="/settings" element={<ProtectedRoute><AppLayout><Settings /></AppLayout></ProtectedRoute>} />
            {/* Logistic pharmacist HQ dashboard */}
            <Route path="/logistik" element={<ProtectedRoute><AppLayout><LogistikDashboard /></AppLayout></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
