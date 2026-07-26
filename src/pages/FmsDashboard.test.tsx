import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FmsDashboard from "./FmsDashboard";

// The ytdCounts query now calls:
//   .select("drug_id, no_ic").eq("status", "fulfilled").eq("is_pesara", false).gte(...).lt(...)
// The pesaraCounts query calls:
//   .select("drug_id, no_ic").eq("status", "fulfilled").eq("is_pesara", true).gte(...).lt(...)
// Both return empty arrays; the mock chain must handle three chained .eq() calls.

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({ data: [], error: null })),
              gte: vi.fn(() => ({ lt: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
            })),
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
            gte: vi.fn(() => ({ lt: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
            in: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          gte: vi.fn(() => ({ lt: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
          in: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
    // Quota usage now comes from the get_drug_quota_usage RPC (see
    // src/hooks/useDrugQuotaUsage.ts), not a hand-rolled drug_quotas query.
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ role: "fms", profile: null, user: null, loading: false })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe("FmsDashboard sections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders Controlled Drug Annual Quota section", () => {
    render(<MemoryRouter><QueryClientProvider client={makeQC()}><FmsDashboard /></QueryClientProvider></MemoryRouter>);
    expect(screen.getByText(/Controlled Drug Annual Quota/i)).toBeInTheDocument();
  });

  it("renders Non-Controlled Stock Forecast section", () => {
    render(<MemoryRouter><QueryClientProvider client={makeQC()}><FmsDashboard /></QueryClientProvider></MemoryRouter>);
    expect(screen.getByText(/Non-Controlled Stock Forecast/i)).toBeInTheDocument();
  });

  it("renders Pesara column header in annual quota table", async () => {
    render(<MemoryRouter><QueryClientProvider client={makeQC()}><FmsDashboard /></QueryClientProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Pesara")).toBeInTheDocument());
  });
});
