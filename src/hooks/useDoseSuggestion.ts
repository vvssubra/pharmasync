import { useState, useEffect, useRef } from "react";
import { suggestDose, type DoseMatch } from "@/lib/knowledgeClient";
import type { DoseQuery } from "@/lib/doseQuery";

export type DoseSuggestionStatus = "idle" | "loading" | "ok" | "error";

interface DoseSuggestionResult {
  matches: DoseMatch[];
  message?: string;
  status: DoseSuggestionStatus;
}

const DEBOUNCE_MS = 1500;

export function useDoseSuggestion(
  query: DoseQuery | null,
  options?: { enabled?: boolean }
): DoseSuggestionResult {
  const enabled = options?.enabled ?? true;
  const [matches, setMatches] = useState<DoseMatch[]>([]);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<DoseSuggestionStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !query) {
      setStatus("idle");
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      setStatus("loading");

      try {
        const result = await suggestDose(query);
        setMatches(result.matches);
        setMessage(result.message);
        setStatus("ok");
      } catch {
        setMatches([]);
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // DoseQuery has exactly two fields (see src/lib/doseQuery.ts), and both are
    // listed, so these deps are exhaustive in effect even though the rule wants
    // the object itself. Depending on `query` would be a regression: callers
    // build it inline each render (AntibioticForm.tsx), so a new object identity
    // every render would reset the debounce timer below forever and the lookup
    // would never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, query?.query, query?.patient_group]);

  return { matches, message, status };
}
