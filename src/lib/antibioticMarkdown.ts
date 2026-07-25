/**
 * Renders an `antibiotic_forms` row as a human-readable Markdown snapshot and
 * triggers a browser download. Used by the antibiotic form archive so a
 * completed form can leave the app as a portable file (MOH / medico-legal
 * record) without duplicating the row into a second server-side store.
 *
 * Field mapping mirrors src/components/AntibioticFormReadOnly.tsx so the
 * exported text matches what is shown on screen.
 */

interface ChecklistPneumonia {
  acute_cough?: boolean;
  tachycardia?: boolean;
  tachypnoea?: boolean;
  fever?: boolean;
  hypoxemia?: boolean;
  consolidation?: boolean;
}

interface ChecklistAom {
  otalgia?: boolean;
  urti?: boolean;
  fever?: boolean;
  poor_appetite?: boolean;
  crying?: boolean;
  vomiting?: boolean;
  otoscopy_sign?: string;
}

interface ChecklistPharyngitis {
  temp?: number;
  no_cough?: number;
  adenopathy?: number;
  exudate?: number;
  age_score?: number;
  total_score?: number;
}

interface ChecklistRhinosinusitis {
  nasal_obstruction?: boolean;
  smell_loss?: boolean;
  fever?: boolean;
  discoloured_mucus?: boolean;
  double_sickening?: boolean;
  severe_pain?: boolean;
  raised_esr?: boolean;
}

interface ChecklistSsti {
  erythema?: boolean;
  abscess_incision?: boolean;
  inadequate_drainage?: boolean;
  extensive_cellulitis?: boolean;
  valvular_heart?: boolean;
  diabetes?: boolean;
  impetigo_localised?: boolean;
  impetigo_generalised?: boolean;
  cellulitis?: boolean;
}

interface ChecklistUti {
  nit_positive?: boolean;
  leu_positive?: boolean;
  frequency?: boolean;
  dysuria?: boolean;
  hematuria?: boolean;
  suprapubic?: boolean;
  urgency?: boolean;
  polyuria?: boolean;
  pregnancy_culture?: string;
}

export interface AntibioticFormRecord {
  tarikh: string;
  patient_name: string;
  patient_ic: string;
  patient_weight_kg?: number | null;
  diagnosis: string;
  prescription_unit?: string | null;
  assigned_fms?: string | null;
  drug_allergy?: boolean | null;
  drug_allergy_detail?: string | null;
  antibiotic_regimen?: string | null;
  fms_code?: string | null;
  health_ed_compliance?: boolean | null;
  health_ed_sideeffect?: boolean | null;
  health_ed_tca?: boolean | null;
  checklist_data?: {
    pneumonia?: ChecklistPneumonia;
    aom?: ChecklistAom;
    pharyngitis?: ChecklistPharyngitis;
    rhinosinusitis?: ChecklistRhinosinusitis;
    ssti?: ChecklistSsti;
    uti?: ChecklistUti;
  } | null;
  prescriber_notes?: string | null;
  status?: string | null;
  submitted_by_name?: string | null;
  specialist_action_at?: string | null;
  acknowledged_by_name?: string | null;
  acknowledged_at?: string | null;
}

function tick(value: boolean | undefined): string {
  return value ? "✓" : "✗";
}

function score(items: Array<{ label: string; checked?: boolean }>): string {
  return items.map(i => `- ${i.label}: ${tick(i.checked)}`).join("\n");
}

export function formToMarkdown(form: AntibioticFormRecord): string {
  const c = form.checklist_data || {};
  const pn = c.pneumonia || {};
  const aom = c.aom || {};
  const ph = c.pharyngitis || {};
  const rs = c.rhinosinusitis || {};
  const ssti = c.ssti || {};
  const uti = c.uti || {};

  const lines: string[] = [];

  lines.push(`# Antibiotic Checklist — ${form.patient_name}`);
  lines.push("");
  lines.push("## Section 1: Patient Details");
  lines.push(`- Date: ${form.tarikh}`);
  lines.push(`- Name: ${form.patient_name}`);
  lines.push(`- IC: ${form.patient_ic}`);
  if (form.patient_weight_kg) lines.push(`- Weight (kg): ${form.patient_weight_kg}`);
  lines.push(`- Diagnosis: ${form.diagnosis}`);
  lines.push(`- Unit: ${form.prescription_unit || "—"}`);
  lines.push(`- Assigned FMS: ${form.assigned_fms || "—"}`);
  lines.push(`- Drug Allergy: ${form.drug_allergy ? `Yes — ${form.drug_allergy_detail || ""}` : "No / NKDA"}`);
  lines.push(`- Antibiotic Regimen: ${form.antibiotic_regimen || "—"}`);
  if (form.fms_code) lines.push(`- FMS Code: ${form.fms_code}`);
  lines.push(`- Health Ed — Compliance: ${tick(!!form.health_ed_compliance)}, Side-effect: ${tick(!!form.health_ed_sideeffect)}, TCA: ${tick(!!form.health_ed_tca)}`);
  lines.push("");

  lines.push("## Section 2: Clinical Review");
  lines.push("");
  lines.push("### Pneumonia");
  lines.push(score([
    { label: "Acute Cough/Sputum", checked: pn.acute_cough },
    { label: "Tachycardia", checked: pn.tachycardia },
    { label: "Tachypnoea", checked: pn.tachypnoea },
    { label: "Fever >38°C", checked: pn.fever },
    { label: "Hypoxemia", checked: pn.hypoxemia },
    { label: "Consolidation", checked: pn.consolidation },
  ]));
  lines.push("");

  lines.push("### Acute Otitis Media");
  lines.push(score([
    { label: "Otalgia", checked: aom.otalgia },
    { label: "URTI", checked: aom.urti },
    { label: "Fever >38", checked: aom.fever },
    { label: "Poor Appetite", checked: aom.poor_appetite },
    { label: "Crying/Irritable", checked: aom.crying },
    { label: "Vomiting/Diarrhea", checked: aom.vomiting },
  ]));
  lines.push(`- Otoscopy AOM sign: ${aom.otoscopy_sign || "—"}`);
  lines.push("");

  lines.push("### Pharyngitis (Centor Score)");
  lines.push(`- Temperature >38°C: ${ph.temp ?? 0}`);
  lines.push(`- Absence of Cough: ${ph.no_cough ?? 0}`);
  lines.push(`- Cervical Adenopathy: ${ph.adenopathy ?? 0}`);
  lines.push(`- Tonsilar Exudate: ${ph.exudate ?? 0}`);
  lines.push(`- Age Score: ${ph.age_score ?? 0}`);
  lines.push(`- **Total Centor Score: ${ph.total_score ?? 0}**`);
  lines.push("");

  lines.push("### Rhinosinusitis");
  lines.push(score([
    { label: "Nasal Obstruction", checked: rs.nasal_obstruction },
    { label: "Loss of Smell", checked: rs.smell_loss },
    { label: "Fever >38°C", checked: rs.fever },
    { label: "Discoloured Mucus", checked: rs.discoloured_mucus },
    { label: "Double Sickening", checked: rs.double_sickening },
    { label: "Severe Pain", checked: rs.severe_pain },
    { label: "Raised ESR/CRP", checked: rs.raised_esr },
  ]));
  lines.push("");

  lines.push("### Skin and Soft Tissue Infection (SSTI)");
  lines.push(score([
    { label: "Erythema/Swelling/Pain", checked: ssti.erythema },
    { label: "I&D Done", checked: ssti.abscess_incision },
    { label: "Inadequate Drainage", checked: ssti.inadequate_drainage },
    { label: "Extensive Cellulitis", checked: ssti.extensive_cellulitis },
    { label: "Valvular Heart Disease", checked: ssti.valvular_heart },
    { label: "Diabetes", checked: ssti.diabetes },
    { label: "Impetigo Localised", checked: ssti.impetigo_localised },
    { label: "Impetigo Generalised", checked: ssti.impetigo_generalised },
    { label: "Cellulitis", checked: ssti.cellulitis },
  ]));
  lines.push("");

  lines.push("### Urinary Tract Infection (UTI)");
  lines.push(score([
    { label: "Nit +ve", checked: uti.nit_positive },
    { label: "Leu +ve", checked: uti.leu_positive },
    { label: "Frequency", checked: uti.frequency },
    { label: "Dysuria", checked: uti.dysuria },
    { label: "Hematuria", checked: uti.hematuria },
    { label: "Suprapubic Pain", checked: uti.suprapubic },
    { label: "Urgency", checked: uti.urgency },
    { label: "Polyuria", checked: uti.polyuria },
  ]));
  if (uti.pregnancy_culture) lines.push(`- Pregnancy C&S: ${uti.pregnancy_culture}`);
  lines.push("");

  if (form.prescriber_notes) {
    lines.push("## Prescriber's Notes");
    lines.push(form.prescriber_notes);
    lines.push("");
  }

  lines.push("## Audit Trail");
  lines.push(`- Status: ${form.status || "—"}`);
  lines.push(`- Submitted by: ${form.submitted_by_name || "—"}`);
  lines.push(`- Specialist action at: ${form.specialist_action_at || "—"}`);
  lines.push(`- Acknowledged by: ${form.acknowledged_by_name || "—"}`);
  lines.push(`- Acknowledged at: ${form.acknowledged_at || "—"}`);

  return lines.join("\n");
}

function sanitizeFilenamePart(value: string | undefined, allowed: RegExp): string {
  const cleaned = (value || "").replace(allowed, "");
  return cleaned || "unknown";
}

/** Filename for a form's exported snapshot, safe for filesystem use. */
export function antibioticFormFilename(form: Pick<AntibioticFormRecord, "patient_ic" | "tarikh">): string {
  const safeIc = sanitizeFilenamePart(form.patient_ic, /[^a-zA-Z0-9-]/g);
  const safeDate = sanitizeFilenamePart(form.tarikh, /[^0-9-]/g);
  return `antibiotik_${safeIc}_${safeDate}.md`;
}

/** Triggers a browser download of the given text content as a .md file. */
export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
