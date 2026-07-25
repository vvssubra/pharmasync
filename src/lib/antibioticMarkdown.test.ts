import { describe, it, expect, vi, afterEach } from "vitest";
import { antibioticFormFilename, downloadMarkdown, formToMarkdown, type AntibioticFormRecord } from "./antibioticMarkdown";

const baseForm: AntibioticFormRecord = {
  tarikh: "2026-07-20",
  patient_name: "AHMAD BIN ALI",
  patient_ic: "900101-01-1234",
  diagnosis: "Community Acquired Pneumonia",
  prescription_unit: "OPD",
  assigned_fms: "Dr Amelia",
  drug_allergy: true,
  drug_allergy_detail: "Penicillin",
  antibiotic_regimen: "Amoxicillin 500mg TDS x 5 days",
  fms_code: "FMS123",
  health_ed_compliance: true,
  health_ed_sideeffect: false,
  health_ed_tca: true,
  checklist_data: {
    pneumonia: { acute_cough: true, fever: true, consolidation: true },
    pharyngitis: { temp: 1, no_cough: 1, adenopathy: 0, exudate: 0, age_score: 1, total_score: 3 },
    uti: { pregnancy_culture: "Negative" },
  },
  prescriber_notes: "Follow up in 3 days",
  status: "approved",
  submitted_by_name: "Dr MO Fulan",
  specialist_action_at: "2026-07-21T10:00:00Z",
  acknowledged_by_name: "Pharmacist Aiman",
  acknowledged_at: "2026-07-21T12:00:00Z",
};

describe("formToMarkdown", () => {
  it("includes patient details section", () => {
    const md = formToMarkdown(baseForm);
    expect(md).toContain("# Antibiotic Checklist — AHMAD BIN ALI");
    expect(md).toContain("- IC: 900101-01-1234");
    expect(md).toContain("- Diagnosis: Community Acquired Pneumonia");
    expect(md).toContain("- Assigned FMS: Dr Amelia");
  });

  it("renders drug allergy detail and antibiotic regimen", () => {
    const md = formToMarkdown(baseForm);
    expect(md).toContain("Yes — Penicillin");
    expect(md).toContain("Amoxicillin 500mg TDS x 5 days");
    expect(md).toContain("FMS Code: FMS123");
  });

  it("renders checklist ticks and the Centor total", () => {
    const md = formToMarkdown(baseForm);
    expect(md).toContain("- Acute Cough/Sputum: ✓");
    expect(md).toContain("- Tachycardia: ✗");
    expect(md).toContain("**Total Centor Score: 3**");
  });

  it("includes prescriber notes when present", () => {
    const md = formToMarkdown(baseForm);
    expect(md).toContain("## Prescriber's Notes");
    expect(md).toContain("Follow up in 3 days");
  });

  it("omits prescriber notes section when absent", () => {
    const md = formToMarkdown({ ...baseForm, prescriber_notes: null });
    expect(md).not.toContain("## Prescriber's Notes");
  });

  it("includes the audit trail footer", () => {
    const md = formToMarkdown(baseForm);
    expect(md).toContain("## Audit Trail");
    expect(md).toContain("- Submitted by: Dr MO Fulan");
    expect(md).toContain("- Acknowledged by: Pharmacist Aiman");
    expect(md).toContain("- Acknowledged at: 2026-07-21T12:00:00Z");
  });

  it("falls back to em dash for missing optional fields", () => {
    const md = formToMarkdown({
      tarikh: "2026-07-20",
      patient_name: "TEST",
      patient_ic: "000000-00-0000",
      diagnosis: "Test",
    });
    expect(md).toContain("- Assigned FMS: —");
    expect(md).toContain("- Antibiotic Regimen: —");
    expect(md).toContain("No / NKDA");
  });
});

describe("antibioticFormFilename", () => {
  it("builds a filesystem-safe filename from IC and date", () => {
    expect(antibioticFormFilename({ patient_ic: "900101-01-1234", tarikh: "2026-07-20" }))
      .toBe("antibiotik_900101-01-1234_2026-07-20.md");
  });

  it("falls back to 'unknown' when fields are missing", () => {
    expect(antibioticFormFilename({ patient_ic: "", tarikh: "" })).toBe("antibiotik_unknown_unknown.md");
  });
});

type UrlFileApi = { createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void };
const urlWithFileApi = URL as unknown as UrlFileApi;

describe("downloadMarkdown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete urlWithFileApi.createObjectURL;
    delete urlWithFileApi.revokeObjectURL;
  });

  it("creates an object URL, triggers a click, and revokes the URL", () => {
    const createUrl = vi.fn(() => "blob:mock-url");
    const revokeUrl = vi.fn();
    urlWithFileApi.createObjectURL = createUrl;
    urlWithFileApi.revokeObjectURL = revokeUrl;
    const clickSpy = vi.fn();
    const appendSpy = vi.spyOn(document.body, "appendChild").mockImplementation((node: Node) => { (node as HTMLAnchorElement).click = clickSpy; return node; });
    const removeSpy = vi.spyOn(document.body, "removeChild").mockImplementation((node: Node) => node);

    downloadMarkdown("test.md", "# Hello");

    expect(createUrl).toHaveBeenCalled();
    expect(appendSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledWith("blob:mock-url");
  });
});
