import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import FmsDashboard from "./FmsDashboard";

// Failure and race behaviour of the dashboard. The happy-path sections live in
// FmsDashboard.test.tsx; this file drives the mock with per-test state.

const state = vi.hoisted(() => ({
  ledgerError: false,
  requestsError: false,
  updateRows: [] as unknown[],
  lastUpdate: null as null | { eq: ReturnType<typeof vi.fn> },
}));

const pendingRequest = {
  id: "req-1",
  patient_name: "Ahmad Faiz",
  no_ic: "900101011234",
  is_pesara: false,
  prescriber_name: "Dr Lim",
  quantity: 2,
  submitted_by: "mo-1",
  created_at: new Date().toISOString(),
  drugs: { drug_name: "Insulin Glargine", unit_pengukuran: "vial" },
};

vi.mock("@/integrations/supabase/client", () => {
  // Every builder method returns the same thenable, so any select/eq/order
  // chain the page builds resolves to the result handed in.
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(result).then(res, rej),
    };
    for (const m of ["select", "eq", "gte", "lt", "order", "in"]) c[m] = vi.fn(() => c);
    return c as { eq: ReturnType<typeof vi.fn> } & Record<string, unknown>;
  };
  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "drugs") {
          return chain({
            data: [{ id: "d1", drug_name: "Paracetamol", unit_pengukuran: "tab", perlu_kelulusan_pakar: false }],
            error: null,
          });
        }
        if (table === "transactions") {
          return chain(state.ledgerError
            ? { data: null, error: { message: "ledger down" } }
            : { data: [], error: null });
        }
        if (table === "dispensing_requests") {
          const base = chain({ data: [], error: null });
          return {
            select: vi.fn((cols: string) =>
              cols.startsWith("*")
                ? chain(state.requestsError
                    ? { data: null, error: { message: "requests down" } }
                    : { data: [pendingRequest], error: null })
                : base),
            update: vi.fn(() => {
              const u = chain({ data: state.updateRows, error: null });
              state.lastUpdate = u;
              return u;
            }),
          };
        }
        return chain({ data: [], error: null });
      }),
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ role: "fms", profile: null, user: { id: "fms-1" }, loading: false })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter><QueryClientProvider client={qc}><FmsDashboard /></QueryClientProvider></MemoryRouter>,
  );
}

describe("FmsDashboard failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.ledgerError = false;
    state.requestsError = false;
    state.updateRows = [];
    state.lastUpdate = null;
  });

  it("shows an error, not every drug as critical, when the ledger fetch fails", async () => {
    state.ledgerError = true;
    renderPage();

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some(a => /Couldn't load stock levels/i.test(a.textContent ?? ""))).toBe(true);
    // The drug must not be rendered with a fabricated zero stock / critical status.
    expect(screen.queryByText("Paracetamol")).not.toBeInTheDocument();
    expect(screen.getByText("Critical Stock").previousElementSibling).toHaveTextContent("—");
  });

  it("does not claim 'No pending drug requests' when that query failed", async () => {
    state.requestsError = true;
    renderPage();

    expect(await screen.findByText(/Couldn't load pending drug requests/i)).toBeInTheDocument();
    expect(screen.queryByText("No pending drug requests")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pending approvals unavailable")).toBeInTheDocument();
  });

  it("guards the approve write on status and reports a request someone else already actioned", async () => {
    state.updateRows = []; // zero rows touched: another reviewer got there first
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Approve" }));
    await user.click(await screen.findByRole("button", { name: "Confirm Approval" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already actioned/i)));
    expect(toast.success).not.toHaveBeenCalled();
    expect(state.lastUpdate?.eq).toHaveBeenCalledWith("status", "pending_specialist");
    await waitFor(() => expect(screen.queryByText("Approve Drug Request")).not.toBeInTheDocument());
  });

  it("reports success only when the guarded write touched a row", async () => {
    state.updateRows = [{ id: "req-1" }];
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Approve" }));
    await user.click(await screen.findByRole("button", { name: "Confirm Approval" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });
});
