import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClinicRequest } from "./ClinicRequest";

const KEMPAS = "00000000-0000-0000-0000-000000000001";

const update = vi.fn(() => ({ eq: eqAfterUpdate }));
const eqAfterUpdate = vi.fn(() => Promise.resolve({ error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "clinics") {
        return {
          select: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({
              data: [
                { id: KEMPAS, name: "Klinik Kesihatan Kempas" },
                { id: "clinic-2", name: "Klinik Kesihatan Skudai" },
              ],
              error: null,
            })),
          })),
        };
      }
      return { update };
    }),
  },
}));

const refreshProfile = vi.fn(() => Promise.resolve());
const signOut = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) },
}));

const { useAuth } = await import("@/contexts/AuthContext");

// Radix opens its listbox on keyboard activation; jsdom does not deliver the
// pointer sequence the mouse path expects.
function openSelect() {
  fireEvent.keyDown(screen.getByTestId("clinic-select"), { key: "Enter" });
}

function renderRequest() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "user-1" },
    refreshProfile,
    signOut,
  } as unknown as ReturnType<typeof useAuth>);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ClinicRequest />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  eqAfterUpdate.mockResolvedValue({ error: null });
});

describe("ClinicRequest", () => {
  it("offers the clinics to choose from", async () => {
    renderRequest();
    openSelect();
    await waitFor(() => expect(screen.getByText("Klinik Kesihatan Kempas")).toBeInTheDocument());
    expect(screen.getByText("Klinik Kesihatan Skudai")).toBeInTheDocument();
  });

  it("cannot be submitted before a clinic is picked", async () => {
    renderRequest();
    await waitFor(() => expect(screen.getByTestId("submit-clinic")).toBeDisabled());
  });

  it("records the choice as a request, not a grant", async () => {
    renderRequest();
    openSelect();
    await waitFor(() => expect(screen.getByText("Klinik Kesihatan Kempas")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Klinik Kesihatan Kempas"));

    fireEvent.click(screen.getByTestId("submit-clinic"));

    await waitFor(() => expect(update).toHaveBeenCalledWith({ pending_clinic_id: KEMPAS }));
    expect(eqAfterUpdate).toHaveBeenCalledWith("user_id", "user-1");
    // The waiting screen only appears once the reloaded profile says so.
    await waitFor(() => expect(refreshProfile).toHaveBeenCalled());
  });

  it("surfaces the database's own error message", async () => {
    eqAfterUpdate.mockResolvedValue({
      error: { message: "new row violates row-level security policy for table \"profiles\"" },
    });

    renderRequest();
    openSelect();
    await waitFor(() => expect(screen.getByText("Klinik Kesihatan Kempas")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Klinik Kesihatan Kempas"));
    fireEvent.click(screen.getByTestId("submit-clinic"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'new row violates row-level security policy for table "profiles"'
      )
    );
    expect(refreshProfile).not.toHaveBeenCalled();
  });
});
