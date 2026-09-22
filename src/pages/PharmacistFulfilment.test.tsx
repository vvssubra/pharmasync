import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PharmacistFulfilment from "./PharmacistFulfilment";

function makeForm(id: string, patient_name: string) {
  return {
    id,
    patient_name,
    patient_ic: "900101011234",
    diagnosis: "Skin and Soft Tissue Infection",
    prescription_unit: "OPD",
    antibiotic_regimen: "c. cloxacillin 500mg qid",
    assigned_fms: "Dr Amelia",
    status: "approved",
    submitted_by: "mo-1",
    acknowledged_by: null,
    acknowledged_at: null,
    created_at: "2026-08-26T10:00:00Z",
    checklist_data: {},
  };
}

const PENDING = [
  makeForm("form-1", "FARZANA IZZATI BINTI ROSDI"),
  makeForm("form-2", "MUHAMMAD AYDEEN HARIS"),
  makeForm("form-3", "SITI BINTI OMAR"),
];

// Records what the bulk update was actually called with, so the test can assert
// the `acknowledged_at is null` guard is present (see the mutation's comment —
// without it the lock trigger aborts the whole batch).
const abUpdateSpy = vi.fn();
let abUpdateResult: { data: unknown[]; error: null } = { data: [], error: null };
let abFormsData: unknown[] = [];
let requestsData: unknown[] = [];
let txData: unknown[] = [];

function thenable(resolver: () => { data: unknown[]; error: null }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "not", "order", "gte", "lte", "maybeSingle", "single"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve(resolver()).then(onFulfilled);
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "antibiotic_forms") {
        return {
          select: () => thenable(() => ({ data: abFormsData, error: null })),
          update: (patch: unknown) => {
            const filters: Record<string, unknown> = {};
            const chain: Record<string, unknown> = {
              in: (col: string, v: unknown) => { filters[`in:${col}`] = v; return chain; },
              is: (col: string, v: unknown) => { filters[`is:${col}`] = v; return chain; },
              eq: (col: string, v: unknown) => { filters[`eq:${col}`] = v; return chain; },
              select: () => {
                abUpdateSpy({ patch, filters });
                return Promise.resolve(abUpdateResult);
              },
              then: (onFulfilled: (v: unknown) => unknown) => {
                abUpdateSpy({ patch, filters });
                return Promise.resolve(abUpdateResult).then(onFulfilled);
              },
            };
            return chain;
          },
        };
      }
      if (table === "dispensing_requests") return thenable(() => ({ data: requestsData, error: null }));
      if (table === "transactions") return thenable(() => ({ data: txData, error: null }));
      // Every other table this page touches (profiles, patient_registry,
      // patient_drug_history) stays empty.
      return thenable(() => ({ data: [], error: null }));
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "pharm-1" },
    profile: { full_name: "Pharmacist Aiman", clinic_id: "clinic-1" },
    role: "pharmacist",
    loading: false,
  }),
}));

vi.mock("@/hooks/useClinicDrugSettings", () => ({
  useClinicDrugSettings: () => ({ byDrugId: new Map() }),
  resolveDrugSettings: () => ({ stok_min: 0, stok_max: 0, stok_reorder: 0, is_blocked: false }),
}));

// Held at module scope so a test can force the antibiotic-forms refetch that
// the page normally does on its 15s interval.
let qc: QueryClient;

function renderPage() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <PharmacistFulfilment />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

async function openAntibioticTab() {
  // delay: null — userEvent's default inter-event delay makes these four tests
  // slow enough to trip the 5s timeout when the whole suite runs in parallel.
  const user = userEvent.setup({ delay: null });
  renderPage();
  await user.click(await screen.findByRole("tab", { name: /Antibiotic/i }));
  return user;
}

describe("PharmacistFulfilment — bulk acknowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestsData = [];
    txData = [];
    abFormsData = PENDING;
    abUpdateResult = { data: PENDING.map(f => ({ id: f.id })), error: null };
  });

  it("acknowledges every selected form in one update, guarded by acknowledged_at is null", async () => {
    const user = await openAntibioticTab();
    await waitFor(() => expect(screen.getByText("FARZANA IZZATI BINTI ROSDI")).toBeInTheDocument());

    await user.click(screen.getByRole("checkbox", { name: /Select all forms awaiting confirmation/i }));
    expect(screen.getByText("3 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Acknowledge Selected/i }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(abUpdateSpy).toHaveBeenCalledTimes(1));
    const { patch, filters } = abUpdateSpy.mock.calls[0][0];
    expect(filters["in:id"]).toEqual(["form-1", "form-2", "form-3"]);
    // The guard that keeps one already-acknowledged row from aborting the batch
    // via trg_zz_enforce_antibiotic_form_lock.
    expect(filters["is:acknowledged_at"]).toBeNull();
    expect(patch).toMatchObject({ acknowledged_by: "pharm-1" });
    expect(patch.acknowledged_at).toEqual(expect.any(String));
  });

  it("submits only the individually ticked forms", async () => {
    const user = await openAntibioticTab();
    await waitFor(() => expect(screen.getByText("MUHAMMAD AYDEEN HARIS")).toBeInTheDocument());

    await user.click(screen.getByRole("checkbox", { name: /Select form for MUHAMMAD AYDEEN HARIS/i }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Acknowledge Selected/i }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(abUpdateSpy).toHaveBeenCalledTimes(1));
    expect(abUpdateSpy.mock.calls[0][0].filters["in:id"]).toEqual(["form-2"]);
  });

  it("disables the bulk button until something is selected", async () => {
    await openAntibioticTab();
    await waitFor(() => expect(screen.getByText("FARZANA IZZATI BINTI ROSDI")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Acknowledge Selected/i })).toBeDisabled();
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });

  it("never submits an id that has dropped off the pending list since selection", async () => {
    const user = await openAntibioticTab();
    await waitFor(() => expect(screen.getByText("SITI BINTI OMAR")).toBeInTheDocument());
    await user.click(screen.getByRole("checkbox", { name: /Select all forms awaiting confirmation/i }));
    expect(screen.getByText("3 selected")).toBeInTheDocument();

    // Another pharmacist acknowledges form-3; the page's 15s refetch drops it.
    abFormsData = PENDING.slice(0, 2);
    await qc.invalidateQueries({ queryKey: ["fulfilment-antibiotic-forms"] });
    await waitFor(() => expect(screen.queryByText("SITI BINTI OMAR")).not.toBeInTheDocument());
    // The stale form-3 id is dropped from the count, not just from the list.
    await waitFor(() => expect(screen.getByText("2 selected")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Acknowledge Selected/i }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(abUpdateSpy).toHaveBeenCalledTimes(1));
    expect(abUpdateSpy.mock.calls[0][0].filters["in:id"]).toEqual(["form-1", "form-2"]);
  });
});

function makeRequest(id: string, patient_name: string, drug_id: string, quantity: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    patient_name,
    no_ic: "900101011234",
    drug_id,
    quantity,
    prescriber_name: "Dr Hana",
    status: "pending_pharmacy",
    is_pesara: false,
    deferred_date: null,
    fulfilled_at: null,
    created_at: "2026-08-26T10:00:00Z",
    drugs: { id: drug_id, drug_name: `Drug ${drug_id}`, unit_pengukuran: "tab", perlu_kelulusan_pakar: false },
    ...extra,
  };
}

describe("PharmacistFulfilment — KPI row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const now = new Date().toISOString();
    // Stock: A=5, B=10, C=0 (no ledger rows at all).
    txData = [
      { drug_id: "A", jenis: "terimaan", kuantiti: 5, tarikh: "2026-08-01", created_at: "2026-08-01T00:00:00Z" },
      { drug_id: "B", jenis: "terimaan", kuantiti: 10, tarikh: "2026-08-01", created_at: "2026-08-01T00:00:00Z" },
    ];
    requestsData = [
      makeRequest("r1", "AISHA BINTI ALI", "A", 20),     // stock 5 < qty 20 — blocked
      makeRequest("r2", "BALA A/L RAJ", "B", 5),          // stock 10 >= qty 5 — ok
      makeRequest("r3", "CHONG WEI LING", "C", 1),        // no stock — blocked
      makeRequest("r4", "DANIEL LEE", "B", 2, { status: "fulfilled", fulfilled_at: now }),
    ];
    abFormsData = [
      makeForm("form-1", "FARZANA IZZATI BINTI ROSDI"),
      { ...makeForm("form-2", "MUHAMMAD AYDEEN HARIS"), acknowledged_by: "pharm-2", acknowledged_at: now },
    ];
    abUpdateResult = { data: [], error: null };
  });

  it("derives the four counts from the queue, the ledger and today's completions", async () => {
    renderPage();
    // The ledger query starts only once the queue is known, so wait for the
    // stock-derived count rather than the first painted patient name.
    await waitFor(() => expect(screen.getByTestId("stat-card-Stock Blocked")).toHaveTextContent("2"));

    expect(screen.getByTestId("stat-card-Awaiting Confirmation")).toHaveTextContent("3");
    expect(screen.getByTestId("stat-card-Antibiotic Forms (Restricted)")).toHaveTextContent("1");
    // 1 fulfilled request + 1 acknowledged form.
    expect(screen.getByTestId("stat-card-Completed Today")).toHaveTextContent("2");
    // Stock Blocked = 2: insufficient (5 < 20) and out-of-stock both count; a
    // coverable request does not.
  });

  it("disables Complete only for requests the ledger cannot cover", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("stat-card-Stock Blocked")).toHaveTextContent("2"));

    const complete = screen.getAllByRole("button", { name: /^Complete$/ });
    expect(complete).toHaveLength(3);
    // Queue order is newest-first as returned by the mock: r1, r2, r3.
    expect(complete[0]).toBeDisabled();
    expect(complete[1]).toBeEnabled();
    expect(complete[2]).toBeDisabled();
    expect(screen.getByText(/Insufficient stock/)).toBeInTheDocument();
    expect(screen.getByText(/Out of Stock/)).toBeInTheDocument();
  });

  it("filters the queue to blocked requests when the Stock Blocked card is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("stat-card-Stock Blocked")).toHaveTextContent("2"));

    await user.click(screen.getByTestId("stat-card-Stock Blocked"));
    expect(screen.queryByText("BALA A/L RAJ")).not.toBeInTheDocument();
    expect(screen.getByText("AISHA BINTI ALI")).toBeInTheDocument();
    expect(screen.getByText("CHONG WEI LING")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("BALA A/L RAJ")).toBeInTheDocument();
  });
});
