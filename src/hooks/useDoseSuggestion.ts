// Debounced React Query wrapper around the knowledge-service dose lookup.
// The antibiotic form recomputes its query on every keystroke/checkbox; the
// debounce keeps us from hammering the sidecar mid-typing.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { suggestDose, type DoseMatch, type SuggestDoseRequest } from "@/lib/knowledgeClient";

export type DoseStatus = "idle" | "loading" | "ok" | "error";

export interface DoseSuggestionResult {
  matches: DoseMatch[];
  status: DoseStatus;
  message?: string;
}

const DEBOUNCE_MS = 800;

export function useDoseSuggestion(
  request: SuggestDoseRequest | null,
  options?: { enabled?: boolean; debounceMs?: number },
): DoseSuggestionResult {
  const enabled = options?.enabled ?? true;
  const debounceMs = options?.debounceMs ?? DEBOUNCE_MS;
  const [debounced, setDebounced] = useState<SuggestDoseRequest | null>(null);

  // Serialize for stable effect deps — request is a fresh object every render.
  const requestKey = request ? JSON.stringify(request) : null;

  useEffect(() => {
    if (!enabled || !requestKey) {
      setDebounced(null);
      return;
    }
    const timer = setTimeout(() => {
      setDebounced(JSON.parse(requestKey) as SuggestDoseRequest);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [enabled, requestKey, debounceMs]);

  const query = useQuery({
    queryKey: ["dose-suggestion", debounced?.query, debounced?.patient_group],
    queryFn: () => suggestDose(debounced!),
    enabled: enabled && !!debounced?.query,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  if (!enabled || !debounced?.query) {
    return { matches: [], status: "idle" };
  }
  if (query.isError) {
    return { matches: [], status: "error" };
  }
  if (query.isSuccess) {
    return { matches: query.data.matches, status: "ok", message: query.data.message };
  }
  return { matches: [], status: "loading" };
}
