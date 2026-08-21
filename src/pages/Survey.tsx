import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { LikertScale } from "@/components/survey/LikertScale";
import "./survey.css";

type LikertName =
  | `a${1 | 2 | 3 | 4 | 5 | 6}`
  | `b${1 | 2 | 3 | 4}`
  | `c${1 | 2 | 3}`;

interface LikertSection {
  title: string;
  questions: { name: LikertName; label: string }[];
}

const LIKERT_SECTIONS: LikertSection[] = [
  {
    title: "Section A: Application and Approval Process",
    questions: [
      { name: "a1", label: "1. The current manual antibiotic (AMS) form is easy to complete." },
      { name: "a2", label: "2. Filling the manual form takes a reasonable amount of time." },
      { name: "a3", label: "3. The current process for requesting antibiotics involves a reasonable number of steps." },
      { name: "a4", label: "4. I always know which antibiotics need specialist approval." },
      { name: "a5", label: "5. The current specialist approval process can be completed within an acceptable amount of time." },
      { name: "a6", label: "6. I can complete the request and approval process without using multiple forms, records or communication channels." },
    ],
  },
  {
    title: "Section B: Tracking of Requests and Approvals",
    questions: [
      { name: "b1", label: "1. I can easily check whether my medication request is pending, approved or rejected." },
      { name: "b2", label: "2. I receive timely notification when a specialist decision has been made regarding my request." },
      { name: "b3", label: "3. I can retrieve the approval details or approval code without repeatedly contacting the specialist/FMS or pharmacy." },
      { name: "b4", label: "4. Medication request records are rarely delayed during the current process." },
    ],
  },
  {
    title: "Section C: Overall User Experience",
    questions: [
      { name: "c1", label: "1. The current medication request and approval process supports an efficient clinical workflow." },
      { name: "c2", label: "2. The current process allows me to obtain medication approval without causing unnecessary delays in patient care." },
      { name: "c3", label: "3. Overall, I am satisfied with the current manual medication request, approval and monitoring process." },
    ],
  },
];

const OPEN_QUESTIONS: { name: `o${1 | 2 | 3 | 4}`; label: string; placeholder: string }[] = [
  {
    name: "o1",
    label: "Which part of the current medication request and approval process is the most time-consuming?",
    placeholder: "e.g. waiting for specialist sign-off, filling patient details…",
  },
  {
    name: "o2",
    label: "Which steps in the current process do you consider repetitive or unnecessary?",
    placeholder: "e.g. re-entering the same details on multiple forms…",
  },
  {
    name: "o3",
    label: "Have you experienced any delay, missing form or difficulty retrieving an approval record? Please describe briefly.",
    placeholder: "Tell us what happened…",
  },
  {
    name: "o4",
    label: "What is the single most important improvement you would like to see in the current process?",
    placeholder: "Your top priority…",
  },
];

const likertField = z
  .string()
  .min(1, "Please select an answer from 1 to 5.");

const formSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name."),
  email: z.string().trim().min(1, "Please enter your email.").email("Enter a valid email address."),
  role: z.string().min(1, "Please select your role."),
  a1: likertField,
  a2: likertField,
  a3: likertField,
  a4: likertField,
  a5: likertField,
  a6: likertField,
  b1: likertField,
  b2: likertField,
  b3: likertField,
  b4: likertField,
  c1: likertField,
  c2: likertField,
  c3: likertField,
  o1: z.string().optional(),
  o2: z.string().optional(),
  o3: z.string().optional(),
  o4: z.string().optional(),
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
  a1: "",
  a2: "",
  a3: "",
  a4: "",
  a5: "",
  a6: "",
  b1: "",
  b2: "",
  b3: "",
  b4: "",
  c1: "",
  c2: "",
  c3: "",
  o1: "",
  o2: "",
  o3: "",
  o4: "",
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
              Your feedback on the manual medication request and approval process has
              been recorded.
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
          <p className="survey-footer">PKD Johor Bahru — Digital Bin Card System</p>
        </div>
      </div>
    );
  }

  return (
    <div className="survey-root">
      <div className="survey-shell">
        <header className="survey-header">
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

            <div className="survey-field" style={{ marginBottom: 0 }}>
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

          {LIKERT_SECTIONS.map((section) => (
            <div className="survey-card" key={section.title}>
              <h2 className="survey-section-title">{section.title}</h2>
              {section.questions.map((q, i) => (
                <div
                  className="survey-field"
                  key={q.name}
                  style={i === section.questions.length - 1 ? { marginBottom: 0 } : undefined}
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
          ))}

          <div className="survey-card">
            <h2 className="survey-section-title">Open-ended questions</h2>
            {OPEN_QUESTIONS.map((q, i) => (
              <div
                className="survey-field"
                key={q.name}
                style={i === OPEN_QUESTIONS.length - 1 ? { marginBottom: 0 } : undefined}
              >
                <label className="survey-label" htmlFor={q.name}>
                  {q.label}
                </label>
                <p className="survey-intro" style={{ margin: "0 0 0.75rem", textAlign: "left" }}>
                  Optional
                </p>
                <textarea
                  id={q.name}
                  className="survey-textarea"
                  placeholder={q.placeholder}
                  {...register(q.name)}
                />
              </div>
            ))}
          </div>

          <button type="submit" className="survey-submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit"}
          </button>

          <p className="survey-privacy">
            Your name and email help us follow up and de-duplicate responses. Shared
            only with the PharmaSync project team.
          </p>
        </form>

        <p className="survey-footer">PKD Johor Bahru — Digital Bin Card System</p>
      </div>
    </div>
  );
}
