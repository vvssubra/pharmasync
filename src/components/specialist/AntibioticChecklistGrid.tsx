import { CheckCircle2, Circle } from "lucide-react";
import type { ChecklistState } from "@/lib/doseQuery";
import { cn } from "@/lib/utils";

// Same shape AntibioticFormReadOnly reads from checklist_data — every field
// optional because archived rows can predate fields and the form itself only
// writes what the MO actually touched.
export type StoredChecklist = Partial<{
  [S in keyof ChecklistState]: Partial<ChecklistState[S]>;
}>;

// Maps derivePathwayIndication()'s return string to the checklist category it
// came from, so the matching card can be highlighted the way the prescribing
// officer's own pathway check highlighted it.
export const INDICATION_TO_CATEGORY: Record<string, keyof ChecklistState> = {
  "Pharyngitis": "pharyngitis",
  "Community Acquired Pneumonia": "pneumonia",
  "Acute Otitis Media": "aom",
  "Acute Bacterial Rhinosinusitis": "rhinosinusitis",
  "Skin and Soft Tissue Infection": "ssti",
  "Urinary Tract Infection": "uti",
};

interface BoolField {
  key: string;
  label: string;
}

const PNEUMONIA_FIELDS: BoolField[] = [
  { key: "acute_cough", label: "Acute Cough / Sputum" },
  { key: "tachycardia", label: "Tachycardia" },
  { key: "tachypnoea", label: "Tachypnoea" },
  { key: "fever", label: "Fever > 38°C" },
  { key: "hypoxemia", label: "Hypoxemia" },
  { key: "consolidation", label: "Consolidation (CXR)" },
];

const AOM_FIELDS: BoolField[] = [
  { key: "otalgia", label: "Otalgia" },
  { key: "urti", label: "URTI Symptoms" },
  { key: "fever", label: "Fever > 38°C" },
  { key: "poor_appetite", label: "Poor Appetite" },
  { key: "crying", label: "Crying / Irritable" },
  { key: "vomiting", label: "Vomiting / Diarrhea" },
];

const RHINOSINUSITIS_FIELDS: BoolField[] = [
  { key: "nasal_obstruction", label: "Nasal Obstruction" },
  { key: "smell_loss", label: "Loss of Smell" },
  { key: "fever", label: "Fever > 38°C" },
  { key: "discoloured_mucus", label: "Discoloured Mucus" },
  { key: "double_sickening", label: "Double Sickening" },
  { key: "severe_pain", label: "Severe Pain" },
  { key: "raised_esr", label: "Raised ESR/CRP" },
];

const SSTI_FIELDS: BoolField[] = [
  { key: "erythema", label: "Erythema / Swelling / Pain" },
  { key: "abscess_incision", label: "I&D Done" },
  { key: "inadequate_drainage", label: "Inadequate Drainage" },
  { key: "extensive_cellulitis", label: "Extensive Cellulitis" },
  { key: "valvular_heart", label: "Valvular Heart Disease" },
  { key: "diabetes", label: "Diabetes Mellitus" },
  { key: "impetigo_localised", label: "Impetigo (Localised)" },
  { key: "impetigo_generalised", label: "Impetigo (Generalised)" },
  { key: "cellulitis", label: "Cellulitis" },
];

const UTI_FIELDS: BoolField[] = [
  { key: "nit_positive", label: "Nitrite Positive (+ve)" },
  { key: "leu_positive", label: "Leukocyte Positive (+ve)" },
  { key: "frequency", label: "Frequency / Urgency" },
  { key: "dysuria", label: "Dysuria" },
  { key: "hematuria", label: "Hematuria" },
  { key: "suprapubic", label: "Suprapubic Pain" },
  { key: "urgency", label: "Urgency" },
  { key: "polyuria", label: "Polyuria" },
];

function CheckRow({ label, checked }: { label: string; checked?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 text-sm", checked ? "font-medium text-primary" : "text-muted-foreground")}>
      {checked
        ? <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-primary" aria-hidden />
        : <Circle className="h-[18px] w-[18px] shrink-0 text-muted-foreground/50" aria-hidden />}
      <span>{label}</span>
    </div>
  );
}

function BoolCategoryCard({
  title, fields, data, matched,
}: { title: string; fields: BoolField[]; data: Record<string, boolean | string | undefined>; matched: boolean }) {
  return (
    <div className={cn(
      "flex flex-col rounded-lg border bg-card p-3 shadow-sm",
      matched && "border-primary/60 bg-primary/5",
    )}>
      <div className="mb-2 flex items-center justify-between gap-2 pb-2 border-b">
        <span className="text-sm font-bold tracking-tight text-foreground">{title}</span>
        {matched
          ? <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">Criteria Met</span>
          : <span className="text-[11px] text-muted-foreground">Negative</span>}
      </div>
      <div className="space-y-1.5">
        {fields.map(f => (
          <CheckRow key={f.key} label={f.label} checked={!!data[f.key]} />
        ))}
      </div>
    </div>
  );
}

/** Card grid replicating the read-only checklist Section/Row list, but as
 *  Rx-Dashboard-styled cards with the derived indication's category
 *  highlighted — same clinical fields AntibioticFormReadOnly shows, just
 *  presented as a review surface rather than a plain form dump. */
export function AntibioticChecklistGrid({ checklist, matchedCategory }: {
  checklist: StoredChecklist;
  matchedCategory: keyof ChecklistState | null;
}) {
  const pn = checklist.pneumonia ?? {};
  const aom = checklist.aom ?? {};
  const ph = checklist.pharyngitis ?? {};
  const rs = checklist.rhinosinusitis ?? {};
  const ssti = checklist.ssti ?? {};
  const uti = checklist.uti ?? {};

  const centorTotal = (ph.temp ?? 0) + (ph.no_cough ?? 0) + (ph.adenopathy ?? 0) + (ph.exudate ?? 0) + (ph.age_score ?? 0);
  const pharyngitisMatched = matchedCategory === "pharyngitis";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <BoolCategoryCard title="Pneumonia" fields={PNEUMONIA_FIELDS} data={pn} matched={matchedCategory === "pneumonia"} />
      <BoolCategoryCard
        title="Acute Otitis Media"
        fields={[...AOM_FIELDS, { key: "__otoscopy", label: "Otoscopy: AOM Signs" }]}
        data={{ ...aom, __otoscopy: aom.otoscopy_sign === "yes" }}
        matched={matchedCategory === "aom"}
      />

      {/* Pharyngitis is scored, not checked, so it gets its own numeric layout. */}
      <div className={cn(
        "flex flex-col rounded-lg border bg-card p-3 shadow-sm",
        pharyngitisMatched && "border-primary/60 bg-primary/5",
      )}>
        <div className="mb-2 flex items-center justify-between gap-2 pb-2 border-b">
          <span className="text-sm font-bold tracking-tight text-foreground">Pharyngitis (Centor)</span>
          {pharyngitisMatched
            ? <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">Criteria Met</span>
            : <span className="text-[11px] text-muted-foreground">Negative</span>}
        </div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground"><span>Temp &gt;38°C</span><span className="tabular-nums text-foreground">{ph.temp ?? 0}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Absence of Cough</span><span className="tabular-nums text-foreground">{ph.no_cough ?? 0}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Cervical Adenopathy</span><span className="tabular-nums text-foreground">{ph.adenopathy ?? 0}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Tonsillar Exudate</span><span className="tabular-nums text-foreground">{ph.exudate ?? 0}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Age Score</span><span className="tabular-nums text-foreground">{ph.age_score ?? 0}</span></div>
          <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span className="tabular-nums">{centorTotal} / 5</span></div>
        </div>
      </div>

      <BoolCategoryCard title="Rhinosinusitis" fields={RHINOSINUSITIS_FIELDS} data={rs} matched={matchedCategory === "rhinosinusitis"} />
      <BoolCategoryCard title="SSTI" fields={SSTI_FIELDS} data={ssti} matched={matchedCategory === "ssti"} />
      <div className="flex flex-col gap-3">
        <BoolCategoryCard title="UTI" fields={UTI_FIELDS} data={uti} matched={matchedCategory === "uti"} />
        {uti.pregnancy_culture && (
          <p className="text-xs text-muted-foreground">Pregnancy C&amp;S: <span className="font-medium text-foreground">{uti.pregnancy_culture}</span></p>
        )}
      </div>
    </div>
  );
}
