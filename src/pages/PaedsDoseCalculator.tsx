// src/pages/PaedsDoseCalculator.tsx
import { useState } from "react";
import { Baby, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  evaluate, toMl, formatAmount, ageToMonths,
  CATEGORY_LABELS, CATEGORY_ORDER,
  type Drug, type DoseOutcome, type Preparation, type Patient,
} from "@/lib/paedsDose";
import { PAEDS_DRUGS, DISCLAIMER } from "@/lib/paedsDoses";

/** Renders one source's outcome. Never renders a bare number for a drug the
 *  source declines to dose — the words matter as much as the figure. */
function Outcome({ outcome, prep }: { outcome: DoseOutcome; prep: Preparation }) {
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

  const volume = toMl(outcome, prep);
  const isAlreadyVolume = outcome.unit === "ml";

  return (
    <p className="text-sm">
      <span className="font-medium text-foreground">
        {formatAmount(outcome.min, outcome.max, outcome.unit === "ml" ? "mL" : "mg")}
      </span>
      {volume && !isAlreadyVolume && (
        <span className="text-foreground"> · {formatAmount(volume.min, volume.max, "mL")}</span>
      )}
      <span className="text-muted-foreground"> · {outcome.freq}</span>
      {outcome.note && <span className="text-muted-foreground"> ({outcome.note})</span>}
    </p>
  );
}

function DrugCard({ drug, patient }: { drug: Drug; patient: Patient }) {
  const [prepIndex, setPrepIndex] = useState(0);
  const prep = drug.preparations[prepIndex] ?? drug.preparations[0];

  const mims = evaluate(drug.mims, patient);
  const shann = evaluate(drug.shann, patient);

  return (
    <div data-testid={`drug-${drug.id}`} className="flex flex-col rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">{drug.name}</h3>
        {drug.preparations.length > 1 ? (
          <Select value={String(prepIndex)} onValueChange={(v) => setPrepIndex(Number(v))}>
            <SelectTrigger
              className="h-7 w-32 text-xs"
              aria-label={`Preparation for ${drug.name}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {drug.preparations.map((p, i) => (
                <SelectItem key={p.label} value={String(i)} className="text-xs">{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">{prep.label}</span>
        )}
      </div>

      {drug.caution && (
        <p className="mt-1 text-xs italic text-muted-foreground">{drug.caution}</p>
      )}

      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">MIMS</p>
          <Outcome outcome={mims} prep={prep} />
        </div>
        <div className="border-t pt-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Frank Shann</p>
          <Outcome outcome={shann} prep={prep} />
        </div>
      </div>
    </div>
  );
}

export default function PaedsDoseCalculator() {
  const [years, setYears] = useState("");
  const [months, setMonths] = useState("");
  const [weight, setWeight] = useState("");

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
          Enter age and weight to see the MIMS and Frank Shann doses side by side, with the volume
          to draw up for each preparation.
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
        </CardContent>
      </Card>

      {!patient ? (
        <p className="text-sm text-muted-foreground">
          Enter an age and a weight to calculate doses.
        </p>
      ) : (
        <div className="space-y-6">
          {CATEGORY_ORDER.map((category) => {
            const drugs = PAEDS_DRUGS.filter(d => d.category === category);
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
