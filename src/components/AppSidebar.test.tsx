import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}));

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

function renderSidebar(role: "pharmacist" | "doctor" | "specialist" | "fms") {
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id: "user-1" },
    role,
    profile: { full_name: "Test User", facility: "KK Kempas" },
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

  it("does not render 'Approvals' nav label for fms", () => {
    renderSidebar("fms");
    expect(screen.queryByText("Approvals")).not.toBeInTheDocument();
  });
});
