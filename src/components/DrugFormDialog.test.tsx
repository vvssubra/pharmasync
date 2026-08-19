import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DrugFormDialog } from "./DrugFormDialog";

// Every .eq() this dialog issues, as [table, column, value] — the quota read
// has to be scoped by clinic_id and there is no other way to see that from the
// outside. Reset in beforeEach.
// Held in one mutable object so each field can be reset per test.
const mockState: {
  eqCalls: [string, string, unknown][];
  // Row the drug_quotas read resolves to, and the error it raises (if any).
  quotaRow: unknown;
  quotaError: unknown;
} = { eqCalls: [], quotaRow: null, quotaError: null };

// Mock Supabase client. select() returns a chainable builder because the quota
// read chains three .eq()s (drug_id, year, clinic_id) before .maybeSingle().
vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const builder = {
      eq: vi.fn((col: string, val: unknown) => {
        mockState.eqCalls.push([table, col, val]);
        return builder;
      }),
      maybeSingle: vi.fn(() =>
        table === "drug_quotas"
          ? Promise.resolve({ data: mockState.quotaRow, error: mockState.quotaError })
          : Promise.resolve({ data: null, error: null }),
      ),
      single: vi.fn(() => Promise.resolve({ data: { id: "drug-1" }, error: null })),
    };
    return builder;
  };
  return {
    supabase: {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => makeBuilder(table)),
        insert: vi.fn(() => ({
          ...makeBuilder(table),
          select: vi.fn(() => makeBuilder(table)),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        })),
        upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
        update: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    },
  };
});

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Per-test override so the HQ-clinic case below can swap the caller's clinic —
// same pattern as ProtectedRoute.test.tsx.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const { useAuth } = await import("@/contexts/AuthContext");

/** Ordinary clinic admin: KK Kempas, not the HQ clinic. */
const AT_ORDINARY_CLINIC = { user: { id: "user-1" }, profile: { clinic_id: "clinic-1", is_hq_clinic: false } };
/** Admin stationed at the national HQ clinic, 'Logistik PKDJB'. */
const AT_HQ_CLINIC = { user: { id: "user-1" }, profile: { clinic_id: "hq-clinic", is_hq_clinic: true } };

function setAuth(auth: object) {
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue(auth);
}

beforeEach(() => {
  setAuth(AT_ORDINARY_CLINIC);
  mockState.eqCalls = [];
  mockState.quotaRow = null;
  mockState.quotaError = null;
});

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

type TestDrug = {
  id: string;
  drug_name: string;
  is_active: boolean;
  perlu_kelulusan_pakar?: boolean | null;
};

function renderDialog(
  open: boolean,
  drug: TestDrug | null = null,
  nationalQuota?: { quota_limit: number; used: number; remaining: number; alert_threshold_pct: number } | null,
) {
  const onOpenChange = vi.fn();
  return {
    onOpenChange,
    ...render(
      <QueryClientProvider client={makeQueryClient()}>
        <DrugFormDialog open={open} onOpenChange={onOpenChange} drug={drug} nationalQuota={nationalQuota} />
      </QueryClientProvider>
    ),
  };
}

describe("DrugFormDialog English labels — Add Drug mode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders dialog title 'Add Drug'", () => {
    renderDialog(true);
    // Currently shows "Tambah Ubat" — this FAILS until ENGL-02 translation
    expect(screen.getByText("Add Drug")).toBeInTheDocument();
  });

  it("renders form label 'Drug Name *'", () => {
    renderDialog(true);
    // Currently shows "Nama Ubat *" — this FAILS until ENGL-02 translation
    expect(screen.getByText("Drug Name *")).toBeInTheDocument();
  });

  it("renders form label 'Number of Quota'", () => {
    renderDialog(true);
    expect(screen.getByText("Number of Quota")).toBeInTheDocument();
  });

  it("renders submit button 'Save'", () => {
    renderDialog(true);
    // Currently shows "Simpan" — this FAILS until ENGL-02 translation
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});

describe("DrugFormDialog Zod validation messages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows 'Drug name is required' when submitting empty form", async () => {
    renderDialog(true);
    // Currently Zod message is "Nama ubat diperlukan" — this FAILS until ENGL-04 translation
    const saveButton = screen.getByRole("button", { name: /save|simpan/i });
    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(screen.getByText("Drug name is required")).toBeInTheDocument();
    });
  });
});

/** Table names passed to supabase.from() during a render/interaction. */
async function tablesTouched() {
  const { supabase } = await import("@/integrations/supabase/client");
  return vi.mocked(supabase.from).mock.calls.map(c => c[0] as string);
}

describe("DrugFormDialog — editing a non-controlled drug (existing behavior unchanged)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("still renders the editable 'Number of Quota' field", () => {
    renderDialog(true, { id: "drug-1", drug_name: "Amoxicillin", is_active: true, perlu_kelulusan_pakar: false });
    expect(screen.getByText("Number of Quota")).toBeInTheDocument();
    expect(screen.queryByText(/set nationally by pkd logistik/i)).not.toBeInTheDocument();
  });

  // Positive control for the HQ case below: an ordinary clinic admin DOES write
  // drug_quotas here, which is the write the 20260819000600 migration restored.
  it("writes drug_quotas on save", async () => {
    renderDialog(true, { id: "drug-1", drug_name: "Amoxicillin", is_active: true, perlu_kelulusan_pakar: false });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => {
      expect(await tablesTouched()).toContain("drug_quotas");
    });
  });
});

// An admin whose profile.clinic_id is the HQ clinic has NO drug_quotas write
// path for any drug: trg_stamp_clinic_id stamps the row with the HQ clinic_id
// and the write policies exclude that clinic
// (supabase/migrations/20260819000600_drug_quotas_clinic_admin_write.sql).
// `drugs` is a global table, so an HQ admin can reach this dialog for any drug.
// The RLS denial is correct — but the `drugs` write lands BEFORE the quota
// upsert with no transaction around them, so attempting it would show an error
// toast on an edit that already committed. Hence: never attempt it.
describe("DrugFormDialog — caller stationed at the HQ clinic (no drug_quotas write path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuth(AT_HQ_CLINIC);
  });

  it("hides the editable 'Number of Quota' field for a NON-controlled drug too", () => {
    renderDialog(true, { id: "drug-1", drug_name: "Amoxicillin", is_active: true, perlu_kelulusan_pakar: false });
    expect(screen.queryByText("Number of Quota")).not.toBeInTheDocument();
    expect(screen.getByText(/not set from the HQ clinic/i)).toBeInTheDocument();
  });

  it("saves the drug itself but never touches drug_quotas", async () => {
    renderDialog(true, { id: "drug-1", drug_name: "Amoxicillin", is_active: true, perlu_kelulusan_pakar: false });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => {
      expect(await tablesTouched()).toContain("drugs");
    });
    const touched = await tablesTouched();
    expect(touched).not.toContain("drug_quotas");
    // The baki_awal seeding lives inside the same skipped block.
    expect(touched).not.toContain("transactions");
  });

  it("still shows the national figure for a controlled drug (isControlled wins the branch)", () => {
    renderDialog(
      true,
      { id: "drug-1", drug_name: "Morphine", is_active: true, perlu_kelulusan_pakar: true },
      { quota_limit: 100, used: 40, remaining: 60, alert_threshold_pct: 20 },
    );
    expect(screen.getByText(/60 \/ 100 remaining/i)).toBeInTheDocument();
    expect(screen.queryByText("Number of Quota")).not.toBeInTheDocument();
  });
});

describe("DrugFormDialog — editing a controlled drug (perlu_kelulusan_pakar=true)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the national quota read-only with the PKD Logistik label instead of an editable field", () => {
    renderDialog(
      true,
      { id: "drug-1", drug_name: "Morphine", is_active: true, perlu_kelulusan_pakar: true },
      { quota_limit: 100, used: 40, remaining: 60, alert_threshold_pct: 20 },
    );
    expect(screen.getByText(/60 \/ 100 remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/set nationally by pkd logistik/i)).toBeInTheDocument();
    expect(screen.queryByText("Number of Quota")).not.toBeInTheDocument();
  });
});

// Since the national pool landed, a drug can hold BOTH the HQ clinic's row and
// a legacy per-clinic row for the same (drug_id, year). Without a clinic_id
// filter a viewer who can see more than one clinic's rows gets 2+ rows back and
// maybeSingle() errors — and this form used to drop that error and pre-fill 0,
// i.e. quietly offer to overwrite a real quota with zero.
describe("DrugFormDialog — quota read is scoped to the caller's clinic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters drug_quotas by clinic_id as well as drug_id and year", async () => {
    mockState.quotaRow = { quota_limit: 60 };
    renderDialog(true, { id: "drug-1", drug_name: "Amoxicillin", is_active: true, perlu_kelulusan_pakar: false });

    await waitFor(() => {
      const quotaEqs = mockState.eqCalls.filter(([table]) => table === "drug_quotas");
      expect(quotaEqs.map(([, col]) => col)).toContain("clinic_id");
      expect(quotaEqs).toContainEqual(["drug_quotas", "clinic_id", "clinic-1"]);
    });
  });

  it("surfaces a failed quota read instead of silently pre-filling 0", async () => {
    mockState.quotaError = { message: "JSON object requested, multiple (or no) rows returned" };
    renderDialog(true, { id: "drug-1", drug_name: "Amoxicillin", is_active: true, perlu_kelulusan_pakar: false });

    expect(await screen.findByText(/could not load this drug's current quota/i)).toBeInTheDocument();
  });
});
