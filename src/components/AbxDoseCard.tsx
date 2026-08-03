import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calculator, AlertTriangle } from "lucide-react";
import type { LocalDoseMatch } from "@/lib/abxDose";

interface AbxDoseCardProps {
  match: LocalDoseMatch;
  onUse: (regimenText: string) => void;
}

/** Deterministic, locally-computed antibiotic options — no network call.
 *  Lists every drug NAG_PATHWAYS documents for the matched pathway (in the
 *  source's own Preferred-then-Alternative order), weight-computed where a
 *  children's table allows it. Rendered above the AI Suggest button the
 *  moment a weight and a matching checklist tick are both present; the AI
 *  button stays as the fallback for indications with no local rule. */
export default function AbxDoseCard({ match, onUse }: AbxDoseCardProps) {
  const { options, source, hasAllergy } = match;
  return (
    <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-700">
        <Calculator className="h-3.5 w-3.5" />
        Local NAG 2024 options
      </div>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={`${opt.drug}-${i}`} className="flex items-start justify-between gap-2 rounded border border-indigo-200 bg-white/70 p-2">
            <div className="space-y-0.5 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-indigo-900">{opt.text}</span>
                <Badge variant="outline" className="text-[10px] border-indigo-300 text-indigo-700">{opt.tier}</Badge>
                {hasAllergy && opt.penicillinClass && (
                  <Badge variant="outline" className="gap-1 text-[10px] border-amber-400 bg-amber-50 text-amber-700">
                    <AlertTriangle className="h-2.5 w-2.5" /> contains penicillin
                  </Badge>
                )}
              </div>
              {opt.basis && <p className="text-xs text-indigo-700">{opt.basis}</p>}
              {opt.capped && <p className="text-xs text-indigo-700">Dose capped at label maximum.</p>}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0"
              onClick={() => onUse(opt.text)}
            >
              Use
            </Button>
          </div>
        ))}
      </div>
      <p className="text-xs text-indigo-600">
        Calculated locally from {source} — verify before prescribing.
      </p>
    </div>
  );
}
