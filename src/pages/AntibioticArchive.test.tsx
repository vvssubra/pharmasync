import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AntibioticArchive from "./AntibioticArchive";
import * as md from "@/lib/antibioticMarkdown";

const acknowledgedForm = {
  id: "form-1",
  tarikh: "2026-07-15",
  patient_name: "AHMAD BIN ALI",
  patient_ic: "900101011234",
  diagnosis: "Community Acquired Pneumonia",
  assigned_fms: "Dr Amelia",
  status: "approved",
  submitted_by: "mo-1",
  acknowledged_by: "pharm-1",
  acknowledged_at: "2026-07-15T12:00:00Z",
  checklist_data: {},
};

const acknowledgedFormPrevDay = {
  ...acknowledgedForm,
  id: "form-2",
  tarikh: "2026-07-14",
  patient_name: "SITI BINTI OMAR",
  acknowledged_at: "2026-07-14T12:00:00Z",
};

// Fluent Supabase-like chain: every filter method returns the same object, so
// new methods (`.gte`, `.lte`, a second `.order`) never need mock updates.
// Awaiting the chain resolves with `data` via `then`.
function chainOf(resolver: () => Promise<{ data: unknown[]; error: null }>) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "gte", "lte", "order", "in"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) =>
    resolver().then(onFulfilled);
  return chain;
}

const mockAntibioticForms = vi.fn();
const mockProfiles = vi.fn();
// Wraps `supabase.from` itself so tests can assert the query never ran while
// the page is in its empty, no-period-selected state.
const mockFrom = vi.fn((table: string) => {
  if (table === "antibiotic_forms") return chainOf(mockAntibioticForms);
  if (table === "profiles") return chainOf(mockProfiles);
  throw new Error(`Unexpected table ${table}`);
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={makeQC()}>
        <AntibioticArchive />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const selectPeriod = (name: RegExp) => fireEvent.click(screen.getByRole("radio", { name }));

describe("AntibioticArchive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T10:00:00Z")); // Wednesday
    mockAntibioticForms.mockResolvedValue({ data: [acknowledgedForm], error: null });
    mockProfiles.mockResolvedValue({
      data: [
        { user_id: "mo-1", full_name: "Dr MO Fulan" },
        { user_id: "pharm-1", full_name: "Pharmacist Aiman" },
      ],
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the archive title", async () => {
    renderPage();
    expect(screen.getByText(/Abx Archive/i)).toBeInTheDocument();
  });

  it("renders no records and prompts for a period on load", async () => {
    renderPage();
    expect(screen.getByText(/Choose a period to begin/i)).toBeInTheDocument();
    expect(screen.queryByText("AHMAD BIN ALI")).not.toBeInTheDocument();
    await Promise.resolve();
    expect(mockFrom).not.toHaveBeenCalledWith("antibiotic_forms");
  });

  it("selecting a period reveals rows", async () => {
    renderPage();
    await selectPeriod(/Today/i);
    await waitFor(() => expect(screen.getByText("AHMAD BIN ALI")).toBeInTheDocument());
    expect(screen.getByText("Dr Amelia")).toBeInTheDocument();
    expect(mockFrom).toHaveBeenCalledWith("antibiotic_forms");
  });

  it("shows empty state when no forms are returned in the period", async () => {
    mockAntibioticForms.mockResolvedValue({ data: [], error: null });
    renderPage();
    await selectPeriod(/This Month/i);
    await waitFor(() => expect(screen.getByText(/No antibiotic forms in this period/i)).toBeInTheDocument());
  });

  it("groups rows into collapsible day sections with per-day counts", async () => {
    mockAntibioticForms.mockResolvedValue({ data: [acknowledgedForm, acknowledgedFormPrevDay], error: null });
    renderPage();
    await selectPeriod(/This Month/i);
    await waitFor(() => expect(screen.getByText("AHMAD BIN ALI")).toBeInTheDocument());
    expect(screen.getByText("SITI BINTI OMAR")).toBeInTheDocument();

    const todayHeader = screen.getByRole("button", { name: /Today/i });
    const yesterdayHeader = screen.getByRole("button", { name: /Yesterday/i });
    expect(todayHeader).toBeInTheDocument();
    expect(yesterdayHeader).toBeInTheDocument();
    expect(screen.getAllByText(/1 form\b/)).toHaveLength(2);

    fireEvent.click(yesterdayHeader);
    expect(screen.queryByText("SITI BINTI OMAR")).not.toBeInTheDocument();
    expect(screen.getByText("AHMAD BIN ALI")).toBeInTheDocument();
  });

  it("filters rows by search text", async () => {
    renderPage();
    await selectPeriod(/Today/i);
    await waitFor(() => expect(screen.getByText("AHMAD BIN ALI")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Search by patient/i), { target: { value: "nonexistent" } });
    expect(screen.queryByText("AHMAD BIN ALI")).not.toBeInTheDocument();
    expect(screen.getByText(/No form matches/i)).toBeInTheDocument();
  });

  it("custom range waits for both dates before loading", async () => {
    renderPage();
    await selectPeriod(/Custom/i);
    expect(screen.getByText(/Pick both a start and an end date/i)).toBeInTheDocument();
    expect(mockFrom).not.toHaveBeenCalledWith("antibiotic_forms");
  });

  it("opens the view dialog for a form", async () => {
    renderPage();
    await selectPeriod(/Today/i);
    await waitFor(() => expect(screen.getByText("AHMAD BIN ALI")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /View/i }));
    await waitFor(() => expect(screen.getByText(/Antibiotic Form — AHMAD BIN ALI/i)).toBeInTheDocument());
  });

  it("triggers markdown download when .md is clicked", async () => {
    const downloadSpy = vi.spyOn(md, "downloadMarkdown").mockImplementation(() => {});
    renderPage();
    await selectPeriod(/Today/i);
    await waitFor(() => expect(screen.getByText("AHMAD BIN ALI")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /\.md/i }));
    expect(downloadSpy).toHaveBeenCalled();
  });
});
