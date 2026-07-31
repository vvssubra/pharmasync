// src/contexts/AuthContext.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";

// A minimal signed-JWT lookalike: only the payload matters to the provider,
// which base64-decodes segment [1] to read the amr claim.
function fakeToken(payload: Record<string, unknown>) {
  return `header.${btoa(JSON.stringify(payload))}.sig`;
}

function fakeSession(opts: {
  email: string;
  amr?: { method: string }[];
  provider?: string;
}) {
  const payload = opts.amr !== undefined ? { amr: opts.amr } : {};
  return {
    access_token: fakeToken(payload),
    user: {
      id: "00000000-0000-0000-0000-00000000abcd",
      email: opts.email,
      app_metadata: opts.provider ? { provider: opts.provider } : {},
    },
  };
}

const signOut = vi.fn();
let initialSession: unknown = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({ data: { session: initialSession } }),
      ),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signOut: (...args: unknown[]) => signOut(...args),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

function Probe() {
  const { user, authError } = useAuth();
  return (
    <div>
      <span data-testid="error">{authError ?? "none"}</span>
      <span data-testid="user">{user?.email ?? "none"}</span>
    </div>
  );
}

function renderWithSession(session: unknown) {
  initialSession = session;
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("AuthContext Google-domain gate", () => {
  beforeEach(() => {
    signOut.mockClear();
  });

  it("blocks an OAuth session with a non-moh email", async () => {
    renderWithSession(
      fakeSession({ email: "someone@gmail.com", amr: [{ method: "oauth" }], provider: "google" }),
    );
    expect(await screen.findByText(/only @moh\.gov\.my/i)).toBeInTheDocument();
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(signOut).toHaveBeenCalled();
  });

  it("allows a password login on a google-created account (non-moh email)", async () => {
    renderWithSession(
      fakeSession({ email: "someone@gmail.com", amr: [{ method: "password" }], provider: "google" }),
    );
    expect(await screen.findByText("someone@gmail.com")).toBeInTheDocument();
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("allows an OAuth session with a moh.gov.my email", async () => {
    renderWithSession(
      fakeSession({ email: "doctor@moh.gov.my", amr: [{ method: "oauth" }], provider: "google" }),
    );
    expect(await screen.findByText("doctor@moh.gov.my")).toBeInTheDocument();
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("falls back to the account provider when the token has no amr claim", async () => {
    renderWithSession(
      fakeSession({ email: "someone@gmail.com", provider: "google" }),
    );
    expect(await screen.findByText(/only @moh\.gov\.my/i)).toBeInTheDocument();
    expect(signOut).toHaveBeenCalled();
  });
});
