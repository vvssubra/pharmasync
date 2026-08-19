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

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ user: { id: "user-1" }, profile: { clinic_id: "clinic-1" } })),
}));

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
