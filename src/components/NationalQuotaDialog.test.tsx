import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NationalQuotaDialog from "./NationalQuotaDialog";

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(() => Promise.resolve({ data: null, error: null })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderDialog(props: Partial<React.ComponentProps<typeof NationalQuotaDialog>> = {}) {
  return render(
    <QueryClientProvider client={makeQC()}>
      <NationalQuotaDialog
        open={true}
        onOpenChange={vi.fn()}
        drugId="drug-1"
        drugName="Insulin Glargine"
        year={2026}
        currentFmsCount={null}
        currentQuotaPerFms={null}
        currentQuotaLimit={null}
        currentAlertThresholdPct={null}
        {...props}
      />
    </QueryClientProvider>
  );
}

describe("NationalQuotaDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders dialog title with the drug name when open", () => {
    renderDialog();
    expect(screen.getByText(/National Quota — Insulin Glargine/i)).toBeInTheDocument();
  });

  it("pre-fills FMS count and quota-per-FMS from props", () => {
    renderDialog({ currentFmsCount: 29, currentQuotaPerFms: 10, currentAlertThresholdPct: 25 });
    expect(screen.getByLabelText(/FMS Count/i)).toHaveValue(29);
    expect(screen.getByLabelText(/Quota per FMS/i)).toHaveValue(10);
    expect(screen.getByLabelText(/Low-Quota Alert Threshold/i)).toHaveValue(25);
  });

  it("defaults FMS count to 29 and leaves quota-per-FMS blank when neither is set yet", () => {
    renderDialog();
    expect(screen.getByLabelText(/FMS Count/i)).toHaveValue(29);
    expect(screen.getByLabelText(/Quota per FMS/i)).toHaveValue(null);
  });

  it("defaults the alert threshold to 20 when none is set yet", () => {
    renderDialog();
    expect(screen.getByLabelText(/Low-Quota Alert Threshold/i)).toHaveValue(20);
  });

  it("shows a legacy-total note when a raw quota_limit exists but hasn't been broken into FMS x quota yet", () => {
    renderDialog({ currentQuotaLimit: 100 });
    expect(screen.getByText(/current enforced total: 100/i)).toBeInTheDocument();
  });

  it("does not show the legacy-total note once FMS count/quota-per-FMS are already set", () => {
    renderDialog({ currentFmsCount: 29, currentQuotaPerFms: 10, currentQuotaLimit: 290 });
    expect(screen.queryByText(/current enforced total/i)).not.toBeInTheDocument();
  });

  it("computes and displays the live total as FMS count x quota per FMS change", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/Quota per FMS/i), { target: { value: "10" } });
    expect(screen.getByText(/=\s*290\s*total/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/FMS Count/i), { target: { value: "5" } });
    expect(screen.getByText(/=\s*50\s*total/i)).toBeInTheDocument();
  });

  it("saves fms_count and quota_per_fms via set_national_drug_quota, not a raw quota_limit", async () => {
    renderDialog({ currentAlertThresholdPct: 20 });
    fireEvent.change(screen.getByLabelText(/Quota per FMS/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /save national quota/i }));

    await vi.waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(rpcMock).toHaveBeenCalledWith("set_national_drug_quota", {
      p_drug_id: "drug-1",
      p_year: 2026,
      p_fms_count: 29,
      p_quota_per_fms: 10,
      p_alert_threshold_pct: 20,
    });
  });

  it("disables save until quota-per-FMS is filled in", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: /save national quota/i })).toBeDisabled();
  });
});
