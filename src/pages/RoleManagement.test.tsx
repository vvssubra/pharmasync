import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const fetchMock = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ user_id: "new-1", email: "x@y.z" }),
  })
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
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

const OTHER_MO: MockUser = {
  user_id: "mo-1", email: "drnisha274@gmail.com", full_name: "NISHANTHINI A/P SUBRAMANIAM",
  clinic_id: KEMPAS, clinic_name: "Klinik Kesihatan Kempas", role: "mo",
  pending_clinic_id: null, pending_clinic_name: null,
};

const OTHER_CLINIC: MockUser = {
  user_id: "hsa-1", email: "haliza@moh.gov.my", full_name: "HALIZA JALAL",
  clinic_id: "00000000-0000-0000-0000-000000000002", clinic_name: "Hospital Sultanah Aminah",
  role: "pharmacist", pending_clinic_id: null, pending_clinic_name: null,
};

function usersCard() {
  return screen.getByTestId("all-users-card");
}

describe("RoleManagement user list", () => {
  it("filters by name or email as you type", async () => {
    mockUsers = [APPROVED, OTHER_MO];
    renderPage();
    await waitFor(() => expect(within(usersCard()).getByText("Dr Admin")).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: "nisha" } });
    expect(within(usersCard()).getByText(/NISHANTHINI/)).toBeTruthy();
    expect(within(usersCard()).queryByText("Dr Admin")).toBeNull();

    // Email is searched too, not just the display name.
    fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: "admin@kk" } });
    expect(within(usersCard()).getByText("Dr Admin")).toBeTruthy();
    expect(within(usersCard()).queryByText(/NISHANTHINI/)).toBeNull();
  });

  it("offers a way out when a search matches nobody", async () => {
    mockUsers = [APPROVED, OTHER_MO];
    renderPage();
    await waitFor(() => expect(within(usersCard()).getByText("Dr Admin")).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: "zzzz" } });
    expect(screen.getByText(/no user matches/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(within(usersCard()).getByText("Dr Admin")).toBeTruthy();
  });

  // The clinic line was the same string on every row in a single-clinic
  // deployment; it only carries information once the list spans clinics.
  it("prints the clinic per row only when the list spans more than one", async () => {
    mockUsers = [APPROVED, OTHER_MO];
    const { unmount } = renderPage();
    await waitFor(() => expect(within(usersCard()).getByText("Dr Admin")).toBeTruthy());
    expect(within(usersCard()).queryByText("Klinik Kesihatan Kempas")).toBeNull();
    unmount();

    mockUsers = [APPROVED, OTHER_CLINIC];
    renderPage();
    await waitFor(() => expect(within(usersCard()).getByText("Dr Admin")).toBeTruthy());
    expect(within(usersCard()).getByText("Klinik Kesihatan Kempas")).toBeTruthy();
    expect(within(usersCard()).getByText("Hospital Sultanah Aminah")).toBeTruthy();
  });

  // Role commits on selection now — a per-row Save button spent a permanently
  // disabled control on every row to guard a reversible one-field change.
  it("has no per-row Save button", async () => {
    mockUsers = [APPROVED, OTHER_MO];
    renderPage();
    await waitFor(() => expect(within(usersCard()).getByText("Dr Admin")).toBeTruthy());
    expect(within(usersCard()).queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("shows the role once per row, not as both a badge and a dropdown", async () => {
    mockUsers = [OTHER_MO];
    renderPage();
    await waitFor(() => expect(within(usersCard()).getByText(/NISHANTHINI/)).toBeTruthy());
    expect(within(usersCard()).getAllByText("Medical Officer")).toHaveLength(1);
  });

  it("labels the row action menu with the person it acts on", async () => {
    mockUsers = [OTHER_MO];
    renderPage();
    await waitFor(() => expect(within(usersCard()).getByText(/NISHANTHINI/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /actions for NISHANTHINI/i })).toBeTruthy();
  });
});

async function openAddUserDialog() {
  await waitFor(() => expect(screen.getByTestId("all-users-card")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /add user/i }));
  await screen.findByText("Add New User");
}

function lastFetchBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as unknown as [
    string,
    { body: string },
  ];
  return JSON.parse(call[1].body);
}

describe("Add New User — invite mode", () => {
  it("defaults to invite mode with no password field", async () => {
    renderPage();
    await openAddUserDialog();

    expect(screen.getByRole("radio", { name: /send email invite/i }))
      .toHaveAttribute("aria-checked", "true");
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
  });

  it("sends invite_user payload without password", async () => {
    renderPage();
    await openAddUserDialog();

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Staff One" } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "staff@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastFetchBody();
    expect(body.action).toBe("invite_user");
    expect(body).not.toHaveProperty("password");
    expect(body.redirect_to).toBe(window.location.origin);
    expect(body.full_name).toBe("Staff One");
    expect(body.email).toBe("staff@gmail.com");
  });

  it("manual mode still sends create_user with password", async () => {
    renderPage();
    await openAddUserDialog();

    fireEvent.click(screen.getByRole("radio", { name: /set password manually/i }));
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Staff Two" } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "staff2@moh.gov.my" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastFetchBody();
    expect(body.action).toBe("create_user");
    expect(body.password).toBe("secret123");
  });
});

// Wrong-email signups are the reason delete exists: an MO registers with a
// personal address, then re-registers with their MOH one, leaving a dead
// account behind.
describe("Deleting an account", () => {
  function deleteButtonFor(u: MockUser) {
    return screen.queryByRole("button", { name: new RegExp(`delete ${u.full_name}`, "i") });
  }

  it("is not offered to a plain admin", async () => {
    mockUsers = [APPROVED, PENDING];
    renderPage("admin");
    await waitFor(() => expect(within(pendingCard()).getByText("Dr Baru")).toBeTruthy());
    expect(deleteButtonFor(PENDING)).toBeNull();
  });

  it("is offered to super_admin on a pending signup", async () => {
    mockUsers = [APPROVED, PENDING];
    renderPage("super_admin");
    await waitFor(() => expect(within(pendingCard()).getByText("Dr Baru")).toBeTruthy());
    expect(deleteButtonFor(PENDING)).toBeTruthy();
  });

  it("holds the delete until the email is typed back, then posts delete_user", async () => {
    mockUsers = [APPROVED, PENDING];
    renderPage("super_admin");
    await waitFor(() => expect(within(pendingCard()).getByText("Dr Baru")).toBeTruthy());

    fireEvent.click(deleteButtonFor(PENDING)!);
    await screen.findByText("Delete this account?");

    const confirmButton = screen.getByRole("button", { name: /delete account/i });
    expect(confirmButton).toBeDisabled();

    // A near miss stays disabled — the guard is the exact address.
    fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: "newmo@kk.m" } });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: PENDING.email } });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastFetchBody();
    expect(body.action).toBe("delete_user");
    expect(body.user_id).toBe(PENDING.user_id);
  });

  it("shows the server's reason in the dialog when records hold the account down", async () => {
    const blocked = "This account authored records that must keep their author: 12 dispensing requests.";
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ error: blocked }) })
    ));
    mockUsers = [APPROVED, PENDING];
    renderPage("super_admin");
    await waitFor(() => expect(within(pendingCard()).getByText("Dr Baru")).toBeTruthy());

    fireEvent.click(deleteButtonFor(PENDING)!);
    await screen.findByText("Delete this account?");
    fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: PENDING.email } });
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));

    expect(await screen.findByText(blocked)).toBeTruthy();
    // Still open, so the reason can be read and acted on.
    expect(screen.getByText("Delete this account?")).toBeTruthy();
  });

  it("offers delete in the row menu, but never for yourself or another super_admin", async () => {
    const user = userEvent.setup();
    mockUsers = [APPROVED, OTHER_MO, SUPER];
    renderPage("super_admin");
    await waitFor(() => expect(within(usersCard()).getByText(/NISHANTHINI/)).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /actions for NISHANTHINI/i }));
    expect(await screen.findByRole("menuitem", { name: /delete user/i })).toBeTruthy();
    await user.keyboard("{Escape}");

    // APPROVED is the signed-in user in renderPage().
    await user.click(screen.getByRole("button", { name: /actions for Dr Admin/i }));
    await screen.findByText(/cannot change your own role/i);
    expect(screen.queryByRole("menuitem", { name: /delete user/i })).toBeNull();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: /actions for Subra/i }));
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    expect(screen.queryByRole("menuitem", { name: /delete user/i })).toBeNull();
  });
});
