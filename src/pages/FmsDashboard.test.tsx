import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FmsDashboard from "./FmsDashboard";

// The ytdCounts query now calls:
//   .select("drug_id, no_ic").eq("status", "fulfilled").eq("is_pesara", false).gte(...).lt(...)
// The pesaraCounts query calls:
//   .select("drug_id, no_ic").eq("status", "fulfilled").eq("is_pesara", true).gte(...).lt(...)
// Both return empty arrays; the mock chain must handle three chained .eq() calls.

// One pending antibiotic form, for the "Review & Approve" dialog test — every
// other query (drugs, transactions, dispensing_requests, quota RPCs) stays
// empty, this table is the only one this test file needs real rows from.
const pendingForm = {
  id: "form-1",
  tarikh: "2026-08-03",
  patient_name: "Test Patient",
  patient_ic: "900101-01-1234",
  patient_weight_kg: null,
  diagnosis: "Acute Otitis Media",
  prescription_unit: "OPD",
  assigned_fms: "AMELIA TEH JAY YUN (PKDJB)",
  drug_allergy: false,
  drug_allergy_detail: null,
  antibiotic_regimen: "Amoxicillin 500mg PO TDS x 5-7 days",
  fms_code: null,
  health_ed_compliance: true,
  health_ed_sideeffect: true,
  health_ed_tca: true,
  checklist_data: null,
  prescriber_notes: null,
  submitted_by: "mo-1",
  status: "pending_specialist",
  created_at: new Date().toISOString(),
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "antibiotic_forms") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({ data: [pendingForm], error: null })),
            })),
          })),
        };
      }
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ data: [{ user_id: "mo-1", full_name: "NUR ARINA BINTI MOHD AMIN" }], error: null })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => Promise.resolve({ data: [], error: null })),
                gte: vi.fn(() => ({ lt: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
              })),
              order: vi.fn(() => Promise.resolve({ data: [], error: null })),
              gte: vi.fn(() => ({ lt: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
              in: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
            gte: vi.fn(() => ({ lt: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
            in: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          in: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      };
    }),
    // Quota usage now comes from the get_drug_quota_usage RPC (see
    // src/hooks/useDrugQuotaUsage.ts), not a hand-rolled drug_quotas query.
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ role: "fms", profile: null, user: null, loading: false })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe("FmsDashboard sections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders Controlled Drug Annual Quota section", () => {
    render(<MemoryRouter><QueryClientProvider client={makeQC()}><FmsDashboard /></QueryClientProvider></MemoryRouter>);
    expect(screen.getByText(/Controlled Drug Annual Quota/i)).toBeInTheDocument();
  });

  it("renders Non-Controlled Stock Forecast section", () => {
    render(<MemoryRouter><QueryClientProvider client={makeQC()}><FmsDashboard /></QueryClientProvider></MemoryRouter>);
    expect(screen.getByText(/Non-Controlled Stock Forecast/i)).toBeInTheDocument();
  });

  it("renders Pesara column header in annual quota table", async () => {
    render(<MemoryRouter><QueryClientProvider client={makeQC()}><FmsDashboard /></QueryClientProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Pesara")).toBeInTheDocument());
  });

  it("opens the full form on Review & Approve, not just a name/diagnosis summary", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><QueryClientProvider client={makeQC()}><FmsDashboard /></QueryClientProvider></MemoryRouter>);

    await user.click(await screen.findByRole("tab", { name: /Antibiotic Forms/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Review & Approve" }));

    expect(await screen.findByText(/Review Antibiotic Form/i)).toBeInTheDocument();
    // Detail only AntibioticFormReadOnly renders — proves the full form is
    // shown, not the old name/diagnosis/submitter-only summary.
    expect(screen.getByText("Amoxicillin 500mg PO TDS x 5-7 days")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Additional notes")).toBeInTheDocument();
  });
});
