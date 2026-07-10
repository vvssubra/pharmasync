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

function renderDialog(open: boolean, drug: null = null) {
  const onOpenChange = vi.fn();
  return {
    onOpenChange,
    ...render(
      <QueryClientProvider client={makeQueryClient()}>
        <DrugFormDialog open={open} onOpenChange={onOpenChange} drug={drug} />
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
