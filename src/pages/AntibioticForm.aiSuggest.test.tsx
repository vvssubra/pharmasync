// Suggest Antibiotic (AI) failure handling. Separate file from
// AntibioticForm.test.tsx because vi.mock is per-file and that suite pins
// AI_ENABLED to false; this one needs the button rendered.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import AntibioticForm from "./AntibioticForm";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: vi.fn(() => ({
      insert: vi.fn(() => Promise.resolve({ error: null })),
      update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          order: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      })),
    })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { access_token: "tok" } }, error: null })),
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
  AI_ENABLED: true,
  AI_SUGGEST_ROLES: ["mo", "fms", "admin", "pharmacist", "super_admin"],
  PATHWAY_CHECK_ENABLED: false,
  AI_STREAMING: false,
  AI_TIMEOUT_MS: 90000,
  KNOWLEDGE_ENABLED: false,
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/request/antibiotik"]}>
      <QueryClientProvider client={client}>
        <AntibioticForm />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

async function fillDiagnosisAndSuggest() {
  renderForm();
  await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_fms_list"));
  // Cross the CAP checklist threshold so the one-tap "Use:" hint fills
  // Diagnosis — the Suggest button is disabled until it is non-empty.
  const tick = (label: string) =>
    fireEvent.click(within(screen.getByText(label).closest("label")!).getByRole("checkbox"));
  tick("1. ACUTE COUGH / SPUTUM");
  tick("FEVER (>38°C)");
  fireEvent.click(await screen.findByRole("button", { name: /Use: Community Acquired Pneumonia/ }));
  const button = screen.getByRole("button", { name: /Suggest Antibiotic \(AI\)|Ask AI instead/ });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  rpc.mockImplementation((fn: string) =>
    Promise.resolve({ data: fn === "get_fms_list" ? [{ user_id: "fms-1", full_name: "Dr Rahim" }] : null, error: null })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Suggest Antibiotic (AI) error handling", () => {
  it("renders every option from a current-shape response", async () => {
    fetchMock.mockReturnValue(jsonResponse({
      regimens: [{ drug: "Amoxicillin", tier: "Preferred", penicillinClass: true, text: "Amoxicillin 1g PO TDS x 5 days", computed: false }],
      rationale: "NAG Community Acquired Pneumonia (CAP pathway).",
      warning: null,
      source: "rules",
    }));
    await fillDiagnosisAndSuggest();
    expect(await screen.findByText("Amoxicillin 1g PO TDS x 5 days")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not crash on the pre-2026-08-03 { suggestion } shape from a stale edge function", async () => {
    // Regression: `regimens.map` on this body threw during render and blanked
    // the whole form, so a stale server looked like "AI suggestion not working".
    fetchMock.mockReturnValue(jsonResponse({
      suggestion: "Amoxicillin 1g PO TDS x 5 days",
      rationale: "NAG CAP.",
      warning: null,
      source: "rules",
    }));
    await fillDiagnosisAndSuggest();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/outdated response/)));
    // The form is still on screen and usable.
    expect(screen.getByRole("button", { name: /Suggest Antibiotic \(AI\)|Ask AI instead/ })).toBeEnabled();
    expect(screen.queryByText("Amoxicillin 1g PO TDS x 5 days")).toBeNull();
  });

  it("surfaces the server's 403 reason instead of a generic 'unavailable'", async () => {
    fetchMock.mockReturnValue(jsonResponse({ error: "Unauthorized: your role is not permitted to use antibiotic suggestions" }, 403));
    await fillDiagnosisAndSuggest();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/refused: Unauthorized: your role is not permitted/)));
  });

  it("tells the user to sign in again on 401", async () => {
    fetchMock.mockReturnValue(jsonResponse({ error: "Invalid or expired token" }, 401));
    await fillDiagnosisAndSuggest();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/session has expired/)));
  });
});
