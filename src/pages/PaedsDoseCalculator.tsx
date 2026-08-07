// src/pages/PaedsDoseCalculator.tsx
import { useState } from "react";
import { Baby, AlertTriangle, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  evaluate, formatAmount, ageToMonths,
  CATEGORY_LABELS, CATEGORY_ORDER,
  type Drug, type DoseOutcome, type Patient,
} from "@/lib/paedsDose";
import { PAEDS_DRUGS, DISCLAIMER } from "@/lib/paedsDoses";

/** Renders one source's outcome. Never renders a bare number for a drug the
 *  source declines to dose — the words matter as much as the figure. */
function Outcome({ outcome }: { outcome: DoseOutcome }) {
  if (outcome.kind === "notRecommended") {
    return (
      <p className="flex items-start gap-1.5 text-sm text-amber-700">
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
      <p className="text-sm">
        <span className="text-base font-semibold text-foreground">
          {formatAmount(outcome.min, outcome.max, outcome.unit === "ml" ? "mL" : "mg")}
        </span>
        <span className="text-muted-foreground"> · {outcome.freq}</span>
        {outcome.note && <span className="text-muted-foreground"> ({outcome.note})</span>}
      </p>
      {/* The arithmetic, shown rather than trusted. */}
      {outcome.basis && (
        <p className="text-xs text-muted-foreground">{outcome.basis}</p>
      )}
    </div>
  );
}

function DrugCard({ drug, patient }: { drug: Drug; patient: Patient }) {
  const mims = evaluate(drug.mims, patient);

  return (
    <div
      data-testid={`drug-${drug.id}`}
      className={`flex flex-col rounded-lg border p-4 ${
        drug.frequentlyUsed ? "border-primary/40 bg-primary/[0.04]" : "bg-card"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {drug.frequentlyUsed && (
            <Star className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" aria-label="Frequently used" />
          )}
          {drug.name}
        </h3>
        {/* Reference only — the dose is the same figure whichever bottle it is
            drawn from, so this is a label rather than a control. */}
        <span className="text-xs text-muted-foreground">
          {drug.preparations.map(p => p.label).join(" · ")}
        </span>
      </div>

      {drug.caution && (
        <p className="mt-1 text-xs italic text-muted-foreground">{drug.caution}</p>
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Baby className="h-6 w-6" />
          Paediatric Dose Calculator
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter age and weight to see the MIMS dose, with the volume to draw up for each
          preparation.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Patient</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="age-years">Age — years</Label>
              <Input
                id="age-years" type="number" inputMode="numeric" min={0} max={18}
                value={years} onChange={e => setYears(e.target.value)} placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="age-months">Age — months</Label>
              <Input
                id="age-months" type="number" inputMode="numeric" min={0} max={11}
                value={months} onChange={e => setMonths(e.target.value)} placeholder="0"
              />
              {/* The fever bands start at 3-5 and 6-23 months, so years alone
                  cannot resolve an infant. */}
              <p className="text-xs text-muted-foreground">0–11</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="weight">Weight (kg)</Label>
              <Input
                id="weight" type="number" inputMode="decimal" min={0} step="0.1"
                value={weight} onChange={e => setWeight(e.target.value)} placeholder="e.g. 14.5"
              />
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

          <div className="mt-4 flex items-center gap-2 border-t pt-4">
            <Switch
              id="frequent-only"
              checked={frequentOnly}
              onCheckedChange={setFrequentOnly}
            />
            <Label htmlFor="frequent-only" className="flex items-center gap-1.5 font-normal">
              <Star className="h-3.5 w-3.5 fill-primary text-primary" />
              Frequently used only
            </Label>
          </div>
        </CardContent>
      </Card>

      {!patient ? (
        <p className="text-sm text-muted-foreground">
          Enter an age and a weight to calculate doses.
        </p>
      ) : (
        <div className="space-y-6">
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
              <section key={category} aria-labelledby={`cat-${category}`}>
                <h2
                  id={`cat-${category}`}
                  className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {CATEGORY_LABELS[category]}
                </h2>
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

      <p className="max-w-[70ch] text-xs leading-relaxed text-muted-foreground">
        {DISCLAIMER}
      </p>
    </div>
  );
}
