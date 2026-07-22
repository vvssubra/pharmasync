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
  }, [enabled, query?.query, query?.patient_group]);

  return { matches, message, status };
}
