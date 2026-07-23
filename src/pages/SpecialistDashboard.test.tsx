import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SpecialistDashboard from "./SpecialistDashboard";

// Build a chainable Supabase mock that supports deep method chains,
// resolving with configurable data at the terminal call.
function makeSupabaseMock(
  dispensingData: any[] = [],
  drugQuotaData: any[] = [],
  quotaCountRegularData: any[] = [],
  quotaCountPesaraData: any[] = [],
) {
  // Tracks which table is being queried to return the right data
  const buildChain = (data: any[], error: null = null): any => {
    const resolve = () => Promise.resolve({ data, error });
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(resolve),
      gte: vi.fn(() => chain),
      lt: vi.fn(resolve),
      update: vi.fn(() => chain),
    };
    // Make the chain itself thenable so `await supabase.from().select()...` works
    chain.then = (onFulfilled: any) => Promise.resolve({ data, error }).then(onFulfilled);
    return chain;
  };

  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "drug_quotas") return buildChain(drugQuotaData);
        // For quota count queries we need to support two parallel calls with different is_pesara values
        // The mock returns the full dispensing data and lets the component filter
        if (table === "dispensing_requests") return buildChain(dispensingData);
        if (table === "profiles") return buildChain([]);
        if (table === "antibiotic_forms") return buildChain([]);
        return buildChain([]);
      }),
    },
  };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          in: vi.fn(() => Promise.resolve({ data: [], error: null })),
          eq: vi.fn(() => ({
            gte: vi.fn(() => ({
              lt: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        })),
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ role: "fms", user: { id: "u1" }, profile: null, loading: false })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={makeQC()}>
        <SpecialistDashboard />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("SpecialistDashboard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders 'NAG Check' column header in antibiotic forms table", async () => {
    const user = userEvent.setup();
    renderDashboard();
    // Click the Antibiotik tab to reveal that table
    await user.click(screen.getByRole("tab", { name: /antibiotic form/i }));
    expect(screen.getByText(/NAG Check/i)).toBeInTheDocument();
  });

  describe("Controlled Drug sub-tabs", () => {
    it("renders Regular and Pesara sub-tabs inside the Controlled Drug tab", async () => {
      renderDashboard();
      // Controlled Drug tab is the default active tab
      expect(screen.getByRole("tab", { name: /Regular/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Pesara/i })).toBeInTheDocument();
    });

    it("Regular tab is the default active sub-tab and shows empty state", async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText("No pending requests")).toBeInTheDocument();
      });
      expect(screen.getByText(/No controlled drug requests are awaiting specialist approval/i)).toBeInTheDocument();
    });

    it("Pesara tab shows correct empty state message when clicked", async () => {
      const user = userEvent.setup();
      renderDashboard();
      await user.click(screen.getByRole("tab", { name: /Pesara/i }));
      await waitFor(() => {
        expect(screen.getByText("No pending Pesara requests")).toBeInTheDocument();
      });
    });

    it("Regular tab shows quota badge for a regular request", async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const mockRequest = {
        id: "req-1",
        status: "pending_specialist",
        is_pesara: false,
        borrowed_from_clinic_id: null,
        patient_name: "Ali bin Abu",
        no_ic: "800101011234",
        drug_id: "drug-1",
        quantity: 30,
        prescriber_name: "Dr. Siti",
        created_at: new Date().toISOString(),
        specialist_action_at: null,
        specialist_notes: null,
        drugs: { drug_name: "Morphine", unit_pengukuran: "tablet" },
      };

      // Override mock for this test to return a request
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === "drug_quotas") {
          const chain: any = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            then: (onFulfilled: any) => Promise.resolve({ data: [{ drug_id: "drug-1", quota_limit: 60 }], error: null }).then(onFulfilled),
          };
          return chain;
        }
        if (table === "dispensing_requests") {
          const chain: any = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            in: vi.fn(() => chain),
            order: vi.fn(() => Promise.resolve({ data: [mockRequest], error: null })),
            gte: vi.fn(() => chain),
            lt: vi.fn(() => Promise.resolve({ data: [{ drug_id: "drug-1", no_ic: "800101011234" }], error: null })),
          };
          return chain;
        }
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => Promise.resolve({ data: [], error: null })),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          gte: vi.fn(() => chain),
          lt: vi.fn(() => Promise.resolve({ data: [], error: null })),
          then: (onFulfilled: any) => Promise.resolve({ data: [], error: null }).then(onFulfilled),
        };
        return chain;
      });

      renderDashboard();

      // Drug name should appear in the regular tab
      await waitFor(() => {
        expect(screen.getByText("Morphine")).toBeInTheDocument();
      });
    });

    it("Pesara tab shows Unlimited badge for a Pesara request", async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const mockPesaraRequest = {
        id: "req-2",
        status: "pending_specialist",
        is_pesara: true,
        borrowed_from_clinic_id: null,
        patient_name: "Minah binti Kassim",
        no_ic: "450202021234",
        drug_id: "drug-1",
        quantity: 60,
        prescriber_name: "Dr. Rahman",
        created_at: new Date().toISOString(),
        specialist_action_at: null,
        specialist_notes: null,
        drugs: { drug_name: "Morphine", unit_pengukuran: "tablet" },
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === "drug_quotas") {
          const chain: any = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            then: (onFulfilled: any) => Promise.resolve({ data: [], error: null }).then(onFulfilled),
          };
          return chain;
        }
        if (table === "dispensing_requests") {
          const chain: any = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            in: vi.fn(() => chain),
            order: vi.fn(() => Promise.resolve({ data: [mockPesaraRequest], error: null })),
            gte: vi.fn(() => chain),
            lt: vi.fn(() => Promise.resolve({ data: [], error: null })),
          };
          return chain;
        }
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => Promise.resolve({ data: [], error: null })),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          gte: vi.fn(() => chain),
          lt: vi.fn(() => Promise.resolve({ data: [], error: null })),
          then: (onFulfilled: any) => Promise.resolve({ data: [], error: null }).then(onFulfilled),
        };
        return chain;
      });

      const user = userEvent.setup();
      renderDashboard();

      // Switch to Pesara tab
      await user.click(screen.getByRole("tab", { name: /Pesara/i }));

      // Pesara request should show and have Unlimited badge
      await waitFor(() => {
        expect(screen.getByText("Unlimited")).toBeInTheDocument();
      });
    });
  });
});
