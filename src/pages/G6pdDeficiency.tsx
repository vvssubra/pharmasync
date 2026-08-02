// src/pages/G6pdDeficiency.tsx
import { useState } from "react";
import { ShieldAlert, Search, AlertTriangle, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { searchDrugs, classesByRisk, type G6pdMatch } from "@/lib/g6pd";
import {
  G6PD_RISK_LABELS, G6PD_SOURCE_NOTE,
  type G6pdClass, type G6pdDrug, type G6pdRisk,
} from "@/lib/g6pdDrugs";

/** Definite risk is the more serious answer and reads as such. */
const RISK_STYLES: Record<G6pdRisk, { badge: string; panel: string }> = {
  definite: {
    badge: "bg-destructive/10 text-destructive border-destructive/30",
    panel: "border-destructive/30",
  },
  possible: {
    badge: "bg-amber-50 text-amber-800 border-amber-300",
    panel: "border-amber-300",
  },
};

function DrugName({ drug }: { drug: G6pdDrug }) {
  return (
    <>
      <span>{drug.name}</span>
      {drug.aka && <span className="text-muted-foreground"> ({drug.aka})</span>}
      {drug.qualifier && <span className="text-muted-foreground"> — {drug.qualifier}</span>}
    </>
  );
}

function UnverifiedNote({ note }: { note: string }) {
  return (
    <span className="mt-0.5 flex items-start gap-1 text-xs italic text-muted-foreground">
      <Info className="mt-0.5 h-3 w-3 shrink-0" />
      {note}
    </span>
  );
}

function SearchResults({ matches, query }: { matches: G6pdMatch[]; query: string }) {
  if (matches.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <p className="text-sm font-medium">
          “{query}” is not on this table.
        </p>
        {/* Absence from a summary table is not a safety clearance, and saying
            only "no results" would invite reading it as one. */}
        <p className="mt-1 text-sm text-muted-foreground">
          That does not mean it is safe in G6PD deficiency — this is one summary
          table, not a complete list. Check a full reference before deciding.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {matches.map((m, i) => (
        <div
          key={`${m.className}-${m.name}-${i}`}
          className={`rounded-lg border bg-card p-4 ${RISK_STYLES[m.risk].panel}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              <DrugName drug={m} />
            </p>
            <Badge variant="outline" className={`text-[11px] font-normal ${RISK_STYLES[m.risk].badge}`}>
              {G6PD_RISK_LABELS[m.risk]}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {m.className}
            {m.family && ` · ${m.family}`}
          </p>
          {m.unverified && <UnverifiedNote note={m.unverified} />}
        </div>
      ))}
    </div>
  );
}

function ClassBlock({ klass }: { klass: G6pdClass }) {
  // Families are the source's own sub-headings; drugs without one sit first.
  const families = [...new Set(klass.drugs.map(d => d.family))];

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">{klass.name}</h3>
      <div className="mt-2 space-y-2">
        {families.map(family => {
          const drugs = klass.drugs.filter(d => d.family === family);
          return (
            <div key={family ?? "_none"}>
              {family && (
                <p className="text-xs font-medium text-muted-foreground">{family}</p>
              )}
              <ul className={family ? "ml-3" : undefined}>
                {drugs.map(d => (
                  <li key={d.name} className="text-sm">
                    <DrugName drug={d} />
                    {d.unverified && <UnverifiedNote note={d.unverified} />}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RiskSection({ risk }: { risk: G6pdRisk }) {
  const classes = classesByRisk(risk);
  return (
    <section aria-labelledby={`risk-${risk}`}>
      <h2
        id={`risk-${risk}`}
        className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide"
      >
        <AlertTriangle
          className={`h-4 w-4 ${risk === "definite" ? "text-destructive" : "text-amber-600"}`}
        />
        {G6PD_RISK_LABELS[risk]}
      </h2>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {classes.map(c => (
          <ClassBlock key={`${c.risk}-${c.name}`} klass={c} />
        ))}
      </div>
    </section>
  );
}

export default function G6pdDeficiency() {
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const matches = searchDrugs(query);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <ShieldAlert className="h-6 w-6" />
          Drugs to Avoid in G6PD Deficiency
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search a drug to check its risk, or read the full table below.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a drug, e.g. paracetamol"
          aria-label="Search drugs"
          className="pl-9"
        />
      </div>

      {searching ? (
        <SearchResults matches={matches} query={query.trim()} />
      ) : (
        <div className="space-y-6">
          <RiskSection risk="definite" />
          <RiskSection risk="possible" />
        </div>
      )}

      <p className="max-w-[70ch] text-xs leading-relaxed text-muted-foreground">
        {G6PD_SOURCE_NOTE}
      </p>
    </div>
  );
}
