import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AntibioticArchive from "./AntibioticArchive";
import * as md from "@/lib/antibioticMarkdown";

const acknowledgedForm = {
  id: "form-1",
  tarikh: "2026-07-20",
  patient_name: "AHMAD BIN ALI",
  patient_ic: "900101011234",
  diagnosis: "Community Acquired Pneumonia",
  assigned_fms: "Dr Amelia",
  status: "approved",
  submitted_by: "mo-1",
  acknowledged_by: "pharm-1",
  acknowledged_at: "2026-07-21T12:00:00Z",
  checklist_data: {},
};

const mockAntibioticForms = vi.fn();
const mockProfiles = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "antibiotic_forms") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              not: vi.fn(() => ({
                order: vi.fn(() => mockAntibioticForms()),
              })),
            })),
          })),
        };
      }
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => mockProfiles()),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  },
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

describe("AntibioticArchive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAntibioticForms.mockResolvedValue({ data: [acknowledgedForm], error: null });
    mockProfiles.mockResolvedValue({
      data: [
        { user_id: "mo-1", full_name: "Dr MO Fulan" },
        { user_id: "pharm-1", full_name: "Pharmacist Aiman" },
      ],
      error: null,
    });
  });

  it("renders the archive title", async () => {
    renderPage();
    expect(screen.getByText(/Arkib Borang Antibiotik/i)).toBeInTheDocument();
  });

  it("lists an acknowledged form", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("AHMAD BIN ALI")).toBeInTheDocument());
    expect(screen.getByText("Dr Amelia")).toBeInTheDocument();
  });

  it("shows empty state when no forms are returned", async () => {
    mockAntibioticForms.mockResolvedValue({ data: [], error: null });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Tiada borang antibiotik dijumpai/i)).toBeInTheDocument());
  });

  it("filters rows by search text", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("AHMAD BIN ALI")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Cari mengikut/i), { target: { value: "nonexistent" } });
    expect(screen.queryByText("AHMAD BIN ALI")).not.toBeInTheDocument();
  });

  it("opens the view dialog for a form", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("AHMAD BIN ALI")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Lihat/i }));
    await waitFor(() => expect(screen.getByText(/Borang Antibiotik — AHMAD BIN ALI/i)).toBeInTheDocument());
  });

  it("triggers markdown download when .md is clicked", async () => {
    const downloadSpy = vi.spyOn(md, "downloadMarkdown").mockImplementation(() => {});
    renderPage();
    await waitFor(() => expect(screen.getByText("AHMAD BIN ALI")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /\.md/i }));
    expect(downloadSpy).toHaveBeenCalled();
  });
});
