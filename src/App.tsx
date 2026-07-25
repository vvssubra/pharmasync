import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
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
import ResetPassword from "@/pages/ResetPassword";
import Survey from "@/pages/Survey";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

/** Sends fms → /fms and mo → /mo; everyone else sees the admin/pharmacist dashboard. */
function RoleRedirect() {
  const { role } = useAuth();
  if (role === "fms") return <Navigate to="/fms" replace />;
  if (role === "mo") return <Navigate to="/mo" replace />;
  return <Dashboard />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/survey" element={<Survey />} />
            {/* MO routes */}
            <Route path="/request" element={<ProtectedRoute><AppLayout><DoctorLanding /></AppLayout></ProtectedRoute>} />
            <Route path="/request/ubat" element={<ProtectedRoute><AppLayout><DoctorRequest /></AppLayout></ProtectedRoute>} />
            <Route path="/request/antibiotik" element={<ProtectedRoute><AppLayout><AntibioticForm /></AppLayout></ProtectedRoute>} />
            <Route path="/mo" element={<ProtectedRoute><AppLayout><MoDashboard /></AppLayout></ProtectedRoute>} />
            {/* FMS + Approvals */}
            <Route path="/fms" element={<ProtectedRoute><AppLayout><FmsDashboard /></AppLayout></ProtectedRoute>} />
            <Route path="/specialist" element={<ProtectedRoute><AppLayout><SpecialistDashboard /></AppLayout></ProtectedRoute>} />
            {/* Admin + Pharmacist routes */}
            <Route path="/" element={<ProtectedRoute><AppLayout><RoleRedirect /></AppLayout></ProtectedRoute>} />
            <Route path="/drugs" element={<ProtectedRoute><AppLayout><DrugMaster /></AppLayout></ProtectedRoute>} />
            <Route path="/drugs/:id/ledger" element={<ProtectedRoute><AppLayout><DrugLedger /></AppLayout></ProtectedRoute>} />
            <Route path="/terimaan" element={<ProtectedRoute><AppLayout><Terimaan /></AppLayout></ProtectedRoute>} />
            <Route path="/fulfilment" element={<ProtectedRoute><AppLayout><PharmacistFulfilment /></AppLayout></ProtectedRoute>} />
            <Route path="/arkib-antibiotik" element={<ProtectedRoute><AppLayout><AntibioticArchive /></AppLayout></ProtectedRoute>} />
            <Route path="/pesakit" element={<ProtectedRoute><AppLayout><PatientRegistry /></AppLayout></ProtectedRoute>} />
            <Route path="/laporan" element={<ProtectedRoute><AppLayout><Laporan /></AppLayout></ProtectedRoute>} />
            <Route path="/role-management" element={<ProtectedRoute><AppLayout><RoleManagement /></AppLayout></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
