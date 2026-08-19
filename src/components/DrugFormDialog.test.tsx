import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DrugFormDialog } from "./DrugFormDialog";

// Mock Supabase client
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    })),
  },
}));

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

beforeEach(() => setAuth(AT_ORDINARY_CLINIC));

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
