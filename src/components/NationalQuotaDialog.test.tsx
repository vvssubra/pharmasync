import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NationalQuotaDialog from "./NationalQuotaDialog";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe("NationalQuotaDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders dialog title with the drug name when open", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <NationalQuotaDialog
          open={true}
          onOpenChange={vi.fn()}
          drugId="drug-1"
          drugName="Insulin Glargine"
          year={2026}
          currentQuotaLimit={null}
          currentAlertThresholdPct={null}
        />
      </QueryClientProvider>
    );
    expect(screen.getByText(/National Quota — Insulin Glargine/i)).toBeInTheDocument();
  });

  it("pre-fills the quota and alert threshold inputs from props", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <NationalQuotaDialog
          open={true}
          onOpenChange={vi.fn()}
          drugId="drug-1"
          drugName="Insulin Glargine"
          year={2026}
          currentQuotaLimit={100}
          currentAlertThresholdPct={25}
        />
      </QueryClientProvider>
    );
    expect(screen.getByLabelText(/National Annual Patient Quota/i)).toHaveValue(100);
    expect(screen.getByLabelText(/Low-Quota Alert Threshold/i)).toHaveValue(25);
  });

  it("defaults the alert threshold to 20 when none is set yet", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <NationalQuotaDialog
          open={true}
          onOpenChange={vi.fn()}
          drugId="drug-1"
          drugName="Insulin Glargine"
          year={2026}
          currentQuotaLimit={null}
          currentAlertThresholdPct={null}
        />
      </QueryClientProvider>
    );
    expect(screen.getByLabelText(/Low-Quota Alert Threshold/i)).toHaveValue(20);
  });
});
