# Paediatric dose calculator — design

Date: 2026-08-02

## Problem

Staff at the counter work out paediatric syrup doses by reading an age band off
a printed table, converting mg to mL against whatever strength the bottle
happens to be, and doing it under time pressure. The mg→mL step is where the
arithmetic errors live, and the two reference sources in use — MIMS (age-banded)
and Frank Shann (mg/kg) — disagree often enough that clinicians want to see both
before choosing.

## What this is, and is not

A read-only reference tool. It computes suggestions from a fixed table. It does
not prescribe, does not record anything, does not touch stock, and is not wired
to dispensing requests.

## Decisions

**Both age and weight are required.** MIMS bands are age-based, Frank Shann is
mg/kg; either input alone makes half the table unusable. Age is entered as years
plus months because the fever bands start at 3–5 and 6–23 months.

**Volume is computed.** Every drug carries its concentration, so results read
`180 mg · 7.5 mL · Q4H–Q6H`. mL is the number actually measured, so computing it
removes the step where errors happen. Drugs with more than one strength
(paracetamol, diphenhydramine) get a preparation selector.

**Contraindications suppress the number.** Pseudoephedrine, phenylephrine and
dextromethorphan are "not recommended under 12" in MIMS while Frank Shann still
publishes a mg/kg figure. Under 12, both columns show the contraindication and
no dose — a clinician cannot misread a number that was never rendered.

**Gaps and overlaps in the sources are reproduced, not repaired.** Where a
source publishes no band for an age, the result reads "No band published for
this age" rather than extrapolating from the nearest band. Where bands overlap,
the one listed first wins, matching how a reader working down the table would
resolve it. Both cases are called out in the drug's `caution` field so the
clinician sees why.

**Dexchlorpheniramine and acetylcysteine are excluded.** The source table did
not carry a usable concentration for either, and guessing a strength would
produce a wrong mL figure. Excluded on the user's instruction rather than
shipped with an assumed concentration.

## Structure

| File | Holds |
|---|---|
| `src/lib/paedsDoses.ts` | The drug table. Clinical data, no logic. |
| `src/lib/paedsDose.ts` | Types, `evaluate`, mg→mL, formatting. Pure functions. |
| `src/lib/paedsDose.test.ts` | Band matching, per-kg maths, contraindications, conversion. |
| `src/pages/PaedsDoseCalculator.tsx` | Inputs, grouped results, disclaimer. |
| `src/pages/PaedsDoseCalculator.test.tsx` | Rendering, validation, empty state. |

Route `/dos-paediatrik`, gated to admin, fms, mo, pharmacist, super_admin
(`ProtectedRoute.tsx`). Sidebar entry "Paeds Dose".

Age is carried in whole months throughout. A band is `[minMonths, maxMonths)` —
lower inclusive, upper exclusive — so "2-5 years" is `[24, 72)`, meaning aged 2
up to the sixth birthday.

One rule type covers both sources: `fixed` (mg, optionally weight-conditional),
`perKg` (with an optional `maxMg` cap), `volume` (mL — Frank Shann publishes
triprolidine and lactulose this way), `mlPerKg`, `notRecommended`, `noData`.

## Review obligation

`src/lib/paedsDoses.ts` carries the MIMS and Frank Shann source text verbatim in
a comment above every entry, so it can be checked line by line against the
originals without reading any code. **A transcription error in that file is a
dosing error.** It needs a clinician's sign-off before staff rely on the output,
independently of whether the tests pass — the tests prove the arithmetic, not
the data.

## Disclaimer

Rendered on the page, below the results:

> The information provided should not be used for diagnosing or treating a
> health problem or disease, and those seeking personal medical advice should
> consult with a licensed physician. Always seek the advice of your doctor or
> other qualified health provider regarding a medical condition.
