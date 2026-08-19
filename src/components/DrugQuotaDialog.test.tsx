import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DrugQuotaDialog from "./DrugQuotaDialog";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        // drug_quotas is clinic-scoped now, so the read chains a third .eq
        // for clinic_id: .eq("drug_id").eq("year").eq("clinic_id").
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: { quota_limit: 60, alert_threshold_pct: 20 }, error: null })),
            })),
          })),
        })),
      })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
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

describe("DrugQuotaDialog — non-controlled drug (isControlled=false, existing behavior unchanged)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders dialog title when open", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <DrugQuotaDialog open={true} onOpenChange={vi.fn()} drugId="drug-1" drugName="Morphine" isControlled={false} />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Annual Quota — Morphine/i)).toBeInTheDocument();
  });

  it("renders an editable quota input field", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <DrugQuotaDialog open={true} onOpenChange={vi.fn()} drugId="drug-1" drugName="Morphine" isControlled={false} />
      </QueryClientProvider>
    );
    expect(screen.getByLabelText(/Annual Patient Quota/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save quota/i })).toBeInTheDocument();
  });
});

describe("DrugQuotaDialog — controlled drug (isControlled=true, national quota is read-only)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the national quota read-only with the PKD Logistik label instead of an editable field", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <DrugQuotaDialog
          open={true}
          onOpenChange={vi.fn()}
          drugId="drug-1"
          drugName="Morphine"
          isControlled={true}
          nationalQuota={{ quota_limit: 100, used: 40, remaining: 60, alert_threshold_pct: 20 }}
        />
      </QueryClientProvider>
    );
    expect(screen.getByText(/60 \/ 100 remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/set nationally by pkd logistik/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Annual Patient Quota/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save quota/i })).not.toBeInTheDocument();
  });

  it("does not render an editable field even without a national quota loaded yet", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <DrugQuotaDialog open={true} onOpenChange={vi.fn()} drugId="drug-1" drugName="Morphine" isControlled={true} />
      </QueryClientProvider>
    );
    expect(screen.getByText(/no national quota set/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Annual Patient Quota/i)).not.toBeInTheDocument();
  });
});
