import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AntibioticForm from "./AntibioticForm";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: vi.fn(() => ({
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ user: { id: "mo-1" }, role: "mo" })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/hooks/usePathwayCheck", () => ({
  usePathwayCheck: () => ({ verdict: null, explanation: null, status: "idle" }),
}));
vi.mock("@/hooks/useDoseSuggestion", () => ({
  useDoseSuggestion: () => ({ matches: [], status: "idle", message: null }),
}));
vi.mock("@/lib/featureFlags", () => ({
  AI_ENABLED: false,
  AI_SUGGEST_ROLES: ["mo", "admin", "pharmacist", "super_admin"],
  PATHWAY_CHECK_ENABLED: false,
  AI_STREAMING: false,
  AI_TIMEOUT_MS: 90000,
  KNOWLEDGE_ENABLED: false,
}));

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AntibioticForm />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_fms_list") {
      return Promise.resolve({
        data: [
          { user_id: "fms-1", full_name: "Dr Norlaila Najwa" },
          { user_id: "fms-2", full_name: "Dr Rahim" },
        ],
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

describe("AntibioticForm assigned FMS", () => {
  it("lists the clinic's real FMS users, not placeholder names", async () => {
    renderForm();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_fms_list"));

    fireEvent.keyDown(screen.getByText("Select FMS"), { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Dr Norlaila Najwa")).toBeInTheDocument());
    expect(screen.getByText("Dr Rahim")).toBeInTheDocument();
    expect(screen.queryByText("Dr Amelia")).toBeNull();
    expect(screen.queryByText("Dr Muslim")).toBeNull();
  });

  it("says so when the clinic has no FMS yet", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    renderForm();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_fms_list"));

    fireEvent.keyDown(screen.getByText("Select FMS"), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Tiada FMS berdaftar/)).toBeInTheDocument());
  });
});
