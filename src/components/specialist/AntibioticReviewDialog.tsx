import { ClipboardCheck, FileCheck2, Fingerprint, Stethoscope, XCircle, MessageCircleQuestion, CheckCircle } from "lucide-react";
import type { ChecklistState } from "@/lib/doseQuery";
import { derivePathwayIndication } from "@/lib/doseQuery";
import { formatIC } from "@/lib/ic";
import { Dialog, DialogContent, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { NagBadge } from "@/components/AntibioticFormReadOnly";
import { AntibioticChecklistGrid, INDICATION_TO_CATEGORY, type StoredChecklist } from "./AntibioticChecklistGrid";

// The exact set of antibiotic_forms fields this modal reads — structural, so
// any row shape the dashboards pass (base table row, decorated with a
// submitter name) satisfies it without a shared table-row import.
export interface AntibioticFormForReview {
  id: string;
  patient_name: string;
  patient_ic: string;
  patient_weight_kg?: number | null;
  diagnosis: string;
  antibiotic_regimen?: string | null;
  prescription_unit?: string | null;
  assigned_fms?: string | null;
  submitter_name?: string | null;
  drug_allergy?: boolean | null;
  drug_allergy_detail?: string | null;
  pathway_check_result?: string | null;
  fms_code?: string | null;
  checklist_data?: unknown;
}

function toFullChecklist(c: StoredChecklist): ChecklistState {
  return {
    pneumonia: {
      acute_cough: !!c.pneumonia?.acute_cough, tachycardia: !!c.pneumonia?.tachycardia, tachypnoea: !!c.pneumonia?.tachypnoea,
      fever: !!c.pneumonia?.fever, hypoxemia: !!c.pneumonia?.hypoxemia, consolidation: !!c.pneumonia?.consolidation,
    },
    aom: {
      otalgia: !!c.aom?.otalgia, urti: !!c.aom?.urti, fever: !!c.aom?.fever,
      poor_appetite: !!c.aom?.poor_appetite, crying: !!c.aom?.crying, vomiting: !!c.aom?.vomiting,
      otoscopy_sign: c.aom?.otoscopy_sign ?? "",
    },
    pharyngitis: {
      temp: c.pharyngitis?.temp ?? 0, no_cough: c.pharyngitis?.no_cough ?? 0, adenopathy: c.pharyngitis?.adenopathy ?? 0,
      exudate: c.pharyngitis?.exudate ?? 0, age_score: c.pharyngitis?.age_score ?? 0,
    },
    rhinosinusitis: {
      nasal_obstruction: !!c.rhinosinusitis?.nasal_obstruction, smell_loss: !!c.rhinosinusitis?.smell_loss, fever: !!c.rhinosinusitis?.fever,
      discoloured_mucus: !!c.rhinosinusitis?.discoloured_mucus, double_sickening: !!c.rhinosinusitis?.double_sickening,
      severe_pain: !!c.rhinosinusitis?.severe_pain, raised_esr: !!c.rhinosinusitis?.raised_esr,
    },
    ssti: {
      erythema: !!c.ssti?.erythema, abscess_incision: !!c.ssti?.abscess_incision, inadequate_drainage: !!c.ssti?.inadequate_drainage,
      extensive_cellulitis: !!c.ssti?.extensive_cellulitis, valvular_heart: !!c.ssti?.valvular_heart, diabetes: !!c.ssti?.diabetes,
      impetigo_localised: !!c.ssti?.impetigo_localised, impetigo_generalised: !!c.ssti?.impetigo_generalised, cellulitis: !!c.ssti?.cellulitis,
    },
    uti: {
      nit_positive: !!c.uti?.nit_positive, leu_positive: !!c.uti?.leu_positive, frequency: !!c.uti?.frequency, dysuria: !!c.uti?.dysuria,
      hematuria: !!c.uti?.hematuria, suprapubic: !!c.uti?.suprapubic, urgency: !!c.uti?.urgency, polyuria: !!c.uti?.polyuria,
      pregnancy_culture: c.uti?.pregnancy_culture ?? "",
    },
  };
}

interface AntibioticReviewDialogProps {
  form: AntibioticFormForReview | null;
  notes: string;
  onNotesChange: (value: string) => void;
  specialistName: string;
  approvePending: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRequestClarification: () => void;
  onOpenChange: (open: boolean) => void;
}

/** Full-fidelity antibiotic form review — Rx Dashboard's "Review & Sanction"
 *  surface. Reads the same checklist_data every other viewer reads
 *  (AntibioticFormReadOnly), just laid out as a review-and-decide screen
 *  instead of a flat form dump: overview cards, the checklist with the
 *  derived pathway indication highlighted, then the sanction decision. */
export function AntibioticReviewDialog({
  form, notes, onNotesChange, specialistName, approvePending,
  onApprove, onReject, onRequestClarification, onOpenChange,
}: AntibioticReviewDialogProps) {
  if (!form) return null;

  const storedChecklist = (form.checklist_data ?? {}) as StoredChecklist;
  const fullChecklist = toFullChecklist(storedChecklist);
  const indication = derivePathwayIndication(fullChecklist);
  const matchedCategory = indication ? INDICATION_TO_CATEGORY[indication] ?? null : null;
  const centorTotal =
    (storedChecklist.pharyngitis?.temp ?? 0) + (storedChecklist.pharyngitis?.no_cough ?? 0) +
    (storedChecklist.pharyngitis?.adenopathy ?? 0) + (storedChecklist.pharyngitis?.exudate ?? 0) +
    (storedChecklist.pharyngitis?.age_score ?? 0);

  const allergyLabel = form.drug_allergy
    ? `Allergy: ${form.drug_allergy_detail || "see prescriber notes"}`
    : "Allergies: NKDA";

  return (
    <Dialog open={!!form} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        {/* Header */}
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileCheck2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="text-lg font-bold">Review Antibiotic Form</DialogTitle>
              <Badge variant="destructive" className="text-[10px]">Pending Specialist Sanction</Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="font-bold text-foreground">{form.patient_name}</span>
              <span>•</span>
              <span className="font-mono text-xs">IC: {formatIC(form.patient_ic)}</span>
              <span>•</span>
              <span className={form.drug_allergy ? "font-semibold text-destructive" : "font-semibold text-primary"}>{allergyLabel}</span>
            </div>
          </div>
        </div>

        {/* Overview cards */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Prescribed Regimen</p>
            <p className="mt-1 text-sm font-bold text-primary">{form.antibiotic_regimen || "—"}</p>
            {form.fms_code && <p className="mt-1 text-xs text-muted-foreground">FMS Code: <span className="font-medium text-foreground">{form.fms_code}</span></p>}
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Primary Indication</p>
            <p className="mt-1 text-sm font-bold text-foreground">{form.diagnosis}</p>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">NAG Check</span>
              <NagBadge result={form.pathway_check_result} />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Centor Score</span>
              <span className="font-medium text-foreground">{centorTotal} / 5</span>
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Prescriber &amp; Unit</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-foreground">
              <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {form.submitter_name || "Unknown MO"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{form.prescription_unit || "—"} · Assigned FMS: {form.assigned_fms || "—"}</p>
            {form.patient_weight_kg != null && (
              <p className="mt-1 text-xs text-muted-foreground">Weight: <span className="font-medium text-foreground">{form.patient_weight_kg} kg</span></p>
            )}
          </div>
        </div>

        {/* Checklist */}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" aria-hidden />
            <h3 className="text-sm font-bold text-foreground">Antibiotic Special Restriction Checklist</h3>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Review the clinical criteria evaluated by the prescribing officer prior to endorsing the restricted antibiotic dispensation.
          </p>
          <AntibioticChecklistGrid checklist={storedChecklist} matchedCategory={matchedCategory} />
        </div>

        {/* Sanction notes */}
        <div className="rounded-lg bg-muted/50 p-3">
          <Label htmlFor="fmsNotes" className="flex items-center justify-between text-sm font-bold">
            <span>Specialist Sanction Rationale / Dispensing Notes</span>
            <span className="text-xs font-normal text-muted-foreground">Optional</span>
          </Label>
          <Textarea
            id="fmsNotes"
            className="mt-2"
            placeholder={`Clinical rationale or dispensing instructions for ${form.prescription_unit || "the pharmacy unit"}...`}
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Fingerprint className="h-3.5 w-3.5 text-primary" aria-hidden />
              Sanctioning Specialist: <span className="font-medium text-foreground">{specialistName}</span>
            </span>
            <span className="font-mono">Form Ref: {form.id.slice(0, 8).toUpperCase()}</span>
          </div>
        </div>

        {/* Pinned: tallest overlay in the app, matches the sticky-footer
            convention used elsewhere in this file for the same reason. */}
        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 flex-col gap-2 bg-background px-6 pb-6 pt-3 sm:flex-row sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onReject}>
              <XCircle className="h-4 w-4" aria-hidden />
              Reject Form
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={onRequestClarification}>
              <MessageCircleQuestion className="h-4 w-4" aria-hidden />
              Request MO Clarification
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={onApprove} disabled={approvePending}>
              <CheckCircle className="h-4 w-4" aria-hidden />
              {approvePending ? "Processing..." : "Approve & Endorse Form"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
