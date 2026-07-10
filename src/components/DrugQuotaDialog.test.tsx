import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DrugQuotaDialog from "./DrugQuotaDialog";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: { quota_limit: 60 }, error: null })),
          })),
        })),
      })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ user: { id: "user-1" } })),
}));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe("DrugQuotaDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders dialog title when open", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <DrugQuotaDialog open={true} onOpenChange={vi.fn()} drugId="drug-1" drugName="Morphine" />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Annual Quota — Morphine/i)).toBeInTheDocument();
  });

  it("renders quota input field", () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <DrugQuotaDialog open={true} onOpenChange={vi.fn()} drugId="drug-1" drugName="Morphine" />
      </QueryClientProvider>
    );
    expect(screen.getByLabelText(/Annual Patient Quota/i)).toBeInTheDocument();
  });
});
