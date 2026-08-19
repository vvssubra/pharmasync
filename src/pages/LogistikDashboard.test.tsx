import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LogistikDashboard from "./LogistikDashboard";

const nationalRow = {
  clinic_id: "hq-clinic",
  drug_id: "drug-1",
  year: new Date().getFullYear(),
  quota_limit: 100,
  alert_threshold_pct: 20,
  used: 90,
  remaining: 10,
};

const clinicRow = {
  clinic_id: "clinic-a",
  clinic_name: "KK Kempas",
  drug_id: "drug-1",
  year: new Date().getFullYear(),
  used: 90,
};

const drugRow = { id: "drug-1", drug_name: "Insulin Glargine", unit_price: 45.5 };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: [drugRow], error: null })),
      })),
    })),
    // get_drug_quota_usage -> national rows; get_quota_usage_by_clinic -> per-clinic rows.
    rpc: vi.fn((fnName: string) => {
      if (fnName === "get_drug_quota_usage") {
        return Promise.resolve({ data: [nationalRow], error: null });
      }
      if (fnName === "get_quota_usage_by_clinic") {
        return Promise.resolve({ data: [clinicRow], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe("LogistikDashboard", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("renders the four summary cards", async () => {
    render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
    expect(await screen.findByText("Total Drugs")).toBeInTheDocument();
    expect(screen.getByText("Drugs at Critical Quota")).toBeInTheDocument();
    expect(screen.getByText("Drugs Available for Quota")).toBeInTheDocument();
    expect(screen.getByText("Alerts")).toBeInTheDocument();
  });

  it("renders the national quota table with drug name, formatted price and status badge", async () => {
    render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
    expect(await screen.findByText("Insulin Glargine")).toBeInTheDocument();
    expect(screen.getByText("RM 45.50")).toBeInTheDocument();
    // used=90, limit=100, alert_threshold_pct=20 -> quotaBadgeState is "warning"
    // (used >= limit * (1 - 20/100) = 80), so the badge shows the used/limit label.
    expect(screen.getByText("90/100 patients")).toBeInTheDocument();
  });

  it("expands a row to show the per-clinic breakdown", async () => {
    render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
    await screen.findByText("Insulin Glargine");
    fireEvent.click(screen.getByLabelText("Expand per-clinic breakdown"));
    expect(await screen.findByText("KK Kempas")).toBeInTheDocument();
    expect(screen.getByText("90 used")).toBeInTheDocument();
  });

  it("opens NationalQuotaDialog when Edit is clicked", async () => {
    render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
    await screen.findByText("Insulin Glargine");
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    expect(await screen.findByText(/National Quota — Insulin Glargine/i)).toBeInTheDocument();
  });

  it("filters the table to critical drugs when that card is clicked", async () => {
    render(<QueryClientProvider client={makeQC()}><LogistikDashboard /></QueryClientProvider>);
    await screen.findByText("Insulin Glargine");
    // remaining=10 of limit=100 -> 10% remaining -> quotaStatus is "critical".
    fireEvent.click(screen.getByText("Drugs at Critical Quota"));
    expect(screen.getByText("Insulin Glargine")).toBeInTheDocument();
  });
});
