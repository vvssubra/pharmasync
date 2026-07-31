import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MoDashboard from "./MoDashboard";

const resolved = (data: unknown[] = []) => Promise.resolve({ data, error: null });

const mockChain = () => {
  const chain: Record<string, unknown> = {};
  const terminal = () => resolved();
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => terminal());
  chain.gte = vi.fn(() => chain);
  chain.lt = vi.fn(() => terminal());
  // make chain itself a thenable so Promise.all works. The chain is a plain
  // record, not a real Promise, so assign the callbacks as ordinary keys —
  // casting to Promise<unknown> would demand the full generic then() signature.
  chain.then = (res: (v: unknown) => unknown) => resolved().then(res);
  chain.catch = () => resolved();
  return chain;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => mockChain()),
    // Quota usage now comes from the get_drug_quota_usage RPC (see
    // src/hooks/useDrugQuotaUsage.ts), not a hand-rolled drug_quotas query.
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    user: { id: "mo-1" },
    role: "mo",
    profile: { full_name: "Dr. Azman", clinic_id: "clinic-1", clinic_name: "KK Kempas" },
    loading: false,
  })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe("MoDashboard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders Quota Remaining column header", async () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={makeQC()}>
          <MoDashboard />
        </QueryClientProvider>
      </MemoryRouter>
    );
    // Wait for async queries to resolve and table to render
    const header = await screen.findByText(/Quota Remaining/i);
    expect(header).toBeInTheDocument();
  });

  // The antibiotic_forms table serves two queries on this page: the
  // rejected-forms banner (second .eq is ("status","rejected"), ends at
  // .order) and the recent-submissions list (single .eq, ends at .limit).
  // This mock routes on that difference.
  function mockAntibioticForms(rejectedRows: unknown[], recentRows: unknown[]) {
    const chain: Record<string, unknown> = {};
    let statusFiltered = false;
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string) => {
      if (col === "status") statusFiltered = true;
      return chain;
    });
    chain.order = vi.fn(() => {
      if (statusFiltered) return resolved(rejectedRows);
      const tail: Record<string, unknown> = {
        limit: vi.fn(() => resolved(recentRows)),
      };
      tail.then = (res: (v: unknown) => unknown) => resolved(rejectedRows).then(res);
      return tail;
    });
    return chain;
  }

  it("lists antibiotic forms returned by the FMS with the rejection reason", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "antibiotic_forms") {
        return mockAntibioticForms(
          [
            {
              id: "form-9",
              patient_name: "Aminah binti Yusof",
              diagnosis: "Community Acquired Pneumonia",
              specialist_notes: "Dose does not match weight — recalculate",
              specialist_action_at: new Date().toISOString(),
            },
          ],
          [],
        );
      }
      return mockChain();
    }) as never);

    render(
      <MemoryRouter>
        <QueryClientProvider client={makeQC()}>
          <MoDashboard />
        </QueryClientProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Returned for correction \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("Aminah binti Yusof")).toBeInTheDocument();
    expect(screen.getByText(/Dose does not match weight/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Correct & resubmit/i })).toBeInTheDocument();
  });

  it("shows the MO's submitted antibiotic forms in the recent list", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "antibiotic_forms") {
        return mockAntibioticForms(
          [],
          [
            {
              id: "form-1",
              created_at: new Date().toISOString(),
              patient_name: "Ali bin Abu",
              diagnosis: "UTI",
              status: "pending_specialist",
            },
          ],
        );
      }
      return mockChain();
    }) as never);

    render(
      <MemoryRouter>
        <QueryClientProvider client={makeQC()}>
          <MoDashboard />
        </QueryClientProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText("Ali bin Abu")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Antibiotic Form" })).toBeInTheDocument();
    expect(screen.getByText(/Awaiting FMS Review/i)).toBeInTheDocument();
  });
});
