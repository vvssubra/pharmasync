// src/pages/PaedsDoseCalculator.tsx
import { useState } from "react";
import { Baby, AlertTriangle, Star, Printer, RotateCcw, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  evaluate, formatAmount, ageToMonths,
  CATEGORY_LABELS, CATEGORY_ORDER,
  type Drug, type DoseOutcome, type Patient,
} from "@/lib/paedsDose";
import { PAEDS_DRUGS, DISCLAIMER } from "@/lib/paedsDoses";

/** A handful of clinic-common profiles that fill the form in one tap. */
const PRESETS = [
  { label: "Infant (6m, 7.5kg)", years: "0", months: "6", weight: "7.5" },
  { label: "Toddler (2y, 12kg)", years: "2", months: "0", weight: "12" },
  { label: "Child (3y, 18kg)", years: "3", months: "0", weight: "18" },
  { label: "Child (6y, 22kg)", years: "6", months: "0", weight: "22" },
];

/** Renders one source's outcome. Never renders a bare number for a drug the
 *  source declines to dose — the words matter as much as the figure. */
function Outcome({ outcome }: { outcome: DoseOutcome }) {
  if (outcome.kind === "notRecommended") {
    return (
      <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-800">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {outcome.note}
      </p>
    );
  }
  if (outcome.kind === "noData") {
    return <p className="text-sm text-muted-foreground">{outcome.note}</p>;
  }
  if (outcome.kind === "outOfBand") {
    return <p className="text-sm text-muted-foreground">No band published for this age</p>;
  }

  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-2xl font-extrabold tracking-tight text-primary">
          {formatAmount(outcome.min, outcome.max, outcome.unit === "ml" ? "mL" : "mg")}
        </span>
        <span className="text-sm font-semibold text-foreground">{outcome.freq}</span>
        {outcome.note && <span className="text-xs text-muted-foreground">({outcome.note})</span>}
      </p>
      {/* The arithmetic, shown rather than trusted. */}
      {outcome.basis && (
        <p className="mt-1 font-mono text-xs text-muted-foreground">{outcome.basis}</p>
      )}
    </div>
  );
}

function DrugCard({ drug, patient }: { drug: Drug; patient: Patient }) {
  const mims = evaluate(drug.mims, patient);
  const contraindicated = mims.kind === "notRecommended";

  return (
    <div
      data-testid={`drug-${drug.id}`}
      className={cn(
        "flex flex-col rounded-xl border p-4 shadow-sm transition-shadow hover:shadow-md",
        contraindicated
          ? "border-amber-200 bg-amber-50/50"
          : drug.frequentlyUsed
          ? "border-primary/30 bg-primary/[0.03]"
          : "border-border bg-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          {drug.frequentlyUsed && (
            <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Frequently used" />
          )}
          {drug.name}
        </h3>
        {/* Reference only — the dose is the same figure whichever bottle it is
            drawn from, so this is a label rather than a control. */}
        <span className="font-mono text-[11px] text-muted-foreground">
          {drug.preparations.map(p => p.label).join(" · ")}
        </span>
      </div>

      {drug.caution && (
        <p className="mt-1 text-xs italic leading-snug text-muted-foreground">{drug.caution}</p>
      )}

      <div className="mt-3">
        <Outcome outcome={mims} />
      </div>
    </div>
  );
}

export default function PaedsDoseCalculator() {
  const [years, setYears] = useState("");
  const [months, setMonths] = useState("");
  const [weight, setWeight] = useState("");
  const [frequentOnly, setFrequentOnly] = useState(false);

  const yearsNum = Number(years);
  const monthsNum = months === "" ? 0 : Number(months);
  const weightNum = Number(weight);

  const hasAge = years !== "" || months !== "";
  const ageValid = hasAge && Number.isFinite(yearsNum) && Number.isFinite(monthsNum)
    && yearsNum >= 0 && monthsNum >= 0 && monthsNum < 12;
  const weightValid = weight !== "" && Number.isFinite(weightNum) && weightNum > 0 && weightNum <= 100;

  const patient: Patient | null = ageValid && weightValid
    ? { ageMonths: ageToMonths(yearsNum, monthsNum), weightKg: weightNum }
    : null;

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setYears(preset.years);
    setMonths(preset.months);
    setWeight(preset.weight);
  }

  const activePreset = PRESETS.find(
    p => p.years === (years || "0") && p.months === (months || "0") && p.weight === weight,
  );

  function handleReset() {
    setYears("");
    setMonths("");
    setWeight("");
    setFrequentOnly(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Baby className="h-6 w-6" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              Paediatric Dose Calculator
              <Badge variant="secondary" className="font-mono text-[10px] font-normal">
                MOH Clinical
              </Badge>
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Enter age and weight to see the MIMS dose, with the volume to draw up for each
              preparation.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print Dosing Sheet
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-6 py-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            <span className="text-xs font-bold uppercase tracking-wider text-foreground">
              Patient Demographics &amp; Body Metrics
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-muted-foreground">Quick presets:</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className={cn(
                  "rounded border px-2 py-1 transition",
                  activePreset?.label === preset.label
                    ? "border-primary bg-primary/10 font-semibold text-primary shadow-sm"
                    : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-primary",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <CardContent className="p-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="age-years" className="text-xs font-semibold">Age — years</Label>
              <div className="relative">
                <Input
                  id="age-years" type="number" inputMode="numeric" min={0} max={18}
                  value={years} onChange={e => setYears(e.target.value)} placeholder="0"
                  className="pr-9 text-base font-semibold"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground">
                  yr
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">Paediatric range: 0 to 18 years</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="age-months" className="text-xs font-semibold">Age — months</Label>
              <div className="relative">
                <Input
                  id="age-months" type="number" inputMode="numeric" min={0} max={11}
                  value={months} onChange={e => setMonths(e.target.value)} placeholder="0"
                  className="pr-9 text-base font-semibold"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground">
                  mo
                </span>
              </div>
              {/* The fever bands start at 3-5 and 6-23 months, so years alone
                  cannot resolve an infant. */}
              <p className="text-[11px] text-muted-foreground">0–11</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weight" className="text-xs font-semibold">Weight (kg)</Label>
              <div className="relative">
                <Input
                  id="weight" type="number" inputMode="decimal" min={0} step="0.1"
                  value={weight} onChange={e => setWeight(e.target.value)} placeholder="e.g. 14.5"
                  className="pr-9 border-primary/40 bg-primary/[0.03] text-base font-semibold text-primary ring-1 ring-primary/20 focus-visible:ring-primary"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-bold text-primary">
                  kg
                </span>
              </div>
              <p className="flex items-center gap-1 text-[11px] font-medium text-primary/80">
                <AlertTriangle className="h-3 w-3" />
                Primary baseline for weight-based calculations
              </p>
            </div>
          </div>

          {hasAge && !ageValid && (
            <p className="mt-3 text-sm text-destructive">
              Months must be between 0 and 11 — use the years field for anything longer.
            </p>
          )}
          {weight !== "" && !weightValid && (
            <p className="mt-3 text-sm text-destructive">
              Enter a weight between 0 and 100 kg.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
            <div className="flex items-center gap-3">
              <Switch
                id="frequent-only"
                checked={frequentOnly}
                onCheckedChange={setFrequentOnly}
              />
              <Label htmlFor="frequent-only" className="flex items-center gap-1.5 text-xs font-semibold">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                Frequently used only
              </Label>
            </div>

            {patient && (
              <div className="flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Active profile: {yearsNum} yr {monthsNum} mo · {weightNum} kg
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!patient ? (
        <p className="text-sm text-muted-foreground">
          Enter an age and a weight to calculate doses.
        </p>
      ) : (
        <div className="space-y-7">
          {CATEGORY_ORDER.map((category) => {
            // Starred drugs sort to the front of their own category rather than
            // into a separate block: every drug keeps exactly one home, so
            // "where is paracetamol" always answers "under Fever".
            const drugs = PAEDS_DRUGS
              .filter(d => d.category === category)
              .filter(d => !frequentOnly || d.frequentlyUsed)
              .sort((a, b) => Number(!!b.frequentlyUsed) - Number(!!a.frequentlyUsed));
            if (drugs.length === 0) return null;
            return (
              <section key={category} aria-labelledby={`cat-${category}`} className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 border-b pb-1.5">
                  <div className="flex items-baseline gap-2">
                    <h2
                      id={`cat-${category}`}
                      className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                    >
                      {CATEGORY_LABELS[category]}
                    </h2>
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {drugs.length} {drugs.length === 1 ? "drug" : "drugs"} listed
                  </span>
                </div>
                {/* auto-fit rather than fixed breakpoints: the card count per
                    row follows the space available, including when the sidebar
                    is open. */}
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
                  {drugs.map(d => (
                    <DrugCard key={d.id} drug={d} patient={patient} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border bg-muted/40 p-5 text-xs leading-relaxed text-muted-foreground">
        <div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 text-primary" />
          Clinical Disclaimer
        </div>
        <p className="max-w-[70ch]">{DISCLAIMER}</p>
      </div>
    </div>
  );
}
