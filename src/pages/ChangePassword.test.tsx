import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ChangePassword from "./ChangePassword";

const navigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { supabase } = await import("@/integrations/supabase/client");
const { useAuth } = await import("@/contexts/AuthContext");

function renderPage(mustChangePassword = false) {
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id: "u1", email: "dr@example.com" },
    mustChangePassword,
  });
  return render(
    <MemoryRouter>
      <ChangePassword />
    </MemoryRouter>
  );
}

async function fillAndSubmit(current: string, next: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/current password/i), current);
  await user.type(screen.getByLabelText(/^new password$/i), next);
  await user.type(screen.getByLabelText(/confirm new password/i), confirm);
  await user.click(screen.getByRole("button", { name: /update password/i }));
}

describe("ChangePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabase.auth.signInWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });
    (supabase.auth.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });
  });

  it("tells a forced user why they are here", () => {
    renderPage(true);
    expect(screen.getByText(/set by an administrator/i)).toBeInTheDocument();
  });

  it("rejects mismatched passwords without calling supabase", async () => {
    renderPage();
    await fillAndSubmit("P@ssword1234", "newpassword", "different");
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 6 characters", async () => {
    renderPage();
    await fillAndSubmit("P@ssword1234", "abc", "abc");
    expect(await screen.findByText(/at least 6 characters/i)).toBeInTheDocument();
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects reusing the current password", async () => {
    renderPage();
    await fillAndSubmit("P@ssword1234", "P@ssword1234", "P@ssword1234");
    expect(await screen.findByText(/must be different/i)).toBeInTheDocument();
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  // updateUser() does not verify the old password on this deployment, so the
  // re-auth is the only thing standing between an open tab and a takeover.
  it("stops when the current password is wrong", async () => {
    (supabase.auth.signInWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    renderPage();
    await fillAndSubmit("wrong-password", "newpassword", "newpassword");
    expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument();
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("clears must_change_password in the same call that sets the password", async () => {
    renderPage(true);
    await fillAndSubmit("P@ssword1234", "newpassword", "newpassword");
    await waitFor(() =>
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({
        password: "newpassword",
        data: { must_change_password: false },
      })
    );
  });

  // Unlike ResetPassword, the user is mid-session: send them on, do not sign out.
  it("navigates to the dashboard on success", async () => {
    renderPage(true);
    await fillAndSubmit("P@ssword1234", "newpassword", "newpassword");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("surfaces an update failure instead of navigating", async () => {
    (supabase.auth.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: { message: "Password is too weak" },
    });
    renderPage();
    await fillAndSubmit("P@ssword1234", "newpassword", "newpassword");
    expect(await screen.findByText(/too weak/i)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
