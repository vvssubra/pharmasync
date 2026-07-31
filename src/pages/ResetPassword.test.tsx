import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ResetPassword from "./ResetPassword";

let authCallback: (event: string) => void = () => {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((cb: (event: string) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      updateUser: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage(hash = "") {
  window.location.hash = hash;
  return render(
    <MemoryRouter>
      <ResetPassword />
    </MemoryRouter>
  );
}

describe("ResetPassword readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "";
  });

  it("shows form on PASSWORD_RECOVERY event", async () => {
    renderPage();
    act(() => authCallback("PASSWORD_RECOVERY"));
    expect(await screen.findByLabelText(/new password/i)).toBeInTheDocument();
  });

  it("shows form on SIGNED_IN when URL hash is an invite", async () => {
    renderPage("#access_token=abc&type=invite");
    act(() => authCallback("SIGNED_IN"));
    expect(await screen.findByLabelText(/new password/i)).toBeInTheDocument();
  });

  it("stays on verifying state on SIGNED_IN without invite hash", () => {
    renderPage();
    act(() => authCallback("SIGNED_IN"));
    expect(screen.getByText(/verifying reset link/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });
});
