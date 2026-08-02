import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArrowLeft, ShieldCheck, CheckCircle, Sparkles, AlertTriangle } from "lucide-react";
import { usePathwayCheck } from "@/hooks/usePathwayCheck";
import { useDoseSuggestion } from "@/hooks/useDoseSuggestion";
import PathwayCheckBanner from "@/components/PathwayCheckBanner";
import { AI_ENABLED, AI_SUGGEST_ROLES, PATHWAY_CHECK_ENABLED, KNOWLEDGE_ENABLED } from "@/lib/featureFlags";
import { deriveDoseQuery, type ChecklistState } from "@/lib/doseQuery";
import { resolveLocalDose } from "@/lib/abxDose";
import AbxDoseCard from "@/components/AbxDoseCard";
import { exampleDoseFor } from "@/lib/knowledgeClient";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getErrorMessage } from "@/lib/errors";


function formatIC(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  if (digits.length <= 6) return digits;
  if (digits.length <= 8) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
}

function getAgeFromIC(ic: string): number | null {
  const d = ic.replace(/\D/g, "");
  if (d.length < 6) return null;
  const yy = parseInt(d.slice(0, 2));
  const mm = parseInt(d.slice(2, 4)) - 1;
  const dd = parseInt(d.slice(4, 6));
  const century = yy > 30 ? 1900 : 2000;
  const dob = new Date(century + yy, mm, dd);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  if (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate())) age--;
  return age;
}

const defaultChecklist: ChecklistState = {
  pneumonia: { acute_cough: false, tachycardia: false, tachypnoea: false, fever: false, hypoxemia: false, consolidation: false },
  aom: { otalgia: false, urti: false, fever: false, poor_appetite: false, crying: false, vomiting: false, otoscopy_sign: "" },
  pharyngitis: { temp: 0, no_cough: 0, adenopathy: 0, exudate: 0, age_score: 0 },
  rhinosinusitis: { nasal_obstruction: false, smell_loss: false, fever: false, discoloured_mucus: false, double_sickening: false, severe_pain: false, raised_esr: false },
  ssti: { erythema: false, abscess_incision: false, inadequate_drainage: false, extensive_cellulitis: false, valvular_heart: false, diabetes: false, impetigo_localised: false, impetigo_generalised: false, cellulitis: false },
  uti: { nit_positive: false, leu_positive: false, frequency: false, dysuria: false, hematuria: false, suprapubic: false, urgency: false, polyuria: false, pregnancy_culture: "" },
};

interface AiSuggestion {
  suggestion: string;
  rationale: string;
  warning: string | null;
  /** "refer" means no regimen was produced — no pathway matched, or the only
   *  match was written for a different patient group. It is not a suggestion,
   *  so it must not be labelled as a NAG match nor be insertable via "Use". */
  source: "rules" | "llm" | "refer";
}

export default function AntibioticForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  // Correction mode: ?edit=<id> reopens the MO's own REJECTED form, prefilled,
  // and submitting UPDATEs it back to pending_specialist instead of inserting.
  // RLS enforces the real rules (own form, rejected → pending_specialist only);
  // the client checks are just for honest UI.
  const editId = searchParams.get("edit");
  const { user, profile, role } = useAuth();
  // Mirrors ALLOWED_ROLES in supabase/functions/antibiotic-suggest/index.ts and
  // pathway-check/index.ts. Rendering the button for a role the endpoint
  // rejects just produces a silent 403 on click.
  const canUseAiSuggest = !!role && AI_SUGGEST_ROLES.includes(role);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ patient_name: string; patient_ic: string; diagnosis: string } | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);

  // Section 1
  const [tarikh, setTarikh] = useState(format(new Date(), "yyyy-MM-dd"));
  const [patientName, setPatientName] = useState("");
  const [patientIC, setPatientIC] = useState("");
  const [patientWeight, setPatientWeight] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [prescriptionUnit, setPrescriptionUnit] = useState("");
  const [drugAllergy, setDrugAllergy] = useState(false);
  const [drugAllergyDetail, setDrugAllergyDetail] = useState("");
  const [antibioticRegimen, setAntibioticRegimen] = useState("");
  const [fmsCode, setFmsCode] = useState("");
  const [assignedFms, setAssignedFms] = useState("");

  // Whoever holds the fms role in this clinic — replaces the old hardcoded
  // placeholder names. Stored as the display name; assigned_fms is text.
  const { data: fmsOptions = [] } = useQuery({
    queryKey: ["fms-list"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_fms_list");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [healthEdCompliance, setHealthEdCompliance] = useState(false);
  const [healthEdSideeffect, setHealthEdSideeffect] = useState(false);
  const [healthEdTca, setHealthEdTca] = useState(false);
  const [prescriberNotes, setPrescriberNotes] = useState("");

  // Section 2
  const [checklist, setChecklist] = useState<ChecklistState>(defaultChecklist);

  // ── Correction mode: load + prefill the rejected form ─────────────────────
  const { data: editForm } = useQuery({
    queryKey: ["antibiotic-form-edit", editId],
    enabled: !!editId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("antibiotic_forms")
        .select("*")
        .eq("id", editId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Only the submitter's own rejected form is correctable — anything else in
  // ?edit is treated as a plain new-form visit.
  const editable =
    !!editForm && editForm.status === "rejected" && editForm.submitted_by === user?.id;

  useEffect(() => {
    if (!editable || !editForm) return;
    setTarikh(editForm.tarikh);
    setPatientName(editForm.patient_name);
    setPatientIC(editForm.patient_ic);
    setPatientWeight(editForm.patient_weight_kg != null ? String(editForm.patient_weight_kg) : "");
    setDiagnosis(editForm.diagnosis);
    setPrescriptionUnit(editForm.prescription_unit ?? "");
    setDrugAllergy(!!editForm.drug_allergy);
    setDrugAllergyDetail(editForm.drug_allergy_detail ?? "");
    setAntibioticRegimen(editForm.antibiotic_regimen ?? "");
    setFmsCode(editForm.fms_code ?? "");
    setAssignedFms(editForm.assigned_fms ?? "");
    setHealthEdCompliance(!!editForm.health_ed_compliance);
    setHealthEdSideeffect(!!editForm.health_ed_sideeffect);
    setHealthEdTca(!!editForm.health_ed_tca);
    setPrescriberNotes(editForm.prescriber_notes ?? "");
    // Merge over the defaults so checklist keys added after this row was
    // written still exist in state.
    const stored = (editForm.checklist_data ?? {}) as Partial<ChecklistState>;
    setChecklist((prev) => {
      const merged = { ...prev } as ChecklistState;
      for (const key of Object.keys(defaultChecklist) as (keyof ChecklistState)[]) {
        if (stored[key]) {
          merged[key] = { ...defaultChecklist[key], ...(stored[key] as object) } as never;
        }
      }
      return merged;
    });
    // The effect must run once per loaded row, not on every keystroke —
    // depending on editForm's id alone keeps it that way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, editForm?.id]);

  const age = getAgeFromIC(patientIC);

  // Weight is always optional and always collected — it used to only render
  // for an IC-derived age < 12, so a mistyped/foreign IC silently dropped
  // the field entirely. Parsed once here; a non-empty value that isn't a
  // sane weight (matches the antibiotic-suggest edge zod: 0 < kg <= 300)
  // shows an inline hint but never blocks submission.
  const weightRaw = patientWeight.trim();
  const weightParsed = weightRaw === "" ? null : parseFloat(weightRaw);
  const weightValid = weightParsed != null && Number.isFinite(weightParsed) && weightParsed > 0 && weightParsed <= 300;
  const weightInvalid = weightRaw !== "" && !weightValid;
  const weightKg = weightValid ? weightParsed : null;

  // Deterministic, local, no network call — computed from the same NAG data
  // and math the antibiotic-suggest edge function uses server-side, so this
  // card and the AI fallback below never disagree.
  const localDose = useMemo(
    () => resolveLocalDose({ checklist, diagnosis, age, weightKg, hasAllergy: drugAllergy }),
    [checklist, diagnosis, age, weightKg, drugAllergy]
  );
  const hasLocalDose = "result" in localDose;

  const { verdict: pathwayVerdict, explanation: pathwayExplanation, status: pathwayStatus } = usePathwayCheck({
    diagnosis,
    antibiotic: antibioticRegimen,
    indication: prescriberNotes,
    // ChecklistState is a fixed-field interface (see src/lib/doseQuery.ts, mirrored
// into the edge bundle), so it has no index signature. Widening it here rather
// than adding one keeps the shared type strict for everyone else.
checklist: checklist as unknown as Record<string, unknown>,
    allergy_status: drugAllergy ? drugAllergyDetail : undefined,
    patient_age: age ?? undefined,
  }, { enabled: PATHWAY_CHECK_ENABLED && canUseAiSuggest });
  const centorTotal = checklist.pharyngitis.temp + checklist.pharyngitis.no_cough + checklist.pharyngitis.adenopathy + checklist.pharyngitis.exudate + checklist.pharyngitis.age_score;

  const doseQuery = deriveDoseQuery(checklist, diagnosis, age);
  const { matches: doseMatches, status: doseStatus, message: doseMessage } = useDoseSuggestion(doseQuery, {
    enabled: KNOWLEDGE_ENABLED,
  });

  const updateChecklist = <S extends keyof ChecklistState, F extends keyof ChecklistState[S]>(section: S, field: F, value: ChecklistState[S][F]) => {
    setChecklist(prev => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  };

  const suggestAntibiotic = async () => {
    if (!diagnosis) {
      toast.error("Please enter a diagnosis first");
      return;
    }
    setAiSuggesting(true);
    setAiSuggestion(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token ?? "";
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/antibiotic-suggest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({
            diagnosis,
            // ChecklistState is a fixed-field interface (see src/lib/doseQuery.ts, mirrored
// into the edge bundle), so it has no index signature. Widening it here rather
// than adding one keeps the shared type strict for everyone else.
checklist: checklist as unknown as Record<string, unknown>,
            patient_age: age ?? undefined,
            allergy_status: drugAllergy ? drugAllergyDetail || "Yes (unspecified)" : undefined,
            patient_weight_kg: weightKg ?? undefined,
          }),
        }
      );
      if (resp.status === 429) {
        toast.error("AI suggestion limit reached. Please try again later.");
        return;
      }
      if (!resp.ok) {
        toast.error("AI suggestion unavailable. Please try again.");
        return;
      }
      const data = await resp.json() as AiSuggestion;
      setAiSuggestion(data);
    } catch {
      toast.error("Network error. Please check your connection.");
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleSubmit = async () => {
    if (!patientName || !patientIC || !diagnosis) {
      toast.error("Please complete Name, IC and Diagnosis");
      return;
    }
    if (!assignedFms) {
      toast.error("Please select the FMS reviewing this form");
      return;
    }
    setSubmitting(true);
    try {
      const fields = {
        tarikh,
        patient_name: patientName,
        patient_ic: patientIC,
        patient_weight_kg: weightKg,
        diagnosis,
        prescription_unit: prescriptionUnit || null,
        drug_allergy: drugAllergy,
        drug_allergy_detail: drugAllergy ? drugAllergyDetail : null,
        antibiotic_regimen: antibioticRegimen || null,
        fms_code: fmsCode || null,
        assigned_fms: assignedFms,
        health_ed_compliance: healthEdCompliance,
        health_ed_sideeffect: healthEdSideeffect,
        health_ed_tca: healthEdTca,
        checklist_data: { ...checklist, pharyngitis: { ...checklist.pharyngitis, total_score: centorTotal } },
        prescriber_notes: prescriberNotes || null,
        pathway_check_result: pathwayVerdict ?? "unavailable",
        status: "pending_specialist",
      };
      if (editable) {
        // Resubmission: same row goes back into the specialist queue with the
        // previous decision cleared. The DB trigger notifies the approvers.
        const { error } = await supabase
          .from("antibiotic_forms")
          .update({
            ...fields,
            specialist_id: null,
            specialist_notes: null,
            specialist_action_at: null,
          })
          .eq("id", editForm!.id);
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ["mo-rejected-antibiotic"] });
        queryClient.invalidateQueries({ queryKey: ["antibiotic-form-edit", editId] });
      } else {
        const { error } = await supabase
          .from("antibiotic_forms")
          .insert({ ...fields, submitted_by: user?.id });
        if (error) throw error;
      }
      setSubmitted({ patient_name: patientName, patient_ic: patientIC, diagnosis });
    } catch (error) {
      console.error("Antibiotic form submission failed:", error);
      toast.error(getErrorMessage(error, "Failed to submit form"));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Card className="w-full max-w-lg text-center">
          <CardContent className="space-y-6 py-10">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Antibiotic Form Submitted!</h2>
            <div className="rounded-lg border p-4 text-left space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Patient</span><span className="font-medium">{submitted.patient_name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">IC</span><span className="font-medium">{submitted.patient_ic}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Diagnosis</span><span className="font-medium">{submitted.diagnosis}</span></div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge className="bg-yellow-100 text-yellow-700 border-yellow-300">Awaiting Specialist Approval</Badge>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={() => { setSubmitted(null); setPatientName(""); setPatientIC(""); setDiagnosis(""); setChecklist(defaultChecklist); setAntibioticRegimen(""); setPrescriberNotes(""); setAiSuggestion(null); setAssignedFms(""); }}>
                Submit New Form
              </Button>
              <Button variant="link" onClick={() => navigate("/request")}>Back to Request Options</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <Button variant="ghost" size="sm" onClick={() => navigate("/request")} className="gap-1">
        <ArrowLeft className="h-4 w-4" /> Back to Request Options
      </Button>

      {editable && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <span className="font-medium">This form was returned by the FMS for correction.</span>
            {editForm?.specialist_notes && (
              <>
                {" "}Reason: <span className="font-medium">{editForm.specialist_notes}</span>
              </>
            )}
            {" "}Fix the issues below and submit again — it will go back to the same queue.
          </AlertDescription>
        </Alert>
      )}

      {/* Header */}
      <Card className="border-none text-primary-foreground" style={{ backgroundColor: "#0b3b28" }}>
        <CardHeader className="text-center">
          <CardTitle className="text-lg">ANTIBIOTIC CHECKLIST (Based on Clinical Pathway NAG 2024)</CardTitle>
          <p className="text-sm opacity-80">JK Kawalan Infeksi & Antibiotik PKD Johor Bahru — Versi Mac 2025</p>
        </CardHeader>
      </Card>

      {/* SECTION 1 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SECTION 1: Patient Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-4">
              <p className="text-sm font-medium text-muted-foreground">Please complete patient details</p>
              <div className="space-y-2">
                <Label>1. Date</Label>
                <Input type="date" value={tarikh} onChange={e => setTarikh(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>2. Patient Name *</Label>
                <Input value={patientName} onChange={e => setPatientName(e.target.value.toUpperCase())} placeholder="Full name" />
              </div>
              <div className="space-y-2">
                <Label>3. Patient IC No. *</Label>
                <Input value={patientIC} onChange={e => setPatientIC(formatIC(e.target.value))} placeholder="000000-00-0000" inputMode="numeric" />
              </div>
              <div className="space-y-2">
                <Label>4. Body Weight (kg) <span className="text-xs text-muted-foreground">(optional — needed for paediatric dosing)</span></Label>
                <Input type="number" value={patientWeight} onChange={e => setPatientWeight(e.target.value)} placeholder="kg" />
                {weightInvalid && (
                  <p className="text-xs text-destructive">Enter a weight between 0 and 300 kg.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>5. Diagnosis *</Label>
                <Textarea value={diagnosis} onChange={e => setDiagnosis(e.target.value)} placeholder="Diagnosis" />
              </div>
              <div className="space-y-2">
                <Label>6. Assigned FMS *</Label>
                <Select value={assignedFms} onValueChange={setAssignedFms}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select FMS" />
                  </SelectTrigger>
                  <SelectContent>
                    {fmsOptions.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Tiada FMS berdaftar di klinik ini
                      </div>
                    ) : (
                      fmsOptions.map(f => (
                        <SelectItem key={f.user_id} value={f.full_name}>{f.full_name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>PRESCRIPTION FROM UNIT</Label>
                <RadioGroup value={prescriptionUnit} onValueChange={setPrescriptionUnit} className="flex gap-4">
                  {["OPD", "FEVER", "MCH"].map(u => (
                    <div key={u} className="flex items-center gap-2">
                      <RadioGroupItem value={u} id={`unit-${u}`} />
                      <Label htmlFor={`unit-${u}`} className="cursor-pointer">{u}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label>7. Any Drug Allergy?</Label>
                <RadioGroup value={drugAllergy ? "yes" : "no"} onValueChange={v => setDrugAllergy(v === "yes")} className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="no" id="allergy-no" />
                    <Label htmlFor="allergy-no" className="cursor-pointer">No / NKDA</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="yes" id="allergy-yes" />
                    <Label htmlFor="allergy-yes" className="cursor-pointer">Yes</Label>
                  </div>
                </RadioGroup>
                {drugAllergy && (
                  <Input value={drugAllergyDetail} onChange={e => setDrugAllergyDetail(e.target.value)} placeholder="Please state allergy" />
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>8. Antibiotic Regimen (Dose, frequency, duration)</Label>
                  {AI_ENABLED && canUseAiSuggest && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={suggestAntibiotic}
                      disabled={aiSuggesting || !diagnosis}
                      className="gap-1.5 text-xs h-7 border-primary/40 text-primary hover:bg-primary/5"
                    >
                      <Sparkles className="h-3 w-3" />
                      {aiSuggesting ? "Suggesting..." : hasLocalDose ? "Ask AI instead" : "Suggest Antibiotic (AI)"}
                    </Button>
                  )}
                </div>
                {hasLocalDose && (
                  <AbxDoseCard match={localDose} onUse={(text) => setAntibioticRegimen(text)} />
                )}
                {!hasLocalDose && "unavailable" in localDose && localDose.unavailable === "noRule" && (
                  <p className="text-xs text-muted-foreground">
                    No local paediatric dose for this indication — use AI Suggest or NAG Section B.
                  </p>
                )}
                {AI_ENABLED && aiSuggestion && (
                  <div className={`rounded-md border p-3 space-y-2 text-sm ${aiSuggestion.source === "refer" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 flex-1">
                        <p className={aiSuggestion.source === "refer" ? "font-semibold text-amber-900" : "font-semibold text-emerald-900"}>{aiSuggestion.suggestion}</p>
                        <p className={aiSuggestion.source === "refer" ? "text-xs text-amber-800" : "text-xs text-emerald-700"}>{aiSuggestion.rationale}</p>
                        {aiSuggestion.warning && (
                          <div className="flex items-start gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>{aiSuggestion.warning}</span>
                          </div>
                        )}
                      </div>
                      {/* A "refer" result is a refusal, not a regimen — there is
                          nothing to insert into the prescription field. */}
                      {aiSuggestion.source !== "refer" && (
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 text-xs shrink-0"
                          onClick={() => { setAntibioticRegimen(aiSuggestion.suggestion); setAiSuggestion(null); }}
                        >
                          Use
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {aiSuggestion.source === "llm"
                        ? "AI-phrased from NAG 2024 — verify before prescribing."
                        : aiSuggestion.source === "refer"
                          ? "No NAG 2024 regimen available for this case — prescribe from the guideline directly."
                          : "NAG 2024 pathway match — verify before prescribing."}
                    </p>
                  </div>
                )}
                {KNOWLEDGE_ENABLED && doseMatches.length > 0 && (
                  <div className="space-y-2">
                    {doseMatches.map((match, i) => {
                      const exampleDose = exampleDoseFor(match);
                      const applied = antibioticRegimen === exampleDose;
                      return (
                        <div key={`${match.drug}-${match.indication}-${i}`} className="rounded-md border border-sky-200 bg-sky-50 p-3 space-y-2 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1 flex-1">
                              <div className="font-semibold text-sky-900 flex items-center gap-2">
                                <span>{match.drug} — {match.indication}</span>
                                <Badge variant="outline" className="border-sky-300 text-sky-700 text-[10px]">{match.patient_group}</Badge>
                              </div>
                              <p className="text-xs text-sky-800 whitespace-pre-line">{match.body}</p>
                              <p className="text-[11px] text-sky-600">Source: {match.source} · Local knowledge base · shown verbatim</p>
                              <p className="text-[11px] text-sky-600">The Use button fills in the regimen field only — compare the options above and edit the field if needed.</p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant={applied ? "secondary" : "default"}
                              disabled={applied}
                              className="h-7 text-xs shrink-0"
                              onClick={() => setAntibioticRegimen(exampleDose)}
                            >
                              {applied ? "Applied ✓" : "Use"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {KNOWLEDGE_ENABLED && doseStatus === "ok" && doseMatches.length === 0 && doseMessage && (
                  <p className="text-xs text-muted-foreground">{doseMessage}</p>
                )}
                <Textarea value={antibioticRegimen} onChange={e => setAntibioticRegimen(e.target.value)} placeholder="e.g. Amoxicillin 500mg TDS x 5 days" />
                <Input value={fmsCode} onChange={e => setFmsCode(e.target.value)} placeholder="FMS Code (if A/KK item prescribed by MO)" />
              </div>

              <div className="space-y-2">
                <Label>9. Health Education (tick if done)</Label>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={healthEdCompliance} onCheckedChange={v => setHealthEdCompliance(!!v)} /> Compliance
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={healthEdSideeffect} onCheckedChange={v => setHealthEdSideeffect(!!v)} /> Side-effect
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={healthEdTca} onCheckedChange={v => setHealthEdTca(!!v)} /> TCA Stat if worsening
                  </label>
                </div>
              </div>
            </div>
          </div>

          <Separator />
          <p className="text-sm text-muted-foreground text-center">
            Please complete clinical review based on findings & diagnosis. Tick (✓) if YES.
          </p>
        </CardContent>
      </Card>

      {/* SECTION 2 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT COLUMN */}
        <div className="space-y-4">
          {/* PNEUMONIA */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">PNEUMONIA</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <CBox label="1. ACUTE COUGH / SPUTUM" checked={checklist.pneumonia.acute_cough} onChange={v => updateChecklist("pneumonia", "acute_cough", v)} />
              <p className="text-xs font-medium text-muted-foreground mt-2">VITAL SIGN ABNORMALITIES: IF ANY</p>
              <CBox label="2. TACHYCARDIA (HR > 100 BPM)" checked={checklist.pneumonia.tachycardia} onChange={v => updateChecklist("pneumonia", "tachycardia", v)} />
              <CBox label="TACHYPNOEA (RR > 24 BPM)" checked={checklist.pneumonia.tachypnoea} onChange={v => updateChecklist("pneumonia", "tachypnoea", v)} />
              <CBox label="FEVER (>38°C)" checked={checklist.pneumonia.fever} onChange={v => updateChecklist("pneumonia", "fever", v)} />
              <CBox label="HYPOXEMIA (SPO2 <95)" checked={checklist.pneumonia.hypoxemia} onChange={v => updateChecklist("pneumonia", "hypoxemia", v)} />
              <CBox label="3. LUNG / CXR: CONSOLIDATION / PLEURAL EFFUSION" checked={checklist.pneumonia.consolidation} onChange={v => updateChecklist("pneumonia", "consolidation", v)} />
            </CardContent>
          </Card>

          {/* ACUTE OTITIS MEDIA */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">ACUTE OTITIS MEDIA</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">1. PRESENCE OF SYMPTOM:</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <CBox label="OTALGIA" checked={checklist.aom.otalgia} onChange={v => updateChecklist("aom", "otalgia", v)} />
                <CBox label="URTI SYMPTOMS" checked={checklist.aom.urti} onChange={v => updateChecklist("aom", "urti", v)} />
                <CBox label="FEVER >38" checked={checklist.aom.fever} onChange={v => updateChecklist("aom", "fever", v)} />
                <CBox label="POOR APPETITE" checked={checklist.aom.poor_appetite} onChange={v => updateChecklist("aom", "poor_appetite", v)} />
                <CBox label="CRYING/IRRITABLE" checked={checklist.aom.crying} onChange={v => updateChecklist("aom", "crying", v)} />
                <CBox label="VOMITTING/DIARRHEA" checked={checklist.aom.vomiting} onChange={v => updateChecklist("aom", "vomiting", v)} />
              </div>
              <div className="space-y-2 mt-2">
                <Label className="text-xs">2. OTOSCOPY FINDING: SIGN OF AOM?</Label>
                <RadioGroup value={checklist.aom.otoscopy_sign} onValueChange={v => updateChecklist("aom", "otoscopy_sign", v)} className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="yes" id="oto-yes" />
                    <Label htmlFor="oto-yes" className="text-xs cursor-pointer">YES</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="no" id="oto-no" />
                    <Label htmlFor="oto-no" className="text-xs cursor-pointer">NO</Label>
                  </div>
                </RadioGroup>
              </div>
            </CardContent>
          </Card>

          {/* PHARYNGITIS */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">PHARYNGITIS</CardTitle>
              <p className="text-xs text-muted-foreground">(Strep Score / Centor Score ≥3 to start antibiotic)</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "1. TEMPERATURE (>38°C)", field: "temp" as const },
                { label: "2. ABSENCE OF COUGH", field: "no_cough" as const },
                { label: "3. TENDER/ANTERIOR CERVICAL ADENOPATHY", field: "adenopathy" as const },
                { label: "4. TONSILAR EXUDATE OR SWELLING", field: "exudate" as const },
              ].map(item => (
                <div key={item.field} className="flex items-center justify-between text-sm">
                  <span className="text-xs">{item.label}</span>
                  <RadioGroup value={String(checklist.pharyngitis[item.field])} onValueChange={v => updateChecklist("pharyngitis", item.field, parseInt(v))} className="flex flex-wrap gap-2">
                    <div className="flex items-center gap-1">
                      <RadioGroupItem value="1" id={`${item.field}-1`} />
                      <Label htmlFor={`${item.field}-1`} className="text-xs cursor-pointer">1</Label>
                    </div>
                    <div className="flex items-center gap-1">
                      <RadioGroupItem value="0" id={`${item.field}-0`} />
                      <Label htmlFor={`${item.field}-0`} className="text-xs cursor-pointer">0</Label>
                    </div>
                  </RadioGroup>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm">
                <span className="text-xs">5. PATIENT AGE</span>
                <RadioGroup value={String(checklist.pharyngitis.age_score)} onValueChange={v => updateChecklist("pharyngitis", "age_score", parseInt(v))} className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-1">
                    <RadioGroupItem value="1" id="age-1" />
                    <Label htmlFor="age-1" className="text-xs cursor-pointer">3-14 (+1)</Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <RadioGroupItem value="0" id="age-0" />
                    <Label htmlFor="age-0" className="text-xs cursor-pointer">15-44 (0)</Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <RadioGroupItem value="-1" id="age--1" />
                    <Label htmlFor="age--1" className="text-xs cursor-pointer">&gt;45 (-1)</Label>
                  </div>
                </RadioGroup>
              </div>
              <Separator />
              <div className="flex items-center justify-between font-bold text-sm">
                <span>TOTAL STREP/CENTOR SCORE</span>
                <span className="text-lg">{centorTotal}</span>
              </div>
            </CardContent>
          </Card>

          {/* RHINOSINUSITIS */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">RHINOSINUSITIS</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <CBox label="1. SUDDEN ONSET NASAL OBSTRUCTION / DISCHARGE" checked={checklist.rhinosinusitis.nasal_obstruction} onChange={v => updateChecklist("rhinosinusitis", "nasal_obstruction", v)} />
              <CBox label="± REDUCTION / LOSS OF SMELL" checked={checklist.rhinosinusitis.smell_loss} onChange={v => updateChecklist("rhinosinusitis", "smell_loss", v)} />
              <p className="text-xs font-medium text-muted-foreground mt-2">2. CHECK FOR LIKELY ABRS (≥ 3 SYMPTOMS):</p>
              <CBox label="FEVER >38°C" checked={checklist.rhinosinusitis.fever} onChange={v => updateChecklist("rhinosinusitis", "fever", v)} />
              <CBox label="DISCOLOURED MUCUS" checked={checklist.rhinosinusitis.discoloured_mucus} onChange={v => updateChecklist("rhinosinusitis", "discoloured_mucus", v)} />
              <CBox label="DOUBLE SICKENING" checked={checklist.rhinosinusitis.double_sickening} onChange={v => updateChecklist("rhinosinusitis", "double_sickening", v)} />
              <CBox label="SEVERE LOCAL PAIN" checked={checklist.rhinosinusitis.severe_pain} onChange={v => updateChecklist("rhinosinusitis", "severe_pain", v)} />
              <CBox label="RAISED ESR/CRP" checked={checklist.rhinosinusitis.raised_esr} onChange={v => updateChecklist("rhinosinusitis", "raised_esr", v)} />
              <p className="text-xs text-muted-foreground italic mt-2">3. IF ≥ 3 EPISODES OF ABRS PER YEAR: REFER TO ENT</p>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-4">
          {/* SSTI */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">SKIN AND SOFT TISSUE INFECTION (SSTI)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <CBox label="1. ERYTHEMA/SWELLING/TEMP/PAIN/TENDER/FEVER" checked={checklist.ssti.erythema} onChange={v => updateChecklist("ssti", "erythema", v)} />
              <p className="text-xs font-medium text-muted-foreground mt-2">2. ABSCESS: <span className="italic">(Take pus for C&S before starting antibiotic)</span></p>
              <CBox label="INCISION AND DRAINAGE DONE?" checked={checklist.ssti.abscess_incision} onChange={v => updateChecklist("ssti", "abscess_incision", v)} />
              <CBox label="INADEQUATE DRAINAGE" checked={checklist.ssti.inadequate_drainage} onChange={v => updateChecklist("ssti", "inadequate_drainage", v)} />
              <CBox label="EXTENSIVE SURROUNDING CELLULITIS" checked={checklist.ssti.extensive_cellulitis} onChange={v => updateChecklist("ssti", "extensive_cellulitis", v)} />
              <CBox label="VALVULAR HEART DISEASE" checked={checklist.ssti.valvular_heart} onChange={v => updateChecklist("ssti", "valvular_heart", v)} />
              <CBox label="DIABETES MELLITUS" checked={checklist.ssti.diabetes} onChange={v => updateChecklist("ssti", "diabetes", v)} />
              <p className="text-xs font-medium text-muted-foreground mt-2">3. IMPETIGO:</p>
              <CBox label="LOCALISED" checked={checklist.ssti.impetigo_localised} onChange={v => updateChecklist("ssti", "impetigo_localised", v)} />
              <CBox label="GENERALISED" checked={checklist.ssti.impetigo_generalised} onChange={v => updateChecklist("ssti", "impetigo_generalised", v)} />
              <CBox label="4. CELLULITIS" checked={checklist.ssti.cellulitis} onChange={v => updateChecklist("ssti", "cellulitis", v)} />
            </CardContent>
          </Card>

          {/* UTI */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">URINARY TRACT INFECTION (UTI)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">1. URINALYSIS DONE:</p>
              <CBox label="a) Nit +ve (can initiate abx)" checked={checklist.uti.nit_positive} onChange={v => updateChecklist("uti", "nit_positive", v)} />
              <p className="text-xs text-muted-foreground mt-2">2. b) Nit -ve, Leu +ve:</p>
              <p className="text-xs text-muted-foreground italic">*Symptoms &gt;3 for suggestive UTI · *Symptoms &lt;3 send urine culture & TCA</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <CBox label="FREQUENCY" checked={checklist.uti.frequency} onChange={v => updateChecklist("uti", "frequency", v)} />
                <CBox label="DYSURIA" checked={checklist.uti.dysuria} onChange={v => updateChecklist("uti", "dysuria", v)} />
                <CBox label="HEMATURIA" checked={checklist.uti.hematuria} onChange={v => updateChecklist("uti", "hematuria", v)} />
                <CBox label="SUPRAPUBIC PAIN" checked={checklist.uti.suprapubic} onChange={v => updateChecklist("uti", "suprapubic", v)} />
                <CBox label="URGENCY" checked={checklist.uti.urgency} onChange={v => updateChecklist("uti", "urgency", v)} />
                <CBox label="POLYURIA" checked={checklist.uti.polyuria} onChange={v => updateChecklist("uti", "polyuria", v)} />
              </div>
              <div className="space-y-2 mt-2">
                <Label className="text-xs">3. ASYMPTOMATIC BACTERIURIA IN PREGNANCY:</Label>
                <Input value={checklist.uti.pregnancy_culture} onChange={e => updateChecklist("uti", "pregnancy_culture", e.target.value)} placeholder="Urine C&S Result — Please state" />
              </div>
              <p className="text-xs text-muted-foreground italic mt-2">4. SUSPECTED PYELONEPHRITIS: High grade fever / nausea / vomiting / flank pain / leukocytosis / costovertebral</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* PRESCRIBER'S NOTES */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <Label>Prescriber's Notes (if any)</Label>
          <Textarea value={prescriberNotes} onChange={e => setPrescriberNotes(e.target.value)} placeholder="Additional notes" />
        </CardContent>
      </Card>

      {/* SUBMIT */}
      <div className="space-y-3">
        {PATHWAY_CHECK_ENABLED && canUseAiSuggest && (
          <PathwayCheckBanner
            status={pathwayStatus}
            verdict={pathwayVerdict}
            explanation={pathwayExplanation}
          />
        )}
        <p className="text-xs text-muted-foreground text-center">
          Please attach this form together with the prescription or patient documents for pharmacy reference.
        </p>
        <Button className="w-full gap-2" style={{ backgroundColor: "#0b3b28" }} onClick={handleSubmit} disabled={submitting}>
          <ShieldCheck className="h-4 w-4" />
          {submitting ? "Submitting..." : "Submit for Specialist Approval"}
        </Button>
      </div>
    </div>
  );
}

function CBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={v => onChange(!!v)} />
      <span className="text-xs">{label}</span>
    </label>
  );
}
