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
import Login from "@/pages/Login";
import Dashboard from "@/pages/Index";
import FmsDashboard from "@/pages/FmsDashboard";
import MoDashboard from "@/pages/MoDashboard";
import DrugMaster from "@/pages/DrugMaster";
import Terimaan from "@/pages/Terimaan";
import Laporan from "@/pages/Laporan";
import DrugLedger from "@/pages/DrugLedger";
import DoctorLanding from "@/pages/DoctorLanding";
import DoctorRequest from "@/pages/DoctorRequest";
import AntibioticForm from "@/pages/AntibioticForm";
import SpecialistDashboard from "@/pages/SpecialistDashboard";
import PharmacistFulfilment from "@/pages/PharmacistFulfilment";
import AntibioticArchive from "@/pages/AntibioticArchive";
import PatientRegistry from "@/pages/PatientRegistry";
import RoleManagement from "@/pages/RoleManagement";
import Clinics from "@/pages/Clinics";
import ResetPassword from "@/pages/ResetPassword";
import ChangePassword from "@/pages/ChangePassword";
import PaedsDoseCalculator from "@/pages/PaedsDoseCalculator";
import G6pdDeficiency from "@/pages/G6pdDeficiency";
import Survey from "@/pages/Survey";
import LogistikDashboard from "@/pages/LogistikDashboard";
import NotFound from "@/pages/NotFound";

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
            {/* Logistic pharmacist HQ dashboard */}
            <Route path="/logistik" element={<ProtectedRoute><AppLayout><LogistikDashboard /></AppLayout></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
