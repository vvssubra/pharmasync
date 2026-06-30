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

const DEBOUNCE_MS = 1500;

function hasContent(fields: FormFields): boolean {
  return !!(fields.diagnosis || fields.antibiotic || fields.indication);
}

export function usePathwayCheck(fields: FormFields, options?: { enabled?: boolean }): PathwayCheckResult {
  const enabled = options?.enabled ?? true;
  const [verdict, setVerdict] = useState<PathwayVerdict>(null);
  const [explanation, setExplanation] = useState("");
  const [status, setStatus] = useState<PathwayStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [
    enabled,
    fields.diagnosis,
    fields.antibiotic,
    fields.indication,
    fields.duration_days,
    fields.allergy_status,
    fields.patient_age,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(fields.checklist),
  ]);

  return { verdict, explanation, status };
}
