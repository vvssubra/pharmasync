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

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ user: { id: "user-1" } })),
}));

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

describe("DrugFormDialog — editing a non-controlled drug (existing behavior unchanged)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("still renders the editable 'Number of Quota' field", () => {
    renderDialog(true, { id: "drug-1", drug_name: "Amoxicillin", is_active: true, perlu_kelulusan_pakar: false });
    expect(screen.getByText("Number of Quota")).toBeInTheDocument();
    expect(screen.queryByText(/set nationally by pkd logistik/i)).not.toBeInTheDocument();
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
