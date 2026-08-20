import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Index from "./Index";

// Drugs chosen so getStatus() (Index.tsx) yields one of each status we assert:
// baki < min -> CRITICAL, baki < reorder -> LOW, baki > max -> EXCESS.
const DRUGS = [
  { id: "d-critical", drug_name: "Amoxicillin 250mg", unit_pengukuran: "tablet", stok_min: 100, stok_reorder: 150, stok_max: 500, perlu_kelulusan_pakar: false },
  { id: "d-low",      drug_name: "Paracetamol 500mg", unit_pengukuran: "tablet", stok_min: 50,  stok_reorder: 200, stok_max: 800, perlu_kelulusan_pakar: false },
  { id: "d-excess",   drug_name: "Metformin 500mg",   unit_pengukuran: "tablet", stok_min: 20,  stok_reorder: 40,  stok_max: 100, perlu_kelulusan_pakar: false },
];

const TRANSACTIONS = [
  // baki 10 < min 100 -> CRITICAL
  { drug_id: "d-critical", jenis: "terimaan", kuantiti: 10,  tarikh: "2026-07-01", created_at: "2026-07-01T00:00:00Z" },
  // baki 120: >= min 50, < reorder 200 -> LOW
  { drug_id: "d-low",      jenis: "terimaan", kuantiti: 120, tarikh: "2026-07-02", created_at: "2026-07-02T00:00:00Z" },
  // baki 400 > max 100 -> EXCESS
  { drug_id: "d-excess",   jenis: "terimaan", kuantiti: 400, tarikh: "2026-07-03", created_at: "2026-07-03T00:00:00Z" },
];

// Rows keyed by the table each query reads. Index.tsx awaits its builders at
// different depths — .eq() terminally for drugs, .select() terminally for the
// transactions ledger, .limit() for the two recent-activity lists — so the mock
// builder has to be awaitable *and* chainable at every level. Returning a plain
// object from .eq() (as this mock used to) makes `await` yield the builder
// itself, so `data` is undefined and the dashboard renders zero rows.
const ROWS: Record<string, unknown[]> = {
  drugs: DRUGS,
  transactions: TRANSACTIONS,
  dispensing_requests: [],
  antibiotic_forms: [],
};

function builder(data: unknown[]) {
  const promise = Promise.resolve({ data, error: null, count: data.length });
  return Object.assign(promise, {
    select: () => builder(data),
    eq: () => builder(data),
    is: () => builder(data),
    order: () => builder(data),
    limit: () => builder(data),
  });
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => builder(ROWS[table] ?? [])),
    // useDrugQuotaUsage calls this; without it the hook throws and the whole
    // dashboard suspends on an error boundary.
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ role: "admin", user: null, profile: null, loading: false })),
}));

const { useAuth } = await import("@/contexts/AuthContext");


function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderIndex() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <QueryClientProvider client={makeQueryClient()}>
        <Index />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("Index dashboard English text", () => {
  beforeEach(() => vi.clearAllMocks());

  // These assertions await: React Query resolves on a microtask, so the badges
  // are not in the DOM on the first synchronous pass.
  it("renders status badge 'CRITICAL'", async () => {
    renderIndex();
    await waitFor(() => expect(screen.getAllByText("CRITICAL").length).toBeGreaterThan(0));
  });

  it("renders status badge 'LOW'", async () => {
    renderIndex();
    await waitFor(() => expect(screen.getAllByText("LOW").length).toBeGreaterThan(0));
  });

  it("renders status badge 'EXCESS'", async () => {
    renderIndex();
    await waitFor(() => expect(screen.getAllByText("EXCESS").length).toBeGreaterThan(0));
  });

  it("renders column header 'Drug Name'", async () => {
    renderIndex();
    await waitFor(() =>
      expect(screen.getByRole("columnheader", { name: "Drug Name" })).toBeInTheDocument()
    );
  });

  it("renders column header 'Actions'", async () => {
    renderIndex();
    await waitFor(() =>
      expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument()
    );
  });

  it("hides the Recent Activity 'View All' link for pharmacist (/terimaan is no longer reachable for that role), keeps the Recent Dispensing one (/laporan still is)", async () => {
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({ role: "pharmacist", user: null, profile: null, loading: false });
    renderIndex();
    await waitFor(() => expect(screen.getAllByText("CRITICAL").length).toBeGreaterThan(0));
    // Only one "View All" link should remain — Recent Dispensing's, to /laporan.
    expect(screen.getAllByText("View All")).toHaveLength(1);
  });
});

// The Balance column shows remaining annual quota for a controlled drug rather
// than shelf stock, and since 20260819000300_national_quota_pool.sql that quota
// is one pool shared by every clinic. Unlabelled, the number reads as this
// clinic's own position.
describe("Index dashboard — controlled drugs show a NATIONAL balance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks a quota-based balance as national and says so above the table", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    ROWS.drugs = [
      ...DRUGS,
      { id: "d-controlled", drug_name: "Insulin Novomix", unit_pengukuran: "vial", stok_min: 0, stok_reorder: 0, stok_max: 0, perlu_kelulusan_pakar: true },
    ];
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{
        clinic_id: "hq", drug_id: "d-controlled", year: new Date().getFullYear(),
        quota_limit: 100, alert_threshold_pct: 20, used: 71, remaining: 29,
      }],
      error: null,
    } as never);

    renderIndex();

    await waitFor(() => expect(screen.getByText("Insulin Novomix")).toBeInTheDocument());
    expect(screen.getByText("national quota left")).toBeInTheDocument();
    expect(
      screen.getByText(/Controlled drugs show remaining national quota \(shared across all clinics\)/)
    ).toBeInTheDocument();

    ROWS.drugs = DRUGS;
  });
});
