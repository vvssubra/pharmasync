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

// An admin whose profile.clinic_id is the HQ clinic has NO drug_quotas write
// path for any drug — trg_stamp_clinic_id stamps the row with the HQ clinic_id
// and the write policies exclude that clinic
// (supabase/migrations/20260819000600_drug_quotas_clinic_admin_write.sql). The
// RLS denial is correct; offering the field anyway is what this guards against.
describe("DrugQuotaDialog — caller stationed at the HQ clinic (no drug_quotas write path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuth(AT_HQ_CLINIC);
  });

  it("hides the editable quota field for a NON-controlled drug too", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <DrugQuotaDialog open={true} onOpenChange={vi.fn()} drugId="drug-1" drugName="Amoxicillin" isControlled={false} />
      </QueryClientProvider>
    );
    expect(screen.queryByLabelText(/Annual Patient Quota/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save quota/i })).not.toBeInTheDocument();
    expect(screen.getByText(/not set from the HQ clinic/i)).toBeInTheDocument();
  });

  it("never issues the drug_quotas read or upsert", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    render(
      <QueryClientProvider client={makeQC()}>
        <DrugQuotaDialog open={true} onOpenChange={vi.fn()} drugId="drug-1" drugName="Amoxicillin" isControlled={false} />
      </QueryClientProvider>
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("still shows the national figure for a controlled drug (isControlled wins the branch)", () => {
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
    expect(screen.queryByLabelText(/Annual Patient Quota/i)).not.toBeInTheDocument();
  });
});
