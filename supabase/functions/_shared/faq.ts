// supabase/functions/_shared/faq.ts
// How-to-use-the-app FAQ for ai-query. Deliberately not Storage, a DB table,
// or embeddings — a ~20-entry corpus doesn't need any of that, and an
// embedding model would cost another ~300MB RSS on a CPU-only box.
//
// Retrieval is deterministic IDF-weighted token overlap against each
// entry's aliases (the question phrased several ways) and answer text —
// sub-millisecond, no model call. English content, Malay domain nouns
// (Terimaan, Keluaran, Baki Awal, Pesara, Kuota, Arkib Antibiotik) kept
// verbatim, matching the rest of the migrated UI.

export interface FaqEntry {
  id: string;
  roles: string[];
  /** The question phrased several ways — also doubles as the widget's example chips. */
  aliases: string[];
  answer: string;
}

export type FaqTier = "faq" | "llm" | "none";

export interface FaqRetrieval {
  tier: FaqTier;
  /** Single best entry for tier "faq"; top-k for tier "llm"; empty for "none". */
  top: FaqEntry[];
  bestScore: number;
}

export const FAQ_ENTRIES: FaqEntry[] = [
  // ── mo ──────────────────────────────────────────────────────────────────
  {
    id: "mo-submit-request",
    roles: ["mo"],
    aliases: [
      "how do I submit a drug request",
      "how do I request a drug for a patient",
      "where do I request medication",
      "submitting a drug request",
    ],
    answer:
      "Go to Request Drug (/request/ubat), pick the drug and patient, and submit. Your request enters the queue as pending_pharmacy, or pending_specialist first if the drug requires specialist approval.",
  },
  {
    id: "mo-pending-specialist",
    roles: ["mo"],
    aliases: [
      "what does pending specialist mean",
      "what is pending_specialist",
      "why is my request pending specialist approval",
      "pending specialist status",
    ],
    answer:
      "pending_specialist means the drug you requested needs FMS (specialist) sign-off before the pharmacist can fulfil it — usually because it's a controlled or quota-limited drug. It moves to pending_pharmacy once approved.",
  },
  {
    id: "mo-quota-badge",
    roles: ["mo"],
    aliases: [
      "how do I read the quota badge",
      "what does the quota badge mean",
      "understanding the quota badge",
      "quota badge on drug request",
    ],
    answer:
      "The quota badge shows how many patients have used this drug's annual Kuota (e.g. 84/100) against the clinic's annual limit for that drug and year. It turns amber near the alert threshold and red when exhausted.",
  },
  {
    id: "mo-quota-exhausted",
    roles: ["mo"],
    aliases: [
      "why was my request blocked",
      "annual quota exhausted",
      "why can't I request this drug",
      "request rejected quota exhausted",
    ],
    answer:
      "Your request was blocked because the drug's annual Kuota for this clinic is exhausted — the number of enrolled patients has reached the yearly limit an admin set. Contact your admin if a new patient urgently needs it.",
  },
  {
    id: "mo-antibiotic-form",
    roles: ["mo"],
    aliases: [
      "how do I fill the antibiotic form",
      "submitting an antibiotic form",
      "how to request antibiotic approval",
      "antibiotic form guide",
    ],
    answer:
      "Go to Request Antibiotik (/request/antibiotik), enter the diagnosis and clinical checklist, and the Pathway Check banner shows whether your regimen matches NAG 2024. Submit to send it for specialist approval.",
  },
  {
    id: "mo-pathway-banner-colours",
    roles: ["mo"],
    aliases: [
      "what do the pathway banner colours mean",
      "pathway check banner colors",
      "what does the pathway check verdict mean",
      "green amber red pathway banner",
    ],
    answer:
      "Supported by NAG (green) matches guidelines exactly. Review Recommended (amber) is a partial match — check the note. Not Supported (red) isn't in NAG for this diagnosis. Refer to Specialist (blue) means the case is outside all pathways.",
  },
  {
    id: "mo-pesara",
    roles: ["mo"],
    aliases: [
      "what does Pesara mean",
      "who counts as Pesara",
      "Pesara government retiree",
      "is patient a Pesara",
    ],
    answer:
      "Pesara marks a patient as a government retiree. Pesara patients are exempt from the annual drug quota count, so ticking it correctly avoids using up a quota slot meant for regular patients.",
  },

  // ── pharmacist ──────────────────────────────────────────────────────────
  {
    id: "pharmacist-fulfilment-queue",
    roles: ["pharmacist", "admin"],
    aliases: [
      "how do I use the fulfilment queue",
      "what is the fulfilment queue",
      "fulfilling a dispensing request",
      "pharmacist fulfilment page",
    ],
    answer:
      "Open Fulfilment (/fulfilment) to see requests in pending_pharmacy status. Review each, then fulfil, reject, or defer it — fulfilling records a keluaran transaction and updates the patient's drug history.",
  },
  {
    id: "pharmacist-record-terimaan",
    roles: ["pharmacist", "admin"],
    aliases: [
      "how do I record a Terimaan",
      "recording stock received",
      "how to record incoming stock",
      "Terimaan entry",
    ],
    answer:
      "Go to Terimaan (/terimaan), pick the drug, enter the quantity and reference details, and submit. This adds a terimaan transaction that increases the drug's computed stock balance.",
  },
  {
    id: "pharmacist-baki-awal",
    roles: ["pharmacist", "admin"],
    aliases: [
      "what is Baki Awal",
      "Baki Awal vs opening balance",
      "how do I set an opening balance",
      "opening balance dialog",
    ],
    answer:
      "Baki Awal is the opening balance — a declared physical stock count as of a date, set once per drug via the Set Opening Balance dialog. It overrides the running total from that date forward rather than adding to it.",
  },
  {
    id: "pharmacist-drug-ledger",
    roles: ["pharmacist", "admin", "fms", "mo"],
    aliases: [
      "what is the drug ledger",
      "how do I read the drug ledger",
      "drug ledger page",
      "viewing stock movement history",
    ],
    answer:
      "The drug ledger (/drugs/:id/ledger) lists every terimaan, keluaran, and baki_awal transaction for a drug in date order with a running balance, so you can trace exactly how the current stock figure was reached.",
  },
  {
    id: "pharmacist-acknowledge-antibiotic",
    roles: ["pharmacist", "admin"],
    aliases: [
      "how do I acknowledge an antibiotic form",
      "acknowledging an approved antibiotic form",
      "what does acknowledge mean on antibiotic form",
      "antibiotic form acknowledgement",
    ],
    answer:
      "Once an antibiotic form is approved by FMS, open it from Arkib Antibiotik and acknowledge it to confirm the pharmacy has seen and actioned the approved regimen. This is tracked separately from the form's approval status.",
  },

  // ── fms ─────────────────────────────────────────────────────────────────
  {
    id: "fms-approve-reject-requests",
    roles: ["fms", "admin"],
    aliases: [
      "how do I approve a request",
      "approving or rejecting requests",
      "fms approval queue",
      "how to reject a dispensing request",
    ],
    answer:
      "Your FMS dashboard lists requests and antibiotic forms awaiting your decision. Approving a dispensing request moves it to pending_pharmacy; approving an antibiotic form makes it available for pharmacist acknowledgement.",
  },
  {
    id: "fms-quota-register",
    roles: ["fms", "admin"],
    aliases: [
      "what is the quota register",
      "managing the quota register",
      "controlled drug annual quota",
      "fms quota page",
    ],
    answer:
      "The quota register shows each controlled drug's annual Kuota, how many patients have used it, and the remaining balance for the year. Quotas and alert thresholds are set by admin.",
  },
  {
    id: "fms-patient-registry-enrolment",
    roles: ["fms", "admin", "pharmacist"],
    aliases: [
      "patient registry enrolment",
      "how does a patient get enrolled",
      "enrolling a patient in the quota",
      "patient registry",
    ],
    answer:
      "A patient is enrolled in the Patient Registry automatically when a controlled drug is dispensed to them for the first time in a year — that enrolment is what counts against the drug's annual Kuota.",
  },

  // ── admin ───────────────────────────────────────────────────────────────
  {
    id: "admin-drug-master",
    roles: ["admin"],
    aliases: [
      "how do I manage the drug master",
      "adding a new drug",
      "drug master page",
      "editing a drug",
    ],
    answer:
      "Drug Master (/drugs) is where you add, edit, or deactivate drugs — including stock thresholds (min/reorder/max), unit, storage location, and whether it needs specialist approval.",
  },
  {
    id: "admin-quota-alert-threshold",
    roles: ["admin"],
    aliases: [
      "setting the annual quota",
      "how do I set the alert threshold",
      "annual quota and alert threshold",
      "configuring drug quotas",
    ],
    answer:
      "In the quota register, set each controlled drug's annual quota_limit for the year and an alert_threshold_pct — the badge turns amber once usage crosses that percentage of the limit, giving early warning before it's exhausted.",
  },
  {
    id: "admin-role-management",
    roles: ["admin"],
    aliases: [
      "how do I manage roles",
      "role management page",
      "assigning a role to a user",
      "changing a user's role",
    ],
    answer:
      "Role Management lets admins assign or change a user's role (admin, fms, mo, pharmacist) and approve users who signed up without one yet.",
  },
  {
    id: "admin-clinic-approval",
    roles: ["admin", "super_admin"],
    aliases: [
      "how do I approve a clinic",
      "clinic approval",
      "approving a new clinic",
      "clinic request approval",
    ],
    answer:
      "New clinics that sign up appear as pending clinic requests. Admins review and approve them before staff at that clinic can access clinic-scoped data.",
  },
  {
    id: "admin-reports",
    roles: ["admin", "pharmacist"],
    aliases: [
      "where are the reports",
      "how do I view reports",
      "laporan page",
      "quarterly reports",
    ],
    answer:
      "Laporan (/laporan) shows quarterly drug movement and usage reports — terimaan and keluaran totals per drug per quarter — useful for stock reconciliation and audits.",
  },

  // ── super_admin ─────────────────────────────────────────────────────────
  {
    id: "superadmin-cross-clinic",
    roles: ["super_admin"],
    aliases: [
      "what can super admin see",
      "super admin cross clinic scope",
      "super_admin permissions",
      "does super admin see all clinics",
    ],
    answer:
      "super_admin isn't scoped to any single clinic — you can see and manage data across every clinic, unlike other roles which only see their own clinic's records.",
  },
  {
    id: "superadmin-no-clinic-data",
    roles: ["super_admin"],
    aliases: [
      "why do quota questions return nothing",
      "why is stock empty for super admin",
      "super admin has no clinic_id",
      "quota and stock questions return no data",
    ],
    answer:
      "Quota and stock questions need a specific clinic to answer, but super_admin has no clinic_id by design. General how-to questions still work directly — pick a clinic-scoped view for data questions.",
  },
];

const DIRECT_THRESHOLD = 0.75;
const REPHRASE_THRESHOLD = 0.35;

const STOPWORDS = new Set([
  // English
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "how", "what", "when", "where", "why", "which", "who",
  "can", "could", "should", "would", "will", "shall",
  "i", "you", "my", "your", "me", "it", "its", "this", "that", "these", "those",
  "to", "of", "in", "on", "at", "for", "and", "or", "with", "about", "from",
  "get", "does", "have", "has", "had",
  // Malay function words
  "yang", "untuk", "dan", "atau", "adalah", "ini", "itu", "di", "ke", "dari",
  "saya", "anda", "apa", "bagaimana", "kenapa", "mengapa", "boleh",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function buildIdf(entries: FaqEntry[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const entry of entries) {
    const terms = new Set([...tokenize(entry.aliases.join(" ")), ...tokenize(entry.answer)]);
    for (const t of terms) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = entries.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(n / (1 + d)) + 1);
  return idf;
}

const IDF = buildIdf(FAQ_ENTRIES);

function idfOf(term: string): number {
  return IDF.get(term) ?? 1;
}

/**
 * Score in [0, 1]: fraction of the query's IDF-weighted mass found in the
 * entry, weighting an alias hit 2x an answer-only hit (so aliases — the
 * question phrased several ways — dominate the match), plus a small bonus
 * per query bigram that appears verbatim in the alias text.
 */
function scoreEntry(queryTokens: string[], entry: FaqEntry): number {
  const aliasTokens = new Set(tokenize(entry.aliases.join(" ")));
  const answerTokens = new Set(tokenize(entry.answer));

  let raw = 0;
  let maxPossible = 0;
  for (const t of queryTokens) {
    const w = idfOf(t);
    maxPossible += w * 2;
    if (aliasTokens.has(t)) raw += w * 2;
    else if (answerTokens.has(t)) raw += w * 1;
  }
  let score = maxPossible > 0 ? raw / maxPossible : 0;

  const aliasText = ` ${tokenize(entry.aliases.join(" ")).join(" ")} `;
  for (let i = 0; i < queryTokens.length - 1; i++) {
    const bigram = `${queryTokens[i]} ${queryTokens[i + 1]}`;
    if (aliasText.includes(` ${bigram} `)) score = Math.min(1, score + 0.1);
  }
  return score;
}

/**
 * Three-tier retrieval: a strong match (>=0.75) is returned verbatim with no
 * LLM call; a loose match (>=0.35) is handed to the LLM as FACTS to
 * rephrase; anything weaker falls through to "I don't have that
 * information." — also with no LLM call.
 */
export function retrieveFaq(question: string, role: string, k = 2): FaqRetrieval {
  const pool = FAQ_ENTRIES.filter((e) => e.roles.includes(role));
  const queryTokens = tokenize(question);
  if (queryTokens.length === 0 || pool.length === 0) {
    return { tier: "none", top: [], bestScore: 0 };
  }

  const scored = pool
    .map((entry) => ({ entry, score: scoreEntry(queryTokens, entry) }))
    .sort((a, b) => b.score - a.score);

  const bestScore = scored[0].score;
  if (bestScore >= DIRECT_THRESHOLD) {
    return { tier: "faq", top: [scored[0].entry], bestScore };
  }
  if (bestScore >= REPHRASE_THRESHOLD) {
    return { tier: "llm", top: scored.slice(0, k).map((s) => s.entry), bestScore };
  }
  return { tier: "none", top: [], bestScore };
}
