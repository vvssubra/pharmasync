import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Clinics from "./Clinics";

const KEMPAS = "clinic-kempas";
const LARKIN = "clinic-larkin";
const HQ = "clinic-hq";

const mockState: {
  clinics: unknown[];
  users: unknown[];
  insertError: unknown;
  updateError: unknown;
} = { clinics: [], users: [], insertError: null, updateError: null };

const insert = vi.fn(() => Promise.resolve({ error: mockState.insertError }));
const updateEq = vi.fn(() => Promise.resolve({ error: mockState.updateError }));
const update = vi.fn(() => ({ eq: updateEq }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => {
      const builder = {
        select: vi.fn(() => builder),
        order: vi.fn(() => Promise.resolve({ data: mockState.clinics, error: null })),
        insert: (...args: unknown[]) => insert(...(args as [])),
        update: (...args: unknown[]) => update(...(args as [])),
      };
      return builder;
    }),
    rpc: vi.fn(() => Promise.resolve({ data: mockState.users, error: null })),
  },
}));

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

function renderClinics() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Clinics />
    </QueryClientProvider>
  );
}

/** The row whose first cell names this clinic. */
function rowFor(name: string) {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.insertError = null;
  mockState.updateError = null;
  mockState.clinics = [
    { id: KEMPAS, name: "KK Kempas", is_hq: false },
    { id: LARKIN, name: "KK Larkin", is_hq: false },
    { id: HQ, name: "Logistik PKDJB", is_hq: true },
  ];
  mockState.users = [
    { clinic_id: KEMPAS, role: "admin" },
    { clinic_id: KEMPAS, role: "fms" },
    { clinic_id: KEMPAS, role: "mo" },
    { clinic_id: KEMPAS, role: "mo" },
    { clinic_id: KEMPAS, role: "pharmacist" },
    // Larkin is provisioned except for an FMS — the one gap that actually
    // breaks the clinic.
    { clinic_id: LARKIN, role: "admin" },
    { clinic_id: LARKIN, role: "mo" },
    { clinic_id: HQ, role: "logistic_pharmacist" },
  ];
});

describe("Clinics — provisioning checklist", () => {
  it("counts each clinical role per clinic", async () => {
    renderClinics();
    const kempas = await waitFor(() => rowFor("KK Kempas"));
    expect(within(kempas).getByText("Admin 1")).toBeInTheDocument();
    expect(within(kempas).getByText("FMS 1")).toBeInTheDocument();
    expect(within(kempas).getByText("MO 2")).toBeInTheDocument();
    expect(within(kempas).getByText("Pharmacist 1")).toBeInTheDocument();
  });

  // AntibioticForm refuses to submit without an assigned FMS and its dropdown
  // is scoped to the submitter's own clinic, so a clinic with none leaves every
  // MO permanently unable to file one. It has to read as an error, not a zero.
  it("flags a clinic with no FMS as broken", async () => {
    renderClinics();
    const larkin = await waitFor(() => rowFor("KK Larkin"));
    expect(within(larkin).getByText("FMS 0")).toBeInTheDocument();
    expect(within(larkin).getByText(/No FMS/i)).toBeInTheDocument();
  });

  it("does not flag a clinic that has an FMS", async () => {
    renderClinics();
    const kempas = await waitFor(() => rowFor("KK Kempas"));
    expect(within(kempas).queryByText(/No FMS/i)).not.toBeInTheDocument();
  });

  // HQ is staffed by logistic pharmacists and sees no patients, so "no FMS" is
  // its normal state rather than a fault to escalate.
  it("does not flag the HQ clinic for having no FMS", async () => {
    renderClinics();
    const hq = await waitFor(() => rowFor("Logistik PKDJB"));
    expect(within(hq).queryByText(/No FMS/i)).not.toBeInTheDocument();
  });
});

describe("Clinics — what this page deliberately cannot do", () => {
  // clinics.id is referenced without cascade by profiles and eight other
  // tables: deleting a used clinic is a raw 23503 the UI cannot explain.
  it("offers no way to delete a clinic", async () => {
    renderClinics();
    await waitFor(() => rowFor("KK Kempas"));
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/remove/i)).not.toBeInTheDocument();
  });

  // Moving is_hq makes hq_clinic_id() return null, and
  // enforce_dispensing_request_limits() then fails closed on EVERY
  // controlled-drug request at EVERY clinic.
  it("shows is_hq as a read-only badge, with no control to change it", async () => {
    renderClinics();
    const hq = await waitFor(() => rowFor("Logistik PKDJB"));
    expect(within(hq).getByText("HQ")).toBeInTheDocument();
    expect(within(hq).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(hq).queryByRole("switch")).not.toBeInTheDocument();
  });
});

describe("Clinics — create and rename", () => {
  it("creates a clinic with the name given", async () => {
    renderClinics();
    fireEvent.click(screen.getByRole("button", { name: /add clinic/i }));
    fireEvent.change(screen.getByLabelText("Clinic Name"), { target: { value: "  KK Skudai  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(insert).toHaveBeenCalledWith({ name: "KK Skudai" }));
  });

  // clinics_name_key is unique on lower(name) (20260821000300). Raw, 23505
  // surfaces as an index name the user cannot act on.
  it("explains a duplicate name instead of leaking the constraint error", async () => {
    mockState.insertError = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "clinics_name_key"',
    };
    renderClinics();
    fireEvent.click(screen.getByRole("button", { name: /add clinic/i }));
    fireEvent.change(screen.getByLabelText("Clinic Name"), { target: { value: "KK Larkin" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("A clinic with that name already exists.")).toBeInTheDocument();
    expect(screen.queryByText(/clinics_name_key/)).not.toBeInTheDocument();
  });

  it("renames the clinic whose row the action came from", async () => {
    renderClinics();
    const larkin = await waitFor(() => rowFor("KK Larkin"));
    fireEvent.click(within(larkin).getByRole("button", { name: /rename/i }));

    const field = screen.getByLabelText("Clinic Name");
    expect(field).toHaveValue("KK Larkin");
    fireEvent.change(field, { target: { value: "KK Larkin Baru" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith({ name: "KK Larkin Baru" }));
    expect(updateEq).toHaveBeenCalledWith("id", LARKIN);
  });

  it("will not save a rename that changes nothing", async () => {
    renderClinics();
    const larkin = await waitFor(() => rowFor("KK Larkin"));
    fireEvent.click(within(larkin).getByRole("button", { name: /rename/i }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
