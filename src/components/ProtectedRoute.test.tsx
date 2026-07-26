import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import type { AppRole } from "@/contexts/AuthContext";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/PageSkeleton", () => ({
  PageSkeleton: () => <div>Loading skeleton</div>,
}));
vi.mock("@/components/PendingApproval", () => ({
  PendingApproval: () => <div>Pending Approval</div>,
}));
vi.mock("@/components/ClinicRequest", () => ({
  ClinicRequest: () => <div>Clinic Request</div>,
}));

const { useAuth } = await import("@/contexts/AuthContext");

type MockProfile = {
  full_name: string;
  clinic_id: string | null;
  clinic_name: string;
  pending_clinic_id: string | null;
};

function renderWithRouter(
  path: string,
  auth: {
    user: object | null;
    role: AppRole | null;
    loading: boolean;
    profile?: MockProfile | null;
  }
) {
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue(auth);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/specialist"      element={<ProtectedRoute><div>Specialist page</div></ProtectedRoute>} />
        <Route path="/fulfilment"      element={<ProtectedRoute><div>Permintaan Baharu page</div></ProtectedRoute>} />
        <Route path="/request"         element={<ProtectedRoute><div>Doctor Request page</div></ProtectedRoute>} />
        <Route path="/role-management" element={<ProtectedRoute><div>Role Management page</div></ProtectedRoute>} />
        <Route path="/drugs"           element={<ProtectedRoute><div>Drugs page</div></ProtectedRoute>} />
        <Route path="/"                element={<div>Dashboard</div>} />
        <Route path="/login"           element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("unauthenticated user", () => {
    it("redirects to /login when no user", () => {
      renderWithRouter("/drugs", { user: null, role: null, loading: false });
      expect(screen.getByText("Login page")).toBeInTheDocument();
    });
  });

  describe("unassigned user (role = null)", () => {
    it("shows PendingApproval on /specialist", () => {
      renderWithRouter("/specialist", { user: { id: "1" }, role: null, loading: false });
      expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    });
    it("shows PendingApproval on /drugs", () => {
      renderWithRouter("/drugs", { user: { id: "1" }, role: null, loading: false });
      expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    });
    it("shows PendingApproval on /request", () => {
      renderWithRouter("/request", { user: { id: "1" }, role: null, loading: false });
      expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    });
  });

  describe("mo role", () => {
    it("allows access to /request", () => {
      renderWithRouter("/request", { user: { id: "1" }, role: "mo", loading: false });
      expect(screen.getByText("Doctor Request page")).toBeInTheDocument();
    });
    it("blocks access to /drugs", () => {
      renderWithRouter("/drugs", { user: { id: "1" }, role: "mo", loading: false });
      expect(screen.getByRole("heading", { name: /No Permission/i })).toBeInTheDocument();
    });
    it("blocks access to /fulfilment", () => {
      renderWithRouter("/fulfilment", { user: { id: "1" }, role: "mo", loading: false });
      expect(screen.getByRole("heading", { name: /No Permission/i })).toBeInTheDocument();
    });
    it("blocks access to /role-management", () => {
      renderWithRouter("/role-management", { user: { id: "1" }, role: "mo", loading: false });
      expect(screen.getByRole("heading", { name: /No Permission/i })).toBeInTheDocument();
    });
  });

  describe("specialist role", () => {
    it("blocks access to /specialist", () => {
      renderWithRouter("/specialist", { user: { id: "1" }, role: "specialist", loading: false });
      expect(screen.getByRole("heading", { name: /No Permission/i })).toBeInTheDocument();
    });
    it("blocks access to /drugs", () => {
      renderWithRouter("/drugs", { user: { id: "1" }, role: "specialist", loading: false });
      expect(screen.getByRole("heading", { name: /No Permission/i })).toBeInTheDocument();
    });
    it("blocks access to /role-management", () => {
      renderWithRouter("/role-management", { user: { id: "1" }, role: "specialist", loading: false });
      expect(screen.getByRole("heading", { name: /No Permission/i })).toBeInTheDocument();
    });
  });

  describe("pharmacist role", () => {
    it("allows access to /fulfilment", () => {
      renderWithRouter("/fulfilment", { user: { id: "1" }, role: "pharmacist", loading: false });
      expect(screen.getByText("Permintaan Baharu page")).toBeInTheDocument();
    });
    it("allows access to /specialist", () => {
      renderWithRouter("/specialist", { user: { id: "1" }, role: "pharmacist", loading: false });
      expect(screen.getByText("Specialist page")).toBeInTheDocument();
    });
    it("allows access to /request", () => {
      renderWithRouter("/request", { user: { id: "1" }, role: "pharmacist", loading: false });
      expect(screen.getByText("Doctor Request page")).toBeInTheDocument();
    });
    it("blocks access to /role-management", () => {
      renderWithRouter("/role-management", { user: { id: "1" }, role: "pharmacist", loading: false });
      expect(screen.getByRole("heading", { name: /No Permission/i })).toBeInTheDocument();
    });
    it("allows access to /drugs", () => {
      renderWithRouter("/drugs", { user: { id: "1" }, role: "pharmacist", loading: false });
      expect(screen.getByText("Drugs page")).toBeInTheDocument();
    });
  });

  describe("fms role", () => {
    it("blocks access to /specialist", () => {
      renderWithRouter("/specialist", { user: { id: "1" }, role: "fms", loading: false });
      expect(screen.getByRole("heading", { name: /No Permission/i })).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("shows skeleton while loading", () => {
      renderWithRouter("/drugs", { user: null, role: null, loading: true });
      expect(screen.getByText("Loading skeleton")).toBeInTheDocument();
    });
  });

  // A Google signup lands with no clinic and no request: handle_new_user() reads
  // the clinic from signup metadata, which OAuth never carries. Without a clinic
  // every clinic-scoped write raises, so these users are stopped before the app.
  describe("user with no clinic", () => {
    const noClinic: MockProfile = {
      full_name: "Dr Oauth", clinic_id: null, clinic_name: "", pending_clinic_id: null,
    };
    const requested: MockProfile = {
      full_name: "Dr Oauth", clinic_id: null, clinic_name: "", pending_clinic_id: "clinic-1",
    };

    it("asks for a clinic when none has been requested", () => {
      renderWithRouter("/drugs", { user: { id: "1" }, role: null, loading: false, profile: noClinic });
      expect(screen.getByText("Clinic Request")).toBeInTheDocument();
    });

    it("waits for approval once a clinic has been requested", () => {
      renderWithRouter("/drugs", { user: { id: "1" }, role: null, loading: false, profile: requested });
      expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    });

    // A role without a clinic is still unusable, so the gate runs first.
    it("asks for a clinic even if a role was already assigned", () => {
      renderWithRouter("/drugs", { user: { id: "1" }, role: "pharmacist", loading: false, profile: noClinic });
      expect(screen.getByText("Clinic Request")).toBeInTheDocument();
    });

    it("lets an approved user through", () => {
      renderWithRouter("/drugs", {
        user: { id: "1" }, role: "pharmacist", loading: false,
        profile: { full_name: "Dr Ada", clinic_id: "clinic-1", clinic_name: "KK Kempas", pending_clinic_id: null },
      });
      expect(screen.getByText("Drugs page")).toBeInTheDocument();
    });

    // A missing profile row means the fetch failed or has not landed — that is
    // not evidence of a missing clinic, so behaviour stays as it was.
    it("falls through to the old behaviour when there is no profile at all", () => {
      renderWithRouter("/drugs", { user: { id: "1" }, role: null, loading: false, profile: null });
      expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    });
  });
});
