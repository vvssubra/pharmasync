# Expandable approval stat cards

## Problem

FmsDashboard and SpecialistDashboard show pending-approval counts as flat stat cards (icon + number + label). They carry no secondary detail — e.g. "Pending Approvals: 5" doesn't say how many are drug requests vs antibiotic forms without navigating down the page.

## Source component

Adapted from a supplied `LocationMap` demo component (3D mouse-tilt card, click-to-expand, animated map/road SVG reveal, framer-motion). Map/road art is irrelevant here — the pharmacy dashboards need a small breakdown of counts, not decorative art.

## Design

### New component: `src/components/ui/expandable-stat-card.tsx`

Built with the `motion` package (already installed, already used the same way in `performance-benchmark-card.tsx` — **not** `framer-motion`, which is not a dependency of this repo).

Props:
```ts
interface ExpandableStatCardProps {
  icon: LucideIcon;
  count: number;
  label: string;
  bgClassName?: string;   // card background, e.g. "bg-yellow-50"
  colorClassName?: string; // count/icon color, e.g. "text-yellow-700"
  breakdown?: { label: string; value: number }[];
  onClick?: () => void;
  active?: boolean;        // ring highlight, mirrors existing stockFilter active state
}
```

Behavior:
- Mouse-move 3D tilt via `useMotionValue`/`useTransform`/`useSpring` (same springs as the source component: stiffness 300/400, damping 30/35).
- **Hover** (not click) expands the card height and fades in the `breakdown` rows, if provided, plus a bottom underline glow — matches source's hover/expand visual language.
- **Click** calls `onClick` unchanged. This is a deliberate deviation from the source (which toggles expand on click): both FmsDashboard's and existing usages rely on click for filtering/scrolling, so click must stay wired to that, not to expand state.
- Replaces the source's decorative map/road/pin SVG with a small pulsing dot + "Live" label in the collapsed-state corner — kept because it's accurate: these cards poll via React Query every 15–30s per this repo's convention.
- Keyboard: `role="button" tabIndex={0}` + Enter/Space triggers `onClick`, mirroring the existing pattern in FmsDashboard/MoDashboard/SpecialistDashboard cards.

### Usage — SpecialistDashboard (`src/pages/SpecialistDashboard.tsx`)

Replace the 4-card `stats.map(...)` block. No existing `onClick` on these cards today, so none is added.

| Card | Breakdown on hover |
|---|---|
| Pending (Drug) | Regular vs Pesara (`regularPending.length` / `pesaraPending.length`) |
| Pending (Antibiotic) | none (single source, no natural split) |
| Approved Today | Drug vs Antibiotic (`approvedToday` / `abApprovedToday`) |
| Rejected Today | Drug vs Antibiotic (`rejectedToday` / `abRejectedToday`) |

### Usage — FmsDashboard (`src/pages/FmsDashboard.tsx`)

Replace only the `Pending Approvals` card (the other 3 — Active Drugs / Critical / Low Stock — are stock-filter cards, out of scope). Existing `onClick={() => pendingApprovalsRef.current?.scrollIntoView(...)}` is preserved unchanged.

Breakdown on hover: Drug requests (`pendingRequests.length`) vs Antibiotic forms (`pendingAntibiotic.length`).

### Explicitly out of scope

- MoDashboard's 3 stat cards (stock-filter cards, not approval cards — decided to skip for scope discipline).
- FmsDashboard's Active Drugs / Critical / Low Stock cards (no breakdown data, already have working filter click behavior — converting adds no value).
- Any change to the underlying table/row rendering of pending requests — only the summary stat cards change.

## Dependencies

No new npm install. `motion` is already in `package.json` (`^12.42.2`).

## Testing

Add `src/components/ui/expandable-stat-card.test.tsx`: renders count/label; breakdown rows appear on hover (or are absent when `breakdown` is omitted); `onClick` fires on click and on Enter/Space when focused. No existing test asserts on the replaced markup (verified via grep across `*.test.tsx`), so no regressions expected there.
