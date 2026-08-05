import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AntibioticForm from "./AntibioticForm";

const rpc = vi.fn();

const insertSpy = vi.fn(() => Promise.resolve({ error: null }));
const updateEqSpy = vi.fn(() => Promise.resolve({ error: null }));

// The row served for ?edit=<id> correction-mode tests. status must be
// 'rejected' and submitted_by must match the mocked auth user, or the page
// treats the visit as a plain new form. Holder object so tests can swap the
// row without reassigning a module binding.
const editHolder: { row: Record<string, unknown> | null } = { row: null };
// Rows returned to the recent-diagnoses picker query (select().eq().order().limit()).
const recentHolder: { rows: { diagnosis: string }[] } = { rows: [] };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: vi.fn(() => ({
      insert: insertSpy,
      update: vi.fn(() => ({ eq: updateEqSpy })),
      // Two distinct read shapes share `select().eq(...)`: the ?edit=<id>
      // loader chains .single(), the recent-diagnoses picker chains
      // .order().limit() — this stub supports both off the same eq() call.
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: editHolder.row, error: null })),
          order: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve({ data: recentHolder.rows, error: null })),
          })),
        })),
      })),
    })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ user: { id: "mo-1" }, role: "mo" })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/hooks/usePathwayCheck", () => ({
  usePathwayCheck: () => ({ verdict: null, explanation: null, status: "idle" }),
}));
vi.mock("@/hooks/useDoseSuggestion", () => ({
  useDoseSuggestion: () => ({ matches: [], status: "idle", message: null }),
}));
vi.mock("@/lib/featureFlags", () => ({
  AI_ENABLED: false,
  AI_SUGGEST_ROLES: ["mo", "admin", "pharmacist", "super_admin"],
  PATHWAY_CHECK_ENABLED: false,
  AI_STREAMING: false,
  AI_TIMEOUT_MS: 90000,
  KNOWLEDGE_ENABLED: false,
}));

function renderForm(initialEntry = "/request/antibiotik") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <AntibioticForm />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_fms_list") {
      return Promise.resolve({
        data: [
          { user_id: "fms-1", full_name: "Dr Norlaila Najwa" },
          { user_id: "fms-2", full_name: "Dr Rahim" },
        ],
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

describe("AntibioticForm assigned FMS", () => {
  it("lists the clinic's real FMS users, not placeholder names", async () => {
    renderForm();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_fms_list"));

    fireEvent.keyDown(screen.getByText("Select FMS"), { key: "Enter" });
    // Generous timeout: the dropdown opens as soon as the rpc is *called*, but
    // the names only render once the promise resolves and React Query commits.
    // Under a fully parallel suite the default 1s ceiling flakes.
    expect(await screen.findByText("Dr Norlaila Najwa", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText("Dr Rahim")).toBeInTheDocument();
    expect(screen.queryByText("Dr Amelia")).toBeNull();
    expect(screen.queryByText("Dr Muslim")).toBeNull();
  });

  it("says so when the clinic has no FMS yet", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    renderForm();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_fms_list"));

    fireEvent.keyDown(screen.getByText("Select FMS"), { key: "Enter" });
    expect(await screen.findByText(/Tiada FMS berdaftar/, {}, { timeout: 10_000 })).toBeInTheDocument();
  });
});

describe("AntibioticForm weight-driven local dose card", () => {
  it("shows the weight field even with no IC entered (regression: used to require an IC-derived age < 12)", async () => {
    renderForm();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_fms_list"));
    expect(screen.getByPlaceholderText("kg")).toBeInTheDocument();
  });

  it("lists every documented AOM option with no network call, and fills the regimen field on Use", async () => {
    renderForm();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_fms_list"));

    fireEvent.click(within(screen.getByText("OTALGIA").closest("label")!).getByRole("checkbox"));
    fireEvent.click(screen.getByLabelText("YES")); // AOM otoscopy finding
    fireEvent.change(screen.getByPlaceholderText("kg"), { target: { value: "14" } });

    // Weight-computed options
    expect(await screen.findByText("Amoxicillin 1120-1260mg/day BD x 5-10 days")).toBeInTheDocument();
    expect(screen.getByText("Erythromycin Ethylsuccinate 560-700mg/day BD x 5-10 days")).toBeInTheDocument();
    // No children's table for this drug in AOM — adult reference text only
    expect(screen.getByText("Amoxicillin-Clavulanate 625mg PO TDS x 5-7 days")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Use" })[0]);
    expect(screen.getByPlaceholderText(/Amoxicillin 500mg TDS/i)).toHaveValue(
      "Amoxicillin 1120-1260mg/day BD x 5-10 days"
    );
  });

  it("lists every UTI option as adult reference text — NAG has no paediatric UTI table", async () => {
    renderForm();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_fms_list"));

    fireEvent.click(within(screen.getByText(/Nit \+ve/).closest("label")!).getByRole("checkbox"));
    fireEvent.change(screen.getByPlaceholderText("kg"), { target: { value: "20" } });

    expect(await screen.findByText(/50-100mg PO QID/)).toBeInTheDocument();
    expect(screen.getByText(/500mg PO BD-QID/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use" }).length).toBeGreaterThanOrEqual(5);
  });
});

describe("AntibioticForm correction mode (?edit=<id>)", () => {
  beforeEach(() => {
    editHolder.row = {
      id: "form-9",
      status: "rejected",
      submitted_by: "mo-1", // matches the mocked auth user
      tarikh: "2026-07-30",
      patient_name: "Aminah binti Yusof",
      patient_ic: "900101-01-1234",
      patient_weight_kg: null,
      diagnosis: "Community Acquired Pneumonia",
      prescription_unit: "OPD",
      drug_allergy: false,
      drug_allergy_detail: null,
      antibiotic_regimen: "Amoxicillin 500mg TDS 5/7",
      fms_code: null,
      assigned_fms: "Dr Norlaila Najwa",
      health_ed_compliance: true,
      health_ed_sideeffect: false,
      health_ed_tca: true,
      checklist_data: null,
      prescriber_notes: null,
      specialist_notes: "Dose does not match weight — recalculate",
    };
  });

  it("prefills the rejected form and shows the FMS's reason", async () => {
    renderForm("/request/antibiotik?edit=form-9");
    expect(
      await screen.findByText(/returned by the FMS for correction/i, {}, { timeout: 10_000 })
    ).toBeInTheDocument();
    expect(screen.getByText(/Dose does not match weight/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Aminah binti Yusof")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Diagnosis" })).toHaveTextContent(
      "Community Acquired Pneumonia"
    );
  });

  it("resubmits via UPDATE (back to pending_specialist), not a new INSERT", async () => {
    renderForm("/request/antibiotik?edit=form-9");
    await screen.findByDisplayValue("Aminah binti Yusof", {}, { timeout: 10_000 });

    fireEvent.click(screen.getByRole("button", { name: /submit for specialist approval/i }));

    await waitFor(() => expect(updateEqSpy).toHaveBeenCalledWith("id", "form-9"), {
      timeout: 10_000,
    });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("treats someone else's rejected form as a plain new form", async () => {
    editHolder.row = { ...editHolder.row!, submitted_by: "someone-else" };
    renderForm("/request/antibiotik?edit=form-9");
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_fms_list"));
    expect(screen.queryByText(/returned by the FMS for correction/i)).toBeNull();
    expect(screen.queryByDisplayValue("Aminah binti Yusof")).toBeNull();
  });
});
