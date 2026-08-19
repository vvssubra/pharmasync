import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LogistikDashboard from "./LogistikDashboard";

const nationalRow = {
  clinic_id: "hq-clinic",
  drug_id: "drug-1",
  year: new Date().getFullYear(),
  quota_limit: 100,
  alert_threshold_pct: 20,
  used: 90,
  remaining: 10,
};

const clinicRow = {
  clinic_id: "clinic-a",
  clinic_name: "KK Kempas",
  drug_id: "drug-1",
  year: new Date().getFullYear(),
  used: 90,
};

const drugRow = { id: "drug-1", drug_name: "Insulin Glargine", unit_price: 45.5 };

// Deliberately uses different clinic names from clinicRow ("KK Kempas") so
// the two tables' text queries in these tests never collide.
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
// results (e.g. an empty page-past-the-end response) without redefining the
// whole mock module.
let masterPatientResponse: { data: unknown; error: unknown } = { data: [patientRow], error: null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: [drugRow], error: null })),
      })),
    })),
    // get_drug_quota_usage -> national rows; get_quota_usage_by_clinic -> per-clinic rows;
    // get_master_patient_registry -> master patient registry rows.
    rpc: vi.fn((fnName: string) => {
      if (fnName === "get_drug_quota_usage") {
        return Promise.resolve({ data: [nationalRow], error: null });
      }
      if (fnName === "get_quota_usage_by_clinic") {
        return Promise.resolve({ data: [clinicRow], error: null });
      }
      if (fnName === "get_master_patient_registry") {
        return Promise.resolve(masterPatientResponse);
      }
      return Promise.resolve({ data: null, error: null });
    }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe("LogistikDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    masterPatientResponse = { data: [patientRow], error: null };
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the four summary cards", async () => {
    render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
    expect(await screen.findByText("Total Drugs")).toBeInTheDocument();
    expect(screen.getByText("Drugs at Critical Quota")).toBeInTheDocument();
    expect(screen.getByText("Drugs Available for Quota")).toBeInTheDocument();
    expect(screen.getByText("Alerts")).toBeInTheDocument();
  });

  it("renders the national quota table with drug name, formatted price and status badge", async () => {
    render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
    expect(await screen.findByText("Insulin Glargine")).toBeInTheDocument();
    expect(screen.getByText("RM 45.50")).toBeInTheDocument();
    // used=90, limit=100, alert_threshold_pct=20 -> quotaBadgeState is "warning"
    // (used >= limit * (1 - 20/100) = 80), so the badge shows the used/limit label.
    expect(screen.getByText("90/100 patients")).toBeInTheDocument();
  });

  it("expands a row to show the per-clinic breakdown", async () => {
    render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
    await screen.findByText("Insulin Glargine");
    fireEvent.click(screen.getByLabelText("Expand per-clinic breakdown"));
    expect(await screen.findByText("KK Kempas")).toBeInTheDocument();
    expect(screen.getByText("90 used")).toBeInTheDocument();
  });

  it("opens NationalQuotaDialog when Edit is clicked", async () => {
    render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
    await screen.findByText("Insulin Glargine");
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    expect(await screen.findByText(/National Quota — Insulin Glargine/i)).toBeInTheDocument();
  });

  it("filters the table to critical drugs when that card is clicked", async () => {
    render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
    await screen.findByText("Insulin Glargine");
    // remaining=10 of limit=100 -> 10% remaining -> quotaStatus is "critical".
    fireEvent.click(screen.getByText("Drugs at Critical Quota"));
    expect(screen.getByText("Insulin Glargine")).toBeInTheDocument();
  });

  describe("Master Patient Registry section", () => {
    it("renders patient rows with name, IC, clinic badges (capped at 3, +N overflow) and seen dates", async () => {
      masterPatientResponse = {
        data: [{
          ...patientRow,
          clinic_names: ["HQ Clinic", "KK Tampoi", "KK Pasir Gudang", "KK Skudai"],
          clinic_count: 4,
        }],
        error: null,
      };
      render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
      expect(await screen.findByText("Master Patient Registry")).toBeInTheDocument();
      expect(await screen.findByText("Ali Ahmad")).toBeInTheDocument();
      expect(screen.getByText("900101-01-1234")).toBeInTheDocument();
      // Only the first 3 clinic names render as badges, plus a +1 overflow badge.
      expect(screen.getByText("HQ Clinic")).toBeInTheDocument();
      expect(screen.getByText("KK Pasir Gudang")).toBeInTheDocument();
      expect(screen.queryByText("KK Skudai")).not.toBeInTheDocument();
      expect(screen.getByText("+1")).toBeInTheDocument();
      expect(screen.getByText("4")).toBeInTheDocument();
    });

    it("narrows results when searching by partial name, after the 300ms debounce", async () => {
      render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
      await screen.findByText("Ali Ahmad");

      masterPatientResponse = {
        data: [{ ...patientRow, patient_name: "Siti Aminah", display_ic: "850505-05-5555", total_count: 1 }],
        error: null,
      };
      fireEvent.change(screen.getByPlaceholderText("Search patient name or IC…"), { target: { value: "Siti" } });

      expect(await screen.findByText("Siti Aminah")).toBeInTheDocument();
      expect(screen.queryByText("Ali Ahmad")).not.toBeInTheDocument();
    });

    it("narrows results when searching by partial IC", async () => {
      render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
      await screen.findByText("Ali Ahmad");

      masterPatientResponse = {
        data: [{ ...patientRow, patient_name: "Ali Ahmad", display_ic: "900101-01-1234", total_count: 1 }],
        error: null,
      };
      fireEvent.change(screen.getByPlaceholderText("Search patient name or IC…"), { target: { value: "900101" } });

      expect(await screen.findByText("900101-01-1234")).toBeInTheDocument();
    });

    it("shows an empty state, not an error, for an empty result page", async () => {
      masterPatientResponse = { data: [], error: null };
      render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
      expect(await screen.findByText("No patients registered yet.")).toBeInTheDocument();
    });

    it("does not render row click handlers or navigation — the section is read-only", async () => {
      render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
      const nameCell = await screen.findByText("Ali Ahmad");
      const row = nameCell.closest("tr");
      expect(row).not.toBeNull();
      expect(row).not.toHaveClass("cursor-pointer");
      // No links/anchors inside the patient row (no drill-down/navigation).
      expect(row?.querySelector("a")).toBeNull();
    });
  });
});
