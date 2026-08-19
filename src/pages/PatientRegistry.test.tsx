import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PatientRegistry from "./PatientRegistry";

// The drug selector is driven by get_drug_quota_usage() (the NATIONAL rows,
// via useDrugQuotaUsage) and then names those drug_ids from `drugs` — it no
// longer reads drug_quotas directly, which would have returned this clinic's
// own dead per-clinic rows. See the comment on the query in PatientRegistry.tsx.
const NOVOMIX = { id: "drug-novomix", drug_name: "Insulin Novomix", unit_pengukuran: "vial" };
const LEVEMIR = { id: "drug-levemir", drug_name: "Insulin Levemir", unit_pengukuran: "vial" };

// Mutable per-test fixtures so each `it` can shape the mocked backend
// without redefining the whole vi.mock factory.
const drugsData: unknown[] = [NOVOMIX, LEVEMIR];
let quotaPatientsByDrug: Record<string, unknown[]> = {};
let rpcData: unknown[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "drugs") {
        return {
          select: () => ({
            // The page's own selector query: .in(<national drug ids>).
            in: () => Promise.resolve({ data: drugsData, error: null }),
            // RefillWalkinDialog's "drugs-active" query, which this page always
            // mounts: .eq("is_active", true).order("drug_name").
            eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
          }),
        };
      }
      if (table === "drug_quota_patients") {
        return {
          select: () => ({
            eq: (_col: string, drugId: string) => ({
              eq: () => ({
                order: () => Promise.resolve({ data: quotaPatientsByDrug[drugId] ?? [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "patient_registry") {
        return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
      }
      // drugs-active / all-tx-stock (queried inside RefillWalkinDialog,
      // which this page always mounts) — awaited directly with no
      // .eq/.order chaining, so the select() call itself must be thenable.
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
          then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        }),
      };
    }),
    rpc: vi.fn(() => Promise.resolve({ data: rpcData, error: null })),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    user: { id: "pharmacist-1" },
    profile: { full_name: "Cik Aminah", clinic_id: "clinic-1", clinic_name: "KK Kempas" },
    role: "pharmacist",
    loading: false,
  })),
}));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={makeQC()}>
        <PatientRegistry />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("PatientRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quotaPatientsByDrug = {
      "drug-novomix": [
        { id: "row-1", source_bil: 1, tarikh_mula_rawatan: null, status: "AKTIF", dosing: null, fms_name: null, catatan: null, kuota: 1, patient_id: "p-1", patient_registry: { id: "p-1", patient_name: "Saringat Salleh", no_ic: "580305715589", created_at: "2024-01-01" } },
      ],
      "drug-levemir": [
        { id: "row-2", source_bil: 1, tarikh_mula_rawatan: null, status: "AKTIF", dosing: null, fms_name: null, catatan: null, kuota: 1, patient_id: "p-2", patient_registry: { id: "p-2", patient_name: "Lee Siew Yoong", no_ic: "520308105706", created_at: "2024-01-01" } },
      ],
    };
    rpcData = [
      { clinic_id: "clinic-1", drug_id: "drug-novomix", year: 2026, quota_limit: 100, alert_threshold_pct: 20, used: 71, remaining: 29 },
      { clinic_id: "clinic-1", drug_id: "drug-levemir", year: 2026, quota_limit: 40, alert_threshold_pct: 20, used: 35, remaining: 5 },
    ];
  });

  it("shows the server-computed used/remaining (35/5), not sum(kuota) of the one visible row", async () => {
    // The selector defaults to the alphabetically-first quota drug —
    // "Insulin Levemir" sorts before "Insulin Novomix".
    renderPage();
    // The RPC says 35 used even though only one drug_quota_patients row is
    // visible (kuota=1) — proving the header reads the RPC, not a client sum.
    await waitFor(() => expect(screen.getByText("35")).toBeInTheDocument());
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  it("re-queries drug_quota_patients with the new drug_id when the selector changes", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Lee Siew Yoong")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Pilih ubat" }));
    // Scoped to the option role, not a bare text match — "Insulin Novomix"
    // also appears as a peer entry in the benchmark card's competitors list
    // once Levemir (the initial selection) is showing.
    await user.click(await screen.findByRole("option", { name: "Insulin Novomix" }));

    await waitFor(() => expect(screen.getByText("Saringat Salleh")).toBeInTheDocument());
    expect(screen.queryByText("Lee Siew Yoong")).not.toBeInTheDocument();
    // Novomix's own RPC numbers should now be showing.
    expect(screen.getByText("71")).toBeInTheDocument();
  });

  it("shows the no-quota-drugs empty state when no drug carries a national quota this year", async () => {
    // Emptiness is now decided by the national usage RPC, not by this clinic's
    // drug_quotas rows — which is the whole point of the change.
    rpcData = [];
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Tiada ubat berkuota kebangsaan untuk tahun/)).toBeInTheDocument()
    );
  });

  it("names the selector's drugs from the national quota rows, never from drug_quotas", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Lee Siew Yoong")).toBeInTheDocument());
    const { supabase } = await import("@/integrations/supabase/client");
    const tables = vi.mocked(supabase.from).mock.calls.map(c => c[0] as string);
    // A drug PKD Logistik adds to the national pool has no row in this clinic's
    // drug_quotas, so reading that table here would have hidden it forever.
    expect(tables).not.toContain("drug_quotas");
    expect(tables).toContain("drugs");
  });
});
