import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SpecialistDashboard from "./SpecialistDashboard";

// One fluent Supabase-like chain for per-test overrides. Filter methods keep
// chaining; a method listed in `terminals` resolves with those rows instead;
// awaiting the chain itself resolves with `data`. Cast at the call site because
// the real query-builder type is far richer than tests need.
type ChainResult = { data: unknown[]; error: null };
function chainOf(
  data: unknown[],
  terminals: Partial<Record<"order" | "lt" | "in", unknown[]>> = {},
) {
  const resolved = (rows: unknown[]) => Promise.resolve({ data: rows, error: null });
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    update: () => chain,
    in: () => ("in" in terminals ? resolved(terminals.in!) : chain),
    order: () => ("order" in terminals ? resolved(terminals.order!) : chain),
    lt: () => ("lt" in terminals ? resolved(terminals.lt!) : chain),
    then: (onFulfilled: (value: ChainResult) => unknown) => resolved(data).then(onFulfilled),
  };
  return chain;
}
type FromReturn = ReturnType<(typeof import("@/integrations/supabase/client"))["supabase"]["from"]>;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          in: vi.fn(() => Promise.resolve({ data: [], error: null })),
          eq: vi.fn(() => ({
            gte: vi.fn(() => ({
              lt: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        })),
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
    // Quota usage now comes from the get_drug_quota_usage RPC (see
    // src/hooks/useDrugQuotaUsage.ts), not a hand-rolled drug_quotas query.
    // Individual tests below override `.from` via mockImplementation but
    // leave this in place, so it stays the quota source for all of them.
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ role: "fms", user: { id: "u1" }, profile: null, loading: false })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={makeQC()}>
        <SpecialistDashboard />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("SpecialistDashboard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders 'NAG Check' column header in antibiotic forms table", async () => {
    const user = userEvent.setup();
    renderDashboard();
    // Click the Antibiotik tab to reveal that table
    await user.click(screen.getByRole("tab", { name: /antibiotic form/i }));
    expect(screen.getByText(/NAG Check/i)).toBeInTheDocument();
  });

  describe("Controlled Drug sub-tabs", () => {
    it("renders Regular and Pesara sub-tabs inside the Controlled Drug tab", async () => {
      renderDashboard();
      // Controlled Drug tab is the default active tab
      expect(screen.getByRole("tab", { name: /Regular/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Pesara/i })).toBeInTheDocument();
    });

    it("Regular tab is the default active sub-tab and shows empty state", async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText("No pending requests")).toBeInTheDocument();
      });
      expect(screen.getByText(/No controlled drug requests are awaiting specialist approval/i)).toBeInTheDocument();
    });

    it("Pesara tab shows correct empty state message when clicked", async () => {
      const user = userEvent.setup();
      renderDashboard();
      await user.click(screen.getByRole("tab", { name: /Pesara/i }));
      await waitFor(() => {
        expect(screen.getByText("No pending Pesara requests")).toBeInTheDocument();
      });
    });

    it("Regular tab shows quota badge for a regular request", async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const mockRequest = {
        id: "req-1",
        status: "pending_specialist",
        is_pesara: false,
        borrowed_from_clinic_id: null,
        patient_name: "Ali bin Abu",
        no_ic: "800101011234",
        drug_id: "drug-1",
        quantity: 30,
        prescriber_name: "Dr. Siti",
        created_at: new Date().toISOString(),
        specialist_action_at: null,
        specialist_notes: null,
        drugs: { drug_name: "Morphine", unit_pengukuran: "tablet" },
      };

      // Override mock for this test to return a request
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === "drug_quotas") {
          return chainOf([{ drug_id: "drug-1", quota_limit: 60 }]) as unknown as FromReturn;
        }
        if (table === "dispensing_requests") {
          return chainOf([], {
            order: [mockRequest],
            lt: [{ drug_id: "drug-1", no_ic: "800101011234" }],
          }) as unknown as FromReturn;
        }
        return chainOf([], { in: [], order: [], lt: [] }) as unknown as FromReturn;
      });

      renderDashboard();

      // Drug name should appear in the regular tab
      await waitFor(() => {
        expect(screen.getByText("Morphine")).toBeInTheDocument();
      });
    });

    it("Pesara tab shows Unlimited badge for a Pesara request", async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const mockPesaraRequest = {
        id: "req-2",
        status: "pending_specialist",
        is_pesara: true,
        borrowed_from_clinic_id: null,
        patient_name: "Minah binti Kassim",
        no_ic: "450202021234",
        drug_id: "drug-1",
        quantity: 60,
        prescriber_name: "Dr. Rahman",
        created_at: new Date().toISOString(),
        specialist_action_at: null,
        specialist_notes: null,
        drugs: { drug_name: "Morphine", unit_pengukuran: "tablet" },
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === "drug_quotas") {
          return chainOf([]) as unknown as FromReturn;
        }
        if (table === "dispensing_requests") {
          return chainOf([], { order: [mockPesaraRequest], lt: [] }) as unknown as FromReturn;
        }
        return chainOf([], { in: [], order: [], lt: [] }) as unknown as FromReturn;
      });

      const user = userEvent.setup();
      renderDashboard();

      // Switch to Pesara tab
      await user.click(screen.getByRole("tab", { name: /Pesara/i }));

      // Pesara request should show and have Unlimited badge
      await waitFor(() => {
        expect(screen.getByText("Unlimited")).toBeInTheDocument();
      });
    });
  });

  // Borrowing quota from a neighbouring clinic predates the national pool. Now
  // that every clinic draws from ONE shared allocation
  // (20260819000300_national_quota_pool.sql) there is nothing to borrow, so
  // requiring a borrow clinic before Confirm simply blocked approvals that the
  // specialist is entitled to make.
  it("lets the specialist confirm an approval with the national quota exhausted and no clinic picked", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const mockRequest = {
      id: "req-3",
      status: "pending_specialist",
      is_pesara: false,
      borrowed_from_clinic_id: null,
      patient_name: "Ali bin Abu",
      no_ic: "800101011234",
      drug_id: "drug-1",
      quantity: 30,
      prescriber_name: "Dr. Siti",
      created_at: new Date().toISOString(),
      specialist_action_at: null,
      specialist_notes: null,
      drugs: { drug_name: "Morphine", unit_pengukuran: "tablet" },
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "dispensing_requests") {
        return chainOf([], { order: [mockRequest], lt: [] }) as unknown as FromReturn;
      }
      return chainOf([], { in: [], order: [], lt: [] }) as unknown as FromReturn;
    });
    // National pool fully consumed for this drug.
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{
        clinic_id: "hq", drug_id: "drug-1", year: new Date().getFullYear(),
        quota_limit: 1, alert_threshold_pct: 20, used: 1, remaining: 0,
      }],
      error: null,
    } as never);

    const user = userEvent.setup();
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Morphine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await screen.findByText(/national quota exhausted/i);
    expect(screen.getByRole("button", { name: /confirm approval/i })).toBeEnabled();
  });

  it("reveals the Regular vs Pesara breakdown when hovering the Pending (Drug) stat card", async () => {
    renderDashboard();
    const card = await screen.findByTestId("stat-card-Pending (Drug)");
    fireEvent.mouseEnter(card);
    // Scoped to the card: "Regular"/"Pesara" also appear as Controlled Drug
    // sub-tab labels elsewhere on the page (Radix renders the TabsList
    // regardless of which tab is active), so an unscoped screen.getByText
    // would match multiple elements.
    expect(within(card).getByText("Regular")).toBeInTheDocument();
    expect(within(card).getByText("Pesara")).toBeInTheDocument();
  });
});
