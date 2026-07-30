import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PathwayVerdict =
  | "supported"
  | "review"
  | "not_supported"
  | "refer_specialist"
  | null;

export type PathwayStatus = "idle" | "checking" | "done" | "error" | "unavailable";

interface FormFields {
  diagnosis?: string;
  antibiotic?: string;
  indication?: string;
  duration_days?: number;
  allergy_status?: string;
  checklist?: Record<string, unknown>;
  patient_age?: number;
}

interface PathwayCheckResult {
  verdict: PathwayVerdict;
  explanation: string;
  status: PathwayStatus;
}

// pathway-check is now a rule-based lookup (no LLM call), so a short debounce
// is enough to coalesce rapid keystrokes without the form feeling laggy.
const DEBOUNCE_MS = 400;

function hasContent(fields: FormFields): boolean {
  return !!(fields.diagnosis || fields.antibiotic || fields.indication);
}

export function usePathwayCheck(fields: FormFields, options?: { enabled?: boolean }): PathwayCheckResult {
  const enabled = options?.enabled ?? true;
  const [verdict, setVerdict] = useState<PathwayVerdict>(null);
  const [explanation, setExplanation] = useState("");
  const [status, setStatus] = useState<PathwayStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Serialised so the effect re-runs on checklist *content* rather than object
  // identity; hoisted out of the dep array so the rule can check it statically.
  const checklistKey = JSON.stringify(fields.checklist);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    if (!hasContent(fields)) {
      setStatus("idle");
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      setStatus("checking");

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token ?? "";

        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pathway-check`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify(fields),
          }
        );

        if (resp.status === 503 || resp.status === 429) {
          setStatus("unavailable");
          setVerdict(null);
          return;
        }

        if (!resp.ok) {
          setStatus("error");
          return;
        }

        const data = await resp.json() as { verdict?: PathwayVerdict; explanation?: string };
        setVerdict(data.verdict ?? null);
        setExplanation(data.explanation ?? "");
        setStatus("done");
      } catch {
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Every field of FormFields is listed individually, so these deps are
    // exhaustive in effect even though the rule wants `fields` itself.
    // Depending on the object would be a regression: the caller builds it
    // inline each render (AntibioticForm.tsx), so a new identity every render
    // would reset the debounce timer above forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    fields.diagnosis,
    fields.antibiotic,
    fields.indication,
    fields.duration_days,
    fields.allergy_status,
    fields.patient_age,
    checklistKey,
  ]);

  return { verdict, explanation, status };
}
