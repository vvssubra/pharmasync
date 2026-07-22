import { Check, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface AntibioticFormViewerProps {
  form: any;
}

function CheckDisplay({ checked }: { checked: boolean }) {
  return (
    <span className={checked ? "text-green-600 inline-flex" : "text-muted-foreground inline-flex"}>
      {checked ? <Check className="h-4 w-4" aria-hidden /> : <Minus className="h-4 w-4" aria-hidden />}
    </span>
  );
}

export function AntibioticFormReadOnly({ form }: AntibioticFormViewerProps) {
  const c = form.checklist_data || {};
  const pn = c.pneumonia || {};
  const aom = c.aom || {};
  const ph = c.pharyngitis || {};
  const rs = c.rhinosinusitis || {};
  const ssti = c.ssti || {};
  const uti = c.uti || {};

  return (
    <div className="space-y-4 text-sm max-h-[60vh] overflow-y-auto pr-2">
      {/* Bahagian 1 */}
      <div className="space-y-2">
        <h4 className="font-semibold text-foreground">SECTION 1: Patient Details</h4>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date" value={form.tarikh} />
          <Field label="Name" value={form.patient_name} />
          <Field label="IC" value={form.patient_ic} />
          {form.patient_weight_kg && <Field label="Weight (kg)" value={form.patient_weight_kg} />}
          <Field label="Diagnosis" value={form.diagnosis} />
          <Field label="Unit" value={form.prescription_unit || "—"} />
          <Field label="Assigned FMS" value={form.assigned_fms || "—"} />
        </div>
        <Field label="Drug Allergy" value={form.drug_allergy ? `Yes — ${form.drug_allergy_detail || ""}` : "No / NKDA"} />
        <Field label="Antibiotic Regimen" value={form.antibiotic_regimen || "—"} />
        {form.fms_code && <Field label="FMS Code" value={form.fms_code} />}
        <div className="flex gap-4">
          <span className="text-muted-foreground">Health Ed:</span>
          <span>Compliance <CheckDisplay checked={form.health_ed_compliance} /></span>
          <span>Side-effect <CheckDisplay checked={form.health_ed_sideeffect} /></span>
          <span>TCA <CheckDisplay checked={form.health_ed_tca} /></span>
        </div>
      </div>

      <Separator />

      {/* Bahagian 2 */}
      <h4 className="font-semibold text-foreground">SECTION 2: Clinical Review</h4>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-3">
          <Section title="PNEUMONIA">
            <Row label="Acute Cough/Sputum" checked={pn.acute_cough} />
            <Row label="Tachycardia" checked={pn.tachycardia} />
            <Row label="Tachypnoea" checked={pn.tachypnoea} />
            <Row label="Fever >38°C" checked={pn.fever} />
            <Row label="Hypoxemia" checked={pn.hypoxemia} />
            <Row label="Consolidation" checked={pn.consolidation} />
          </Section>

          <Section title="ACUTE OTITIS MEDIA">
            <Row label="Otalgia" checked={aom.otalgia} />
            <Row label="URTI" checked={aom.urti} />
            <Row label="Fever >38" checked={aom.fever} />
            <Row label="Poor Appetite" checked={aom.poor_appetite} />
            <Row label="Crying/Irritable" checked={aom.crying} />
            <Row label="Vomiting/Diarrhea" checked={aom.vomiting} />
            <div className="flex justify-between"><span className="text-muted-foreground">Otoscopy AOM?</span><span>{aom.otoscopy_sign || "—"}</span></div>
          </Section>

          <Section title="PHARYNGITIS (Centor Score)">
            <div className="flex justify-between"><span className="text-muted-foreground">{"Temperature >38°C"}</span><span>{ph.temp ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Absence of Cough</span><span>{ph.no_cough ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cervical Adenopathy</span><span>{ph.adenopathy ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Tonsilar Exudate</span><span>{ph.exudate ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Age Score</span><span>{ph.age_score ?? 0}</span></div>
            <div className="flex justify-between font-bold border-t pt-1"><span>Total</span><span>{ph.total_score ?? 0}</span></div>
          </Section>

          <Section title="RHINOSINUSITIS">
            <Row label="Nasal Obstruction" checked={rs.nasal_obstruction} />
            <Row label="Loss of Smell" checked={rs.smell_loss} />
            <Row label="Fever >38°C" checked={rs.fever} />
            <Row label="Discoloured Mucus" checked={rs.discoloured_mucus} />
            <Row label="Double Sickening" checked={rs.double_sickening} />
            <Row label="Severe Pain" checked={rs.severe_pain} />
            <Row label="Raised ESR/CRP" checked={rs.raised_esr} />
          </Section>
        </div>

        <div className="space-y-3">
          <Section title="SSTI">
            <Row label="Erythema/Swelling/Pain" checked={ssti.erythema} />
            <Row label="I&D Done" checked={ssti.abscess_incision} />
            <Row label="Inadequate Drainage" checked={ssti.inadequate_drainage} />
            <Row label="Extensive Cellulitis" checked={ssti.extensive_cellulitis} />
            <Row label="Valvular Heart Disease" checked={ssti.valvular_heart} />
            <Row label="Diabetes" checked={ssti.diabetes} />
            <Row label="Impetigo Localised" checked={ssti.impetigo_localised} />
            <Row label="Impetigo Generalised" checked={ssti.impetigo_generalised} />
            <Row label="Cellulitis" checked={ssti.cellulitis} />
          </Section>

          <Section title="UTI">
            <Row label="Nit +ve" checked={uti.nit_positive} />
            <Row label="Leu +ve" checked={uti.leu_positive} />
            <Row label="Frequency" checked={uti.frequency} />
            <Row label="Dysuria" checked={uti.dysuria} />
            <Row label="Hematuria" checked={uti.hematuria} />
            <Row label="Suprapubic Pain" checked={uti.suprapubic} />
            <Row label="Urgency" checked={uti.urgency} />
            <Row label="Polyuria" checked={uti.polyuria} />
            {uti.pregnancy_culture && <Field label="Pregnancy C&S" value={uti.pregnancy_culture} />}
          </Section>
        </div>
      </div>

      {form.prescriber_notes && (
        <>
          <Separator />
          <Field label="Prescriber's Notes" value={form.prescriber_notes} />
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Row({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <CheckDisplay checked={checked} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border p-2 space-y-1">
      <p className="font-semibold text-xs text-foreground">{title}</p>
      {children}
    </div>
  );
}
