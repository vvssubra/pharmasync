import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReplenishQuotaDialog from "./ReplenishQuotaDialog";

// No ReplenishQuotaDialog.test.tsx existed before Task 12 (logistic-hq-quota
// plan) — this file follows the same mocking convention as the sibling
// DrugQuotaDialog.test.tsx / DrugFormDialog.test.tsx in this directory.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe("ReplenishQuotaDialog — non-controlled drug (isControlled=false, existing behavior unchanged)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the editable 'Amount to Add' field and Replenish button", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <ReplenishQuotaDialog
          open={true}
          onOpenChange={vi.fn()}
          drugId="drug-1"
          drugName="Amoxicillin"
          currentQuotaLimit={50}
          isControlled={false}
        />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Replenish Quota — Amoxicillin/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount to Add/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /replenish/i })).toBeInTheDocument();
    expect(screen.queryByText(/set nationally by pkd logistik/i)).not.toBeInTheDocument();
  });
});

describe("ReplenishQuotaDialog — controlled drug (isControlled=true, national quota is read-only)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the national quota read-only with the PKD Logistik label instead of an editable field", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <ReplenishQuotaDialog
          open={true}
          onOpenChange={vi.fn()}
          drugId="drug-1"
          drugName="Morphine"
          currentQuotaLimit={100}
          isControlled={true}
          nationalQuota={{ quota_limit: 100, used: 40, remaining: 60, alert_threshold_pct: 20 }}
        />
      </QueryClientProvider>
    );
    expect(screen.getByText(/60 \/ 100 remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/set nationally by pkd logistik/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Amount to Add/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^replenish$/i })).not.toBeInTheDocument();
  });
});

// An HQ-stationed admin has no drug_quotas write path for any drug (see
// supabase/migrations/20260819000600_drug_quotas_clinic_admin_write.sql). Extra
// hazard here: the upsert is followed by a terimaan transaction insert, so a
// mid-mutation RLS denial would leave stock and quota disagreeing.
describe("ReplenishQuotaDialog — caller stationed at the HQ clinic (no drug_quotas write path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuth(AT_HQ_CLINIC);
  });

  it("hides the Amount to Add field and Replenish button for a NON-controlled drug too", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <ReplenishQuotaDialog
          open={true}
          onOpenChange={vi.fn()}
          drugId="drug-1"
          drugName="Amoxicillin"
          currentQuotaLimit={50}
          isControlled={false}
        />
      </QueryClientProvider>
    );
    expect(screen.queryByLabelText(/Amount to Add/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^replenish$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/not replenished from the HQ clinic/i)).toBeInTheDocument();
  });

  it("still shows the national figure for a controlled drug (isControlled wins the branch)", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <ReplenishQuotaDialog
          open={true}
          onOpenChange={vi.fn()}
          drugId="drug-1"
          drugName="Morphine"
          currentQuotaLimit={100}
          isControlled={true}
          nationalQuota={{ quota_limit: 100, used: 40, remaining: 60, alert_threshold_pct: 20 }}
        />
      </QueryClientProvider>
    );
    expect(screen.getByText(/60 \/ 100 remaining/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Amount to Add/i)).not.toBeInTheDocument();
  });
});
