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

const { useAuth } = await import("@/contexts/AuthContext");

function renderWithRouter(
  path: string,
  auth: { user: object | null; role: AppRole | null; loading: boolean }
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
});
