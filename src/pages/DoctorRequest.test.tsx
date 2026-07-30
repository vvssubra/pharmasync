import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DoctorRequest from "./DoctorRequest";

// Mock Supabase — drugs query returns empty array (only need form labels and validation)
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
    // Quota usage now comes from the get_drug_quota_usage RPC (see
    // src/hooks/useDrugQuotaUsage.ts), not a hand-rolled drug_quotas query.
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}));

// Mock AuthContext with logged-in doctor
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { useAuth } = await import("@/contexts/AuthContext");

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderDoctorRequest() {
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id: "doctor-1" },
    role: "doctor",
    profile: { full_name: "Dr. Ahmad", clinic_id: "clinic-1", clinic_name: "KK Kempas" },
    loading: false,
    session: null,
    signOut: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={["/request/ubat"]}>
      <QueryClientProvider client={makeQueryClient()}>
        <DoctorRequest />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("DoctorRequest form labels", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders form label 'Patient Name *' (currently 'Nama Pesakit *')", () => {
    renderDoctorRequest();
    // FAILS until ENGL-04 translation
    expect(screen.getByText("Patient Name *")).toBeInTheDocument();
  });

  it("renders form label 'Drug *' (currently 'Ubat *')", () => {
    renderDoctorRequest();
    // FAILS until ENGL-04 translation
    expect(screen.getByText("Drug *")).toBeInTheDocument();
  });

  it("renders submit button 'Submit Request' (currently 'Hantar Permintaan')", () => {
    renderDoctorRequest();
    // FAILS until ENGL-04 translation
    expect(screen.getByRole("button", { name: "Submit Request" })).toBeInTheDocument();
  });
});

describe("DoctorRequest Zod validation messages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows 'Patient name is required' when submitting empty form", async () => {
    renderDoctorRequest();
    // Find submit button by current Malay or future English name
    const submitButton = screen.getByRole("button", { name: /submit request|hantar permintaan/i });
    fireEvent.click(submitButton);
    // Currently shows "Nama pesakit diperlukan" — FAILS until ENGL-04 translation
    await waitFor(() => {
      expect(screen.getByText("Patient name is required")).toBeInTheDocument();
    });
  });

  it("shows 'Please select a drug' when submitting without a drug selected", async () => {
    renderDoctorRequest();
    const submitButton = screen.getByRole("button", { name: /submit request|hantar permintaan/i });
    fireEvent.click(submitButton);
    // Currently shows "Sila pilih ubat" — FAILS until ENGL-04 translation
    await waitFor(() => {
      expect(screen.getByText("Please select a drug")).toBeInTheDocument();
    });
  });
});

describe("DoctorRequest Pesara checkbox", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a label 'Pesara (Government Retiree)'", () => {
    renderDoctorRequest();
    expect(screen.getByText("Pesara (Government Retiree)")).toBeInTheDocument();
  });

  it("renders helper text containing 'Pesara Kerajaan'", () => {
    renderDoctorRequest();
    expect(screen.getByText(/Pesara Kerajaan/)).toBeInTheDocument();
  });

  it("includes is_pesara: false in insert payload by default", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    // insert() is called with the row payload, so the mock must declare that
    // parameter for mock.calls[0][0] to be typed.
    const insertMock = vi.fn((_payload: Record<string, unknown>) =>
      Promise.resolve({ data: null, error: null })
    );
    // The drug select needs at least one option, or drug_id can never be set
    // and the insert below is never reached.
    const DRUG = { id: "drug-1", drug_name: "Amoxicillin 250mg", unit_pengukuran: "tablet", perlu_kelulusan_pakar: false };
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "dispensing_requests") {
        return {
          insert: insertMock,
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({ data: [], error: null })),
              maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        };
      }
      const rows = table === "drugs" ? [DRUG] : [];
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
            maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
          order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
        })),
        insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      };
    });

    renderDoctorRequest();

    fireEvent.change(screen.getByPlaceholderText("Patient full name"), { target: { value: "AHMAD BIN ALI" } });
    fireEvent.change(screen.getByPlaceholderText("000000-00-0000"), { target: { value: "900101010001" } });

    // Pick the drug through the combobox, then set a quantity that satisfies
    // the schema's .min(1) (the field defaults to 0).
    fireEvent.click(await screen.findByRole("combobox"));
    fireEvent.click(await screen.findByText("Amoxicillin 250mg"));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));

    // Asserted outside the waitFor: the previous version wrapped the assertion
    // in `if (calls.length > 0)`, so it passed even when insert was never
    // called — which it never was, because the form could not be completed.
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect(insertMock.mock.calls[0][0]).toHaveProperty("is_pesara", false);
  });
});
