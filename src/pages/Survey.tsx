import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { MascotRunner } from "@/components/survey/MascotRunner";
import { LikertScale } from "@/components/survey/LikertScale";
import "./survey.css";

const LIKERT_QUESTIONS: { name: `q${1 | 2 | 3 | 4 | 5 | 6 | 7}`; label: string }[] = [
  { name: "q1", label: "1. The current manual antibiotic (AMS) form is easy to complete." },
  { name: "q2", label: "2. Filling the manual form takes a reasonable amount of time." },
  { name: "q3", label: "3. I always know which antibiotics need specialist approval." },
  { name: "q4", label: "4. Getting specialist approval through the manual process is fast." },
  { name: "q5", label: "5. The manual form rarely gets lost or delayed." },
  { name: "q6", label: "6. I can easily track the status of my antibiotic request." },
  { name: "q7", label: "7. Overall, I am satisfied with the current manual AMS process." },
];

const likertField = z
  .string()
  .min(1, "Please select an answer from 1 to 5.");

const formSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name."),
  email: z.string().trim().min(1, "Please enter your email.").email("Enter a valid email address."),
  role: z.string().min(1, "Please select your role."),
  q1: likertField,
  q2: likertField,
  q3: likertField,
  q4: likertField,
  q5: likertField,
  q6: likertField,
  q7: likertField,
  frustration: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const ROLES = [
  { value: "mo", label: "Medical Officer (MO)" },
  { value: "fms", label: "FMS Specialist" },
  { value: "pharmacist", label: "Pharmacist" },
  { value: "pharmacy_staff", label: "Pharmacy Assistant / Staff" },
];

const defaultValues: FormValues = {
  name: "",
  email: "",
  role: "",
  q1: "",
  q2: "",
  q3: "",
  q4: "",
  q5: "",
  q6: "",
  q7: "",
  frustration: "",
};

export default function Survey() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  const values = watch();

  const onSubmit = async (data: FormValues) => {
    const SHEETS_ENDPOINT = import.meta.env.VITE_SHEETS_ENDPOINT as string | undefined;
    if (!SHEETS_ENDPOINT) {
      toast.error("Survey is not configured yet. Please try again later.");
      return;
    }
    setSubmitting(true);
    try {
      // no-cors: Apps Script Web Apps don't return CORS headers, so the
      // response is opaque. text/plain avoids a CORS preflight. We treat a
      // resolved fetch (no network error) as success.
      await fetch(SHEETS_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(data),
      });
      setSubmitted(true);
    } catch {
      toast.error("Couldn't submit your response. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="survey-root">
        <div className="survey-shell">
          <div className="survey-card survey-success">
            <div className="survey-success-mark">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h1 className="survey-title">Thank you</h1>
            <p className="survey-intro">
              Your feedback on the manual AMS form has been recorded.
            </p>
            <button
              type="button"
              className="survey-submit"
              style={{ marginTop: "1.5rem", maxWidth: "220px", marginInline: "auto" }}
              onClick={() => {
                reset(defaultValues);
                setSubmitted(false);
              }}
            >
              Submit another response
            </button>
          </div>
          <p className="survey-footer">Klinik Kesihatan Kempas — Digital Bin Card System</p>
        </div>
      </div>
    );
  }

  return (
    <div className="survey-root">
      <div className="survey-shell">
        <header className="survey-header">
          <MascotRunner />
          <p className="survey-eyebrow">PharmaSync</p>
          <h1 className="survey-title">Pre-Talk Survey — The Manual AMS Form</h1>
          <p className="survey-intro">
            Before we begin — tell us honestly about your experience with the current
            manual antibiotic approval process.
          </p>
        </header>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="survey-card">
            <div className="survey-field">
              <label className="survey-label" htmlFor="name">
                Your name *
              </label>
              <input
                id="name"
                className="survey-input"
                placeholder="Full name"
                autoComplete="name"
                {...register("name")}
              />
              {errors.name && <p className="survey-error">{errors.name.message}</p>}
            </div>

            <div className="survey-field">
              <label className="survey-label" htmlFor="email">
                Your email *
              </label>
              <input
                id="email"
                type="email"
                className="survey-input"
                placeholder="name@moh.gov.my"
                autoComplete="email"
                {...register("email")}
              />
              {errors.email && <p className="survey-error">{errors.email.message}</p>}
            </div>

            <div className="survey-field">
              <label className="survey-label" htmlFor="role">
                Your role *
              </label>
              <select
                id="role"
                className="survey-select-trigger"
                {...register("role")}
                defaultValue=""
              >
                <option value="" disabled>
                  Select your role
                </option>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              {errors.role && <p className="survey-error">{errors.role.message}</p>}
            </div>
          </div>

          <div className="survey-card">
            {LIKERT_QUESTIONS.map((q, i) => (
              <div
                className="survey-field"
                key={q.name}
                style={i === LIKERT_QUESTIONS.length - 1 ? { marginBottom: 0 } : undefined}
              >
                <p className="survey-question-title">{q.label}</p>
                <LikertScale
                  name={q.name}
                  value={values[q.name]}
                  onChange={(v) => setValue(q.name, v, { shouldValidate: true })}
                  error={!!errors[q.name]}
                />
                {errors[q.name] && (
                  <p className="survey-error" style={{ textAlign: "center" }}>
                    {errors[q.name]?.message}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="survey-card">
            <div className="survey-field" style={{ marginBottom: 0 }}>
              <label className="survey-label" htmlFor="frustration">
                Biggest frustration with the current manual form?
              </label>
              <p className="survey-intro" style={{ margin: "0 0 0.75rem", textAlign: "left" }}>
                Optional
              </p>
              <textarea
                id="frustration"
                className="survey-textarea"
                placeholder="Tell us what slows you down…"
                {...register("frustration")}
              />
            </div>
          </div>

          <button type="submit" className="survey-submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit"}
          </button>

          <p className="survey-privacy">
            Your name and email help us follow up and de-duplicate responses. Shared
            only with the PharmaSync project team.
          </p>
        </form>

        <p className="survey-footer">Klinik Kesihatan Kempas — Digital Bin Card System</p>
      </div>
    </div>
  );
}
