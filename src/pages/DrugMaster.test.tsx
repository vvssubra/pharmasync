import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import DrugMaster from "./DrugMaster";

const drugRow = {
  id: "drug-1",
  drug_name: "Insulin Glargine",
  is_active: true,
  is_blocked: false,
  perlu_kelulusan_pakar: true,
  stok_min: 0,
  stok_reorder: 0,
  stok_max: 0,
};

// Deliberately uses a different clinic name from any per-clinic breakdown UI
// elsewhere so this file's text queries never collide with another page's.
const patientRow = {
  normalized_ic: "900101011234",
  display_ic: "900101-01-1234",
  patient_name: "Ali Ahmad",
  clinic_names: ["HQ Clinic", "KK Tampoi"],
  clinic_count: 2,
  first_seen: "2026-01-01",
  last_seen: "2026-08-10",
  total_count: 1,
};

// Mutable so individual tests can swap in different master-patient-registry
// results without redefining the whole mock module.
let masterPatientResponse: { data: unknown; error: unknown } = { data: [patientRow], error: null };

// Mutable so tests can flip role between an HQ role (sees the Master Patient
// Registry card) and a clinic role (doesn't).
let mockRole: string = "super_admin";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: mockRole, profile: null, user: null, loading: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: table === "drugs" ? [drugRow] : [], error: null })),
        eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
      update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
      upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
    // get_drug_quota_usage -> national quota rows; get_master_patient_registry -> patient rows.
    rpc: vi.fn((fnName: string) => {
      if (fnName === "get_drug_quota_usage") return Promise.resolve({ data: [], error: null });
      if (fnName === "get_master_patient_registry") return Promise.resolve(masterPatientResponse);
      return Promise.resolve({ data: null, error: null });
    }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter><DrugMaster /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DrugMaster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = "super_admin";
    masterPatientResponse = { data: [patientRow], error: null };
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the drug list", async () => {
    renderPage();
    expect(await screen.findByText("Insulin Glargine")).toBeInTheDocument();
  });

  describe("Master Patient Registry section", () => {
    it("renders for an HQ role (super_admin)", async () => {
      mockRole = "super_admin";
      renderPage();
      expect(await screen.findByText("Master Patient Registry")).toBeInTheDocument();
      expect(await screen.findByText("Ali Ahmad")).toBeInTheDocument();
      expect(screen.getByText("900101-01-1234")).toBeInTheDocument();
    });

    it("renders for an HQ role (logistic_pharmacist)", async () => {
      mockRole = "logistic_pharmacist";
      renderPage();
      expect(await screen.findByText("Master Patient Registry")).toBeInTheDocument();
    });

    it("does not render for a non-HQ role", async () => {
      mockRole = "pharmacist";
      renderPage();
      await screen.findByText("Insulin Glargine");
      expect(screen.queryByText("Master Patient Registry")).not.toBeInTheDocument();
    });

    it("narrows results when searching by partial name, after the 300ms debounce", async () => {
      renderPage();
      await screen.findByText("Ali Ahmad");

      masterPatientResponse = {
        data: [{ ...patientRow, patient_name: "Siti Aminah", display_ic: "850505-05-5555", total_count: 1 }],
        error: null,
      };
      fireEvent.change(screen.getByPlaceholderText("Search patient name or IC…"), { target: { value: "Siti" } });

      expect(await screen.findByText("Siti Aminah")).toBeInTheDocument();
      expect(screen.queryByText("Ali Ahmad")).not.toBeInTheDocument();
    });

    it("shows an empty state, not an error, for an empty result page", async () => {
      masterPatientResponse = { data: [], error: null };
      renderPage();
      expect(await screen.findByText("No patients registered yet.")).toBeInTheDocument();
    });
  });
});
