import { Button } from "@/components/ui/button";
import { Calculator } from "lucide-react";
import type { LocalDoseMatch } from "@/lib/abxDose";

interface AbxDoseCardProps {
  match: LocalDoseMatch;
  onUse: (regimenText: string) => void;
}

/** Deterministic, locally-computed weight-based antibiotic dose — no network
 *  call. Rendered above the AI Suggest button in the antibiotic form the
 *  moment a weight and a matching NAG pathway are both present; the AI
 *  button stays as the fallback for indications with no local rule. */
export default function AbxDoseCard({ match, onUse }: AbxDoseCardProps) {
  const { result, source, warning, alternative } = match;
  return (
    <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 space-y-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 flex-1">
          <div className="font-semibold text-indigo-900 flex items-center gap-1.5">
            <Calculator className="h-3.5 w-3.5" />
            {result.text}
          </div>
          <p className="text-xs text-indigo-800">{result.basis}</p>
          {result.capped && (
            <p className="text-xs text-indigo-800">Dose capped at label maximum.</p>
          )}
          {warning && <p className="text-xs text-amber-700">{warning}</p>}
        </div>
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={() => onUse(result.text)}
        >
          Use
        </Button>
      </div>

      {alternative && (
        <div className="flex items-start justify-between gap-2 border-t border-indigo-200 pt-2">
          <div className="space-y-1 flex-1">
            <p className="text-xs font-medium text-indigo-700">{alternative.label}</p>
            <p className="font-medium text-indigo-900">{alternative.result.text}</p>
            <p className="text-xs text-indigo-800">{alternative.result.basis}</p>
            {alternative.result.capped && (
              <p className="text-xs text-indigo-800">Dose capped at label maximum.</p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            onClick={() => onUse(alternative.result.text)}
          >
            Use
          </Button>
        </div>
      )}

      <p className="text-xs text-indigo-600">
        Calculated locally from {source} — verify before prescribing.
      </p>
    </div>
  );
}
