import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoleManagement from "./RoleManagement";

type MockUser = {
  user_id: string;
  email: string;
  full_name: string;
  clinic_id: string | null;
  clinic_name: string | null;
  role: string | null;
  pending_clinic_id: string | null;
  pending_clinic_name: string | null;
};

const KEMPAS = "00000000-0000-0000-0000-000000000001";

const APPROVED: MockUser = {
  user_id: "approved-1", email: "admin@kk.my", full_name: "Dr Admin",
  clinic_id: KEMPAS, clinic_name: "Klinik Kesihatan Kempas", role: "admin",
  pending_clinic_id: null, pending_clinic_name: null,
};

const PENDING: MockUser = {
  user_id: "pending-1", email: "newmo@kk.my", full_name: "Dr Baru",
  clinic_id: null, clinic_name: null, role: null,
  pending_clinic_id: KEMPAS, pending_clinic_name: "Klinik Kesihatan Kempas",
};

// Google OAuth signup — no clinic recorded at all.
const ORPHAN: MockUser = {
  user_id: "orphan-1", email: "oauth@moh.gov.my", full_name: "Dr Oauth",
  clinic_id: null, clinic_name: null, role: null,
  pending_clinic_id: null, pending_clinic_name: null,
};

// super_admin has no clinic by design — it spans all of them.
const SUPER: MockUser = {
  user_id: "super-1", email: "psubramaniam@moh.gov.my", full_name: "Subra",
  clinic_id: null, clinic_name: null, role: "super_admin",
  pending_clinic_id: null, pending_clinic_name: null,
};

let mockUsers: MockUser[] = [];
const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: [{ id: KEMPAS, name: "Klinik Kesihatan Kempas" }], error: null })),
      })),
    })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) },
}));

const { useAuth } = await import("@/contexts/AuthContext");

function renderPage(role = "admin") {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: APPROVED.user_id },
    role,
  } as unknown as ReturnType<typeof useAuth>);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoleManagement />
    </QueryClientProvider>
  );
}

function pendingCard() {
  return screen.getByTestId("pending-approval-card");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUsers = [APPROVED, PENDING, ORPHAN];
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_all_users_with_roles") return Promise.resolve({ data: mockUsers, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

describe("RoleManagement pending approval", () => {
  it("lists clinic-less users in the pending card, not the main list", async () => {
    renderPage();
    await waitFor(() => expect(within(pendingCard()).getByText("Dr Baru")).toBeTruthy());

    const mainList = screen.getByTestId("all-users-card");
    expect(within(mainList).getByText("Dr Admin")).toBeTruthy();
    expect(within(mainList).queryByText("Dr Baru")).toBeNull();
  });

  it("shows the requested clinic, and labels orphans as having requested none", async () => {
    renderPage();
    await waitFor(() => expect(within(pendingCard()).getByText("Dr Oauth")).toBeTruthy());

    expect(within(pendingCard()).getByText(/Klinik Kesihatan Kempas/)).toBeTruthy();
    expect(within(pendingCard()).getByText(/No clinic requested/)).toBeTruthy();
  });

  it("approves with the selected user and role", async () => {
    renderPage();
    await waitFor(() => expect(within(pendingCard()).getByText("Dr Baru")).toBeTruthy());

    fireEvent.click(screen.getByTestId("approve-pending-1"));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("approve_clinic_member", {
        target_user: "pending-1",
        target_role: "mo",
        target_clinic: null,
      })
    );
  });

  it("surfaces the RPC's own error message", async () => {
    renderPage();
    await waitFor(() => expect(within(pendingCard()).getByText("Dr Baru")).toBeTruthy());

    rpc.mockImplementation((fn: string) => {
      if (fn === "get_all_users_with_roles") return Promise.resolve({ data: mockUsers, error: null });
      return Promise.resolve({
        data: null,
        error: { message: "Your own profile has no clinic, so you cannot approve anyone" },
      });
    });

    fireEvent.click(screen.getByTestId("approve-pending-1"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Your own profile has no clinic, so you cannot approve anyone"
      )
    );
  });

  // A failing RPC used to render as "No users found", which reads as an empty
  // database and hides the real cause (schema cache, permissions, guard).
  it("shows the failure when the user list cannot be loaded", async () => {
    rpc.mockImplementation(() =>
      Promise.resolve({
        data: null,
        error: { message: "Could not find the function public.get_all_users_with_roles" },
      })
    );

    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText(/Could not find the function public.get_all_users_with_roles/)
      ).toBeTruthy()
    );
    expect(screen.queryByText("No users found.")).toBeNull();
  });

  // A clinic-less super_admin is by design, not awaiting approval — it must
  // not sit in the pending queue forever.
  it("keeps super_admin out of the pending card", async () => {
    mockUsers = [APPROVED, SUPER];
    renderPage();
    await waitFor(() => expect(screen.getByText("Subra")).toBeTruthy());
    expect(screen.queryByTestId("pending-approval-card")).toBeNull();
  });

  it("hides the pending card when every user has a clinic", async () => {
    mockUsers = [APPROVED];
    renderPage();
    await waitFor(() => expect(screen.getByTestId("all-users-card")).toBeTruthy());
    expect(screen.queryByTestId("pending-approval-card")).toBeNull();
  });

  it("offers a clinic picker to super_admin only", async () => {
    const { unmount } = renderPage("admin");
    await waitFor(() => expect(within(pendingCard()).getByText("Dr Baru")).toBeTruthy());
    expect(screen.queryByTestId("clinic-pending-1")).toBeNull();
    unmount();

    renderPage("super_admin");
    await waitFor(() => expect(within(pendingCard()).getByText("Dr Baru")).toBeTruthy());
    expect(screen.getByTestId("clinic-pending-1")).toBeTruthy();
  });
});
