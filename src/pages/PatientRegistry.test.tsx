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
// Approved dispensing requests that count toward national quota usage but
// have no drug_quota_patients enrolment yet — empty by default so existing
// assertions (which predate this union) are unaffected.
const dispensedByDrug: Record<string, unknown[]> = {};
// id -> name lookup the KLINIK column resolves against. Empty by default, so
// tests that predate the column see no clinic names and no column.
let clinicsData: unknown[] = [];
// Writes the status dropdown makes, captured for assertion.
const dqpUpdates: { id?: string; patch: Record<string, unknown> }[] = [];
const dqpInserts: Record<string, unknown>[] = [];
const patientInserts: Record<string, unknown>[] = [];
// What the (clinic_id, no_ic) lookup finds when enrolling a dispensing-request
// patient — null means "no patient_registry row yet, create one".
let patientLookup: { id: string } | null = null;

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
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              dqpUpdates.push({ id, patch });
              return Promise.resolve({ error: null });
            },
          }),
          insert: (row: Record<string, unknown>) => {
            dqpInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "clinics") {
        return {
          select: () => Promise.resolve({ data: clinicsData, error: null }),
        };
      }
      if (table === "patient_registry") {
        return {
          // Two callers: the walk-in dialog's .order() list, and the status
          // mutation's .eq(clinic_id).eq(no_ic).maybeSingle() lookup.
          select: () => {
            const chain = {
              order: () => Promise.resolve({ data: [], error: null }),
              eq: () => chain,
              maybeSingle: () => Promise.resolve({ data: patientLookup, error: null }),
            };
            return chain;
          },
          insert: (row: Record<string, unknown>) => {
            patientInserts.push(row);
            return {
              select: () => ({ single: () => Promise.resolve({ data: { id: "patient-new" }, error: null }) }),
            };
          },
        };
      }
      if (table === "dispensing_requests") {
        // Chainable .eq/.neq/.gte/.lt in any order, terminated by .order() —
        // the drug_id passed to the first .eq() picks the fixture.
        return {
          select: () => {
            let drugId = "";
            const chain = {
              eq: (col: string, value: string) => { if (col === "drug_id") drugId = value; return chain; },
              neq: () => chain,
              gte: () => chain,
              lt: () => chain,
              order: () => Promise.resolve({ data: dispensedByDrug[drugId] ?? [], error: null }),
            };
            return chain;
          },
        };
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

// Mutable so the logistic_pharmacist tests below can flip role without a
// separate mock module.
let mockRole = "pharmacist";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    user: { id: "pharmacist-1" },
    profile: { full_name: "Cik Aminah", clinic_id: "clinic-1", clinic_name: "KK Kempas" },
    role: mockRole,
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
    mockRole = "pharmacist";
    for (const k of Object.keys(dispensedByDrug)) delete dispensedByDrug[k];
    clinicsData = [];
    dqpUpdates.length = 0;
    dqpInserts.length = 0;
    patientInserts.length = 0;
    patientLookup = null;
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

  it("names each row's clinic from clinics, across both the enrolled and the dispensing-request sources", async () => {
    // super_admin / logistic_pharmacist read this page cross-clinic, so "which
    // KK is this patient from" is only answerable if clinic_id is carried
    // through both halves of the union and resolved to a name.
    clinicsData = [{ id: "clinic-1", name: "KK Kempas" }, { id: "clinic-2", name: "KK Larkin" }];
    quotaPatientsByDrug["drug-levemir"] = [
      { id: "row-2", source_bil: 1, tarikh_mula_rawatan: null, status: "AKTIF", dosing: null, fms_name: null, clinic_id: "clinic-1", catatan: null, kuota: 1, patient_id: "p-2", patient_registry: { id: "p-2", patient_name: "Lee Siew Yoong", no_ic: "520308105706", created_at: "2024-01-01" } },
    ];
    dispensedByDrug["drug-levemir"] = [
      { id: "dr-1", no_ic: "990101147788", patient_name: "Chong Wei Ling", status: "approved", created_at: "2026-03-01", clinic_id: "clinic-2" },
    ];
    renderPage();
    await waitFor(() => expect(screen.getByText("Chong Wei Ling")).toBeInTheDocument());

    expect(screen.getByText("KLINIK")).toBeInTheDocument();
    const enrolledRow = screen.getByText("Lee Siew Yoong").closest("tr")!;
    expect(enrolledRow.textContent).toContain("KK Kempas");
    const dispensedRow = screen.getByText("Chong Wei Ling").closest("tr")!;
    expect(dispensedRow.textContent).toContain("KK Larkin");
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

  it("includes approved dispensing requests with no drug_quota_patients enrolment yet, so the list tallies with the RPC's used figure", async () => {
    // Reproduces the reported bug: a drug (e.g. Amlodipine Valsartan) that
    // goes through the normal request/approve flow but was never bulk-seeded
    // into drug_quota_patients used to show 0/1 patients here while the quota
    // card's "used" figure kept counting approved requests.
    dispensedByDrug["drug-levemir"] = [
      { id: "dr-1", no_ic: "990101147788", patient_name: "Chong Wei Ling", status: "approved", created_at: "2026-03-01" },
    ];
    renderPage();
    await waitFor(() => expect(screen.getByText("Lee Siew Yoong")).toBeInTheDocument());
    expect(screen.getByText("Chong Wei Ling")).toBeInTheDocument();
  });

  it("collapses two drug_quota_patients rows sharing an IC into one, keeping max(kuota) (matches drug_quota_used())", async () => {
    quotaPatientsByDrug["drug-levemir"] = [
      { id: "row-2", source_bil: 1, tarikh_mula_rawatan: null, status: "AKTIF", dosing: null, fms_name: null, catatan: null, kuota: 1, patient_id: "p-2", patient_registry: { id: "p-2", patient_name: "Lee Siew Yoong", no_ic: "520308105706", created_at: "2024-01-01" } },
      // Re-enrolled later under a different FMS — same person, same digits-only IC once dashes are stripped.
      { id: "row-2b", source_bil: 40, tarikh_mula_rawatan: null, status: "AKTIF", dosing: null, fms_name: "DR OTHER", catatan: null, kuota: 2, patient_id: "p-2b", patient_registry: { id: "p-2b", patient_name: "Lee Siew Yoong", no_ic: "520308-10-5706", created_at: "2024-01-01" } },
    ];
    renderPage();
    // One row, not two — the same collapse drug_quota_used() applies, so the
    // row count and the quota card's "used" figure cannot diverge. The
    // surviving row's kuota (raised to the group's max) is no longer asserted
    // here: the KUOTA column was dropped, so nothing renders it.
    await waitFor(() => expect(screen.getAllByText("Lee Siew Yoong")).toHaveLength(1));
  });

  it("excludes a dispensing request whose IC is already enrolled in drug_quota_patients (no double-count)", async () => {
    dispensedByDrug["drug-levemir"] = [
      // Same digits-only IC as the already-enrolled Lee Siew Yoong (p-2).
      { id: "dr-2", no_ic: "520308-10-5706", patient_name: "Lee Siew Yoong", status: "approved", created_at: "2026-03-01" },
    ];
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Lee Siew Yoong")).toHaveLength(1));
  });

  describe("status editing — admin only", () => {
    it("gives a pharmacist no status dropdown", async () => {
      // Releasing a national slot is an allocation decision; the trigger in
      // 20260827000000_quota_patient_status.sql refuses a pharmacist anyway.
      renderPage(); // mockRole is "pharmacist"
      await waitFor(() => expect(screen.getByText("Lee Siew Yoong")).toBeInTheDocument());
      expect(screen.queryByRole("combobox", { name: /^Status / })).not.toBeInTheDocument();
    });

    it("writes the new status to the enrolment row an admin picks", async () => {
      mockRole = "admin";
      renderPage();
      await waitFor(() => expect(screen.getByText("Lee Siew Yoong")).toBeInTheDocument());

      const user = userEvent.setup();
      await user.click(screen.getByRole("combobox", { name: "Status Lee Siew Yoong" }));
      await user.click(await screen.findByRole("option", { name: "TIDAK AKTIF" }));

      await waitFor(() => expect(dqpUpdates).toHaveLength(1));
      expect(dqpUpdates[0]).toEqual({ id: "row-2", patch: { status: "TIDAK AKTIF" } });
      expect(dqpInserts).toHaveLength(0);
    });

    it("re-reads the usage RPC after a status change, so the quota card moves with the row", async () => {
      mockRole = "admin";
      renderPage();
      await waitFor(() => expect(screen.getByText("Lee Siew Yoong")).toBeInTheDocument());
      const { supabase } = await import("@/integrations/supabase/client");
      const before = vi.mocked(supabase.rpc).mock.calls.length;

      const user = userEvent.setup();
      await user.click(screen.getByRole("combobox", { name: "Status Lee Siew Yoong" }));
      await user.click(await screen.findByRole("option", { name: "TIDAK AKTIF" }));

      // Without this the row reads TIDAK AKTIF while the card still counts the slot.
      await waitFor(() => expect(vi.mocked(supabase.rpc).mock.calls.length).toBeGreaterThan(before));
    });

    it("enrols a dispensing-request patient before setting the status, creating the patient row when there is none", async () => {
      mockRole = "admin";
      clinicsData = [{ id: "clinic-2", name: "KK Larkin" }];
      quotaPatientsByDrug["drug-levemir"] = [];
      dispensedByDrug["drug-levemir"] = [
        { id: "dr-1", no_ic: "990101-14-7788", patient_name: "Chong Wei Ling", status: "approved", created_at: "2026-03-01", clinic_id: "clinic-2" },
      ];
      renderPage();
      await waitFor(() => expect(screen.getByText("Chong Wei Ling")).toBeInTheDocument());

      const user = userEvent.setup();
      await user.click(screen.getByRole("combobox", { name: "Status Chong Wei Ling" }));
      await user.click(await screen.findByRole("option", { name: "TIDAK AKTIF" }));

      // Patient created against the ROW's clinic, not the admin's — and with a
      // digits-only IC, which is what patient_registry is unique on.
      await waitFor(() => expect(patientInserts).toHaveLength(1));
      expect(patientInserts[0]).toEqual({
        patient_name: "Chong Wei Ling", no_ic: "990101147788", clinic_id: "clinic-2",
      });
      // Then the enrolment that makes the slot releasable at all.
      expect(dqpInserts).toHaveLength(1);
      expect(dqpInserts[0]).toMatchObject({
        patient_id: "patient-new", drug_id: "drug-levemir", clinic_id: "clinic-2",
        status: "TIDAK AKTIF", kuota: 1,
      });
      expect(dqpUpdates).toHaveLength(0);
    });

    it("reuses an existing patient_registry row rather than creating a duplicate", async () => {
      mockRole = "admin";
      patientLookup = { id: "patient-existing" };
      clinicsData = [{ id: "clinic-2", name: "KK Larkin" }];
      quotaPatientsByDrug["drug-levemir"] = [];
      dispensedByDrug["drug-levemir"] = [
        { id: "dr-1", no_ic: "990101147788", patient_name: "Chong Wei Ling", status: "approved", created_at: "2026-03-01", clinic_id: "clinic-2" },
      ];
      renderPage();
      await waitFor(() => expect(screen.getByText("Chong Wei Ling")).toBeInTheDocument());

      const user = userEvent.setup();
      await user.click(screen.getByRole("combobox", { name: "Status Chong Wei Ling" }));
      await user.click(await screen.findByRole("option", { name: "PENDING" }));

      await waitFor(() => expect(dqpInserts).toHaveLength(1));
      expect(patientInserts).toHaveLength(0);
      expect(dqpInserts[0]).toMatchObject({ patient_id: "patient-existing", status: "PENDING" });
    });
  });

  describe("logistic_pharmacist — read-only", () => {
    it("hides Isi Semula (Walk-in), which has no write access to patient_registry/transactions", async () => {
      mockRole = "logistic_pharmacist";
      renderPage();
      await waitFor(() => expect(screen.getByText("Lee Siew Yoong")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /Isi Semula \(Walk-in\)/i })).not.toBeInTheDocument();
    });

    it("hides the refill button in the patient history sheet too", async () => {
      mockRole = "logistic_pharmacist";
      renderPage();
      await waitFor(() => expect(screen.getByText("Lee Siew Yoong")).toBeInTheDocument());

      const user = userEvent.setup();
      await user.click(screen.getByText("Lee Siew Yoong"));

      expect(await screen.findByText(/Dalam sistem sejak/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Isi Semula Ubat/i })).not.toBeInTheDocument();
    });
  });
});
