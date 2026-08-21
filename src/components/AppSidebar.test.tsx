import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppSidebar } from "./AppSidebar";

// Mock Supabase client to avoid real network calls
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => Promise.resolve({ data: [], error: null, count: 0 })),
        })),
        count: "exact",
        head: true,
      })),
    })),
    rpc: vi.fn(() => Promise.resolve({ data: 0, error: null })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}));

const { supabase } = await import("@/integrations/supabase/client");

// Mock AuthContext
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

// Mock entire sidebar module — Sidebar component uses a local useSidebar closure tied to
// React context, so mocking only the export is insufficient. Replacing with simple wrappers
// avoids SidebarProvider requirement while still rendering nav item children.
vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: vi.fn(() => ({ state: "expanded", open: true, setOpen: vi.fn(), openMobile: false, setOpenMobile: vi.fn(), isMobile: false, toggleSidebar: vi.fn() })),
  Sidebar: ({ children }: { children: React.ReactNode }) => <div data-testid="sidebar">{children}</div>,
  SidebarContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => <div>{children}</div>,
}));

const { useAuth } = await import("@/contexts/AuthContext");

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderSidebar(
  role: "pharmacist" | "doctor" | "fms" | "admin" | "super_admin",
  profile: object | null = { full_name: "Test User", clinic_id: "clinic-1", clinic_name: "KK Kempas" },
) {
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id: "user-1" },
    role,
    profile,
    loading: false,
    session: null,
    signOut: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={["/"]}>
      <QueryClientProvider client={makeQueryClient()}>
        <AppSidebar />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("AppSidebar navigation labels", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders 'New Requests' nav label for pharmacist", () => {
    renderSidebar("pharmacist");
    // Currently shows "Permintaan Baharu" — this FAILS until ENGL-01 translation
    expect(screen.getByText("New Requests")).toBeInTheDocument();
  });

  it("renders 'Patients' nav label for pharmacist", () => {
    renderSidebar("pharmacist");
    // Currently shows "Pesakit" — this FAILS until ENGL-01 translation
    expect(screen.getByText("Patients")).toBeInTheDocument();
  });

  it("renders 'Reports' nav label for pharmacist", () => {
    renderSidebar("pharmacist");
    // Currently shows "Laporan" — this FAILS until ENGL-01 translation
    expect(screen.getByText("Reports")).toBeInTheDocument();
  });

  it("does not render 'Role Management' nav label for pharmacist", () => {
    renderSidebar("pharmacist");
    // Role Management is admin-only navigation.
    expect(screen.queryByText("Role Management")).not.toBeInTheDocument();
  });

  it("renders 'Approvals' nav label for fms", () => {
    renderSidebar("fms");
    // FMS is an antibiotic approver: AppSidebar gates Approvals to
    // ["admin", "fms", "pharmacist"], matching /specialist in ProtectedRoute.
    expect(screen.getByText("Approvals")).toBeInTheDocument();
  });

  it("renders 'Approvals' nav label for pharmacist", () => {
    renderSidebar("pharmacist");
    expect(screen.getByText("Approvals")).toBeInTheDocument();
  });

  it("does not render 'FMS Dashboard', 'MO Dashboard', 'Terimaan', 'Drug Request', or 'Antibiotic Form' nav labels for pharmacist", () => {
    renderSidebar("pharmacist");
    // Pharmacist works its own queues (New Requests, Approvals) and reference
    // tools, not the FMS/MO clinical dashboards or the MO-facing request forms.
    expect(screen.queryByText("FMS Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("MO Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Terimaan")).not.toBeInTheDocument();
    expect(screen.queryByText("Drug Request")).not.toBeInTheDocument();
    expect(screen.queryByText("Antibiotic Form")).not.toBeInTheDocument();
  });
});

describe("AppSidebar unassigned-user badge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts unassigned users for admin", async () => {
    renderSidebar("admin");
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith("get_unassigned_user_count")
    );
  });

  // super_admin reaches Role Management and approves users there, so the badge
  // has to reach them too.
  it("counts unassigned users for super_admin", async () => {
    renderSidebar("super_admin");
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith("get_unassigned_user_count")
    );
  });

  it("does not count them for a pharmacist", async () => {
    renderSidebar("pharmacist");
    await waitFor(() => expect(screen.getByTestId("sidebar")).toBeInTheDocument());
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

// The sidebar header used to read "KK Kempas" for everyone, hardcoded. At any
// of the other 14 clinics that is simply the wrong clinic's name over the
// right clinic's data.
describe("AppSidebar clinic scope label", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the signed-in user's own clinic", () => {
    renderSidebar("admin", { full_name: "Test User", clinic_id: "clinic-2", clinic_name: "KK Larkin" });
    expect(screen.getByText("KK Larkin")).toBeInTheDocument();
    expect(screen.queryByText("KK Kempas")).not.toBeInTheDocument();
  });

  // super_admin has clinic_id NULL by design and does span every clinic, so
  // naming one particular clinic for them is a lie about what they are seeing.
  it("says 'All clinics' for super_admin rather than naming one", () => {
    renderSidebar("super_admin", { full_name: "Root", clinic_id: null, clinic_name: "" });
    expect(screen.getByText("All clinics")).toBeInTheDocument();
  });

  it("names no clinic at all when there is none to name", () => {
    renderSidebar("admin", { full_name: "Test User", clinic_id: null, clinic_name: "" });
    expect(screen.queryByText("All clinics")).not.toBeInTheDocument();
    expect(screen.queryByText("KK Kempas")).not.toBeInTheDocument();
    // The product name still renders — only the clinic line is suppressed.
    expect(screen.getByText("PharmaSync")).toBeInTheDocument();
  });
});
