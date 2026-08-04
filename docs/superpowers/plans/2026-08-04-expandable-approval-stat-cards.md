# Expandable Approval Stat Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat "Pending Approvals" stat card on FmsDashboard and the 4 stat cards on SpecialistDashboard with a reusable hover-tilt, hover-expand stat card that reveals a count breakdown.

**Architecture:** One new generic component, `ExpandableStatCard`, in `src/components/ui/`, built on the existing `Card` primitive and the `motion` package (already a dependency, already used the same way in `performance-benchmark-card.tsx`). Two page files get their stat-card JSX swapped to use it; no other files change.

**Tech Stack:** React, TypeScript, Tailwind, `motion` (not `framer-motion` — that package is not installed), Vitest + Testing Library.

## Global Constraints

- No new npm dependency. `motion` is already in `package.json` (`^12.42.2`).
- Follow the existing `motion/react` usage pattern from `src/components/ui/performance-benchmark-card.tsx`: `React.forwardRef`, respects `useReducedMotion()`, `cn()` from `@/lib/utils` for class merging.
- Hover triggers expand (breakdown reveal + tilt). Click is reserved for the caller's `onClick` (FmsDashboard's existing scroll-to-section behavior must keep working unchanged).
- No decorative map/road/pin SVG from the source component — replaced by a small pulsing "Live" dot (accurate: these cards are backed by React Query polling every 15–30s per this repo's convention).
- UI language stays English (per `CLAUDE.md` UI conventions) — all new labels here are English, matching the existing stat card labels being replaced.

---

### Task 1: `ExpandableStatCard` component

**Files:**
- Create: `src/components/ui/expandable-stat-card.tsx`
- Test: `src/components/ui/expandable-stat-card.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface StatBreakdownItem {
    label: string;
    value: number;
  }

  export interface ExpandableStatCardProps {
    icon: LucideIcon;
    count: number;
    label: string;
    bgClassName?: string;
    colorClassName?: string;
    breakdown?: StatBreakdownItem[];
    onClick?: () => void;
    active?: boolean;
    className?: string;
  }

  export const ExpandableStatCard: React.ForwardRefExoticComponent<
    ExpandableStatCardProps & React.RefAttributes<HTMLDivElement>
  >;
  ```
  Tasks 2 and 3 import `ExpandableStatCard` and `StatBreakdownItem` from `@/components/ui/expandable-stat-card`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/ui/expandable-stat-card.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Clock } from "lucide-react";
import { ExpandableStatCard } from "./expandable-stat-card";

describe("ExpandableStatCard", () => {
  it("renders the count and label", () => {
    render(<ExpandableStatCard icon={Clock} count={5} label="Pending Approvals" />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Pending Approvals")).toBeInTheDocument();
  });

  it("keeps breakdown rows hidden until hovered", () => {
    render(
      <ExpandableStatCard
        icon={Clock}
        count={5}
        label="Pending Approvals"
        breakdown={[{ label: "Drug requests", value: 3 }, { label: "Antibiotic forms", value: 2 }]}
      />
    );
    expect(screen.queryByText("Drug requests")).not.toBeInTheDocument();
  });

  it("reveals breakdown rows on hover", () => {
    const { container } = render(
      <ExpandableStatCard
        icon={Clock}
        count={5}
        label="Pending Approvals"
        breakdown={[{ label: "Drug requests", value: 3 }, { label: "Antibiotic forms", value: 2 }]}
      />
    );
    fireEvent.mouseEnter(container.firstChild as Element);
    expect(screen.getByText("Drug requests")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders no breakdown section when none is given, even on hover", () => {
    const { container } = render(<ExpandableStatCard icon={Clock} count={5} label="Pending Approvals" />);
    fireEvent.mouseEnter(container.firstChild as Element);
    expect(screen.queryByText("Drug requests")).not.toBeInTheDocument();
  });

  it("fires onClick when clicked", () => {
    const onClick = vi.fn();
    const { container } = render(
      <ExpandableStatCard icon={Clock} count={5} label="Pending Approvals" onClick={onClick} />
    );
    fireEvent.click(container.firstChild as Element);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fires onClick on Enter and Space when focused, without needing a click", () => {
    const onClick = vi.fn();
    const { container } = render(
      <ExpandableStatCard icon={Clock} count={5} label="Pending Approvals" onClick={onClick} />
    );
    const card = container.firstChild as Element;
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("is not a button role when onClick is omitted", () => {
    const { container } = render(<ExpandableStatCard icon={Clock} count={5} label="Pending Approvals" />);
    expect((container.firstChild as Element).getAttribute("role")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/ui/expandable-stat-card.test.tsx`
Expected: FAIL — `Failed to resolve import "./expandable-stat-card"`

- [ ] **Step 3: Write the component**

Create `src/components/ui/expandable-stat-card.tsx`:

```tsx
import * as React from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring, useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export interface StatBreakdownItem {
  label: string;
  value: number;
}

export interface ExpandableStatCardProps {
  icon: LucideIcon;
  count: number;
  label: string;
  /** Card background, e.g. "bg-yellow-50 dark:bg-yellow-900/30". */
  bgClassName?: string;
  /** Icon + count color, e.g. "text-yellow-700 dark:text-yellow-400". */
  colorClassName?: string;
  /** Revealed on hover as a small breakdown list. Omit for cards with no natural sub-split. */
  breakdown?: StatBreakdownItem[];
  onClick?: () => void;
  /** Ring highlight, mirrors the existing stockFilter "active" convention on these dashboards. */
  active?: boolean;
  className?: string;
}

// Adapted from a supplied LocationMap demo (3D mouse-tilt + click-to-expand
// map card). The map/road SVG art doesn't apply here, so expansion instead
// reveals a count breakdown, and it triggers on hover rather than click —
// click stays wired to the caller's existing filter/scroll behavior.
export const ExpandableStatCard = React.forwardRef<HTMLDivElement, ExpandableStatCardProps>(
  ({ icon: Icon, count, label, bgClassName, colorClassName, breakdown, onClick, active, className }, ref) => {
    const [isHovered, setIsHovered] = React.useState(false);
    const innerRef = React.useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();

    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);
    const rotateX = useTransform(mouseY, [-50, 50], [8, -8]);
    const rotateY = useTransform(mouseX, [-50, 50], [-8, 8]);
    const springRotateX = useSpring(rotateX, { stiffness: 300, damping: 30 });
    const springRotateY = useSpring(rotateY, { stiffness: 300, damping: 30 });

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      if (prefersReducedMotion || !innerRef.current) return;
      const rect = innerRef.current.getBoundingClientRect();
      mouseX.set(e.clientX - (rect.left + rect.width / 2));
      mouseY.set(e.clientY - (rect.top + rect.height / 2));
    };

    const handleMouseLeave = () => {
      mouseX.set(0);
      mouseY.set(0);
      setIsHovered(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onClick) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    };

    const showBreakdown = isHovered && !!breakdown && breakdown.length > 0;

    return (
      <Card
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        noGlow
        data-testid={`stat-card-${label}`}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={handleMouseLeave}
        style={{ perspective: 1000 }}
        className={cn(bgClassName, onClick && "cursor-pointer", active && "ring-2 ring-primary", className)}
      >
        <motion.div
          style={{
            rotateX: prefersReducedMotion ? 0 : springRotateX,
            rotateY: prefersReducedMotion ? 0 : springRotateY,
            transformStyle: "preserve-3d",
          }}
          className="p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Icon className={cn("h-6 w-6", colorClassName)} />
              <div>
                <p className={cn("text-2xl font-bold", colorClassName ?? "text-foreground")}>{count}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-foreground/5 shrink-0">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[10px] font-medium text-muted-foreground tracking-wide uppercase">Live</span>
            </div>
          </div>

          <AnimatePresence>
            {showBreakdown && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.25 }}
                className="mt-3 space-y-1 overflow-hidden border-t pt-2"
              >
                {breakdown!.map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            className="h-px mt-3 bg-gradient-to-r from-emerald-500/50 via-emerald-400/30 to-transparent"
            initial={false}
            animate={{ scaleX: isHovered ? 1 : 0.3 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.4, ease: "easeOut" }}
            style={{ originX: 0 }}
          />
        </motion.div>
      </Card>
    );
  }
);
ExpandableStatCard.displayName = "ExpandableStatCard";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/ui/expandable-stat-card.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Typecheck and lint**

Run: `npm run verify`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/expandable-stat-card.tsx src/components/ui/expandable-stat-card.test.tsx
git commit -m "feat: add ExpandableStatCard component"
```

---

### Task 2: Wire into SpecialistDashboard

**Files:**
- Modify: `src/pages/SpecialistDashboard.tsx:9` (icon import), `:258-263` (stats array), `:267-279` (stats render block)
- Modify: `src/pages/SpecialistDashboard.test.tsx:2` (add `fireEvent` to the existing RTL import)
- Test: `src/pages/SpecialistDashboard.test.tsx` (existing file — add one test to the existing `describe` block, no new file)

**Interfaces:**
- Consumes: `ExpandableStatCard`, `StatBreakdownItem` from `@/components/ui/expandable-stat-card` (Task 1). `ExpandableStatCard` renders its root with `data-testid={\`stat-card-${label}\`}` (Task 1) — use that to target the card directly, since `mouseenter`/`mouseleave` don't bubble and firing on a wrong descendant/ancestor silently no-ops.

- [ ] **Step 1: Write the failing test**

This file already defines `renderDashboard()` (wraps `<SpecialistDashboard />` in `MemoryRouter` + `QueryClientProvider`, at line 70) and a default `supabase` mock (lines 32–58) that resolves every query to `[]` unless a test overrides `supabase.from` — so with no override, `allPending`, `regularPending`, `pesaraPending` are all empty and every stat card renders with count `0`. That's enough to test the breakdown reveal — the counts being `0` doesn't matter, only that the two breakdown labels appear.

First, add `fireEvent` to this file's existing `@testing-library/react` import (line 2):

```tsx
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
```

Then add this test inside the existing `describe("SpecialistDashboard", ...)` block, after the last existing `it(...)`:

```tsx
  it("reveals the Regular vs Pesara breakdown when hovering the Pending (Drug) stat card", async () => {
    renderDashboard();
    const card = await screen.findByTestId("stat-card-Pending (Drug)");
    fireEvent.mouseEnter(card);
    expect(screen.getByText("Regular")).toBeInTheDocument();
    expect(screen.getByText("Pesara")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/SpecialistDashboard.test.tsx`
Expected: FAIL — no element with `data-testid="stat-card-Pending (Drug)"` exists yet (the stat cards are still plain `<Card>`s)

- [ ] **Step 3: Replace the stats block**

In `src/pages/SpecialistDashboard.tsx`, change the icon import (line 9):

```tsx
import { Clock, CheckCircle, XCircle, ChevronDown } from "lucide-react";
```

Add the new import below the existing `@/components/ui/card` import (after line 11):

```tsx
import { ExpandableStatCard } from "@/components/ui/expandable-stat-card";
```

Replace the `stats` array (existing lines 258–263):

```tsx
  const stats = [
    {
      label: "Pending (Drug)", count: allPending.length, icon: Clock,
      bg: "bg-yellow-100 dark:bg-yellow-900/30", color: "text-yellow-700 dark:text-yellow-400",
      breakdown: [
        { label: "Regular", value: regularPending.length },
        { label: "Pesara", value: pesaraPending.length },
      ],
    },
    {
      label: "Pending (Antibiotic)", count: abPending.length, icon: Clock,
      bg: "bg-teal-100 dark:bg-teal-900/30", color: "text-teal-700 dark:text-teal-400",
      breakdown: undefined,
    },
    {
      label: "Approved Today", count: approvedToday + abApprovedToday, icon: CheckCircle,
      bg: "bg-green-100 dark:bg-green-900/30", color: "text-green-700 dark:text-green-400",
      breakdown: [
        { label: "Drug", value: approvedToday },
        { label: "Antibiotic", value: abApprovedToday },
      ],
    },
    {
      label: "Rejected Today", count: rejectedToday + abRejectedToday, icon: XCircle,
      bg: "bg-red-100 dark:bg-red-900/30", color: "text-red-700 dark:text-red-400",
      breakdown: [
        { label: "Drug", value: rejectedToday },
        { label: "Antibiotic", value: abRejectedToday },
      ],
    },
  ];
```

Replace the render block (existing lines 267–279):

```tsx
      <div className="grid gap-4 sm:grid-cols-4">
        {stats.map(s => (
          <ExpandableStatCard
            key={s.label}
            icon={s.icon}
            count={s.count}
            label={s.label}
            bgClassName={s.bg}
            colorClassName={s.color}
            breakdown={s.breakdown}
          />
        ))}
      </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/SpecialistDashboard.test.tsx`
Expected: PASS, all tests in the file (existing + new one)

- [ ] **Step 5: Typecheck and lint**

Run: `npm run verify`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add src/pages/SpecialistDashboard.tsx src/pages/SpecialistDashboard.test.tsx
git commit -m "feat: use ExpandableStatCard for SpecialistDashboard stats"
```

---

### Task 3: Wire into FmsDashboard

**Files:**
- Modify: `src/pages/FmsDashboard.tsx:11` (icon import already has `Clock`, no change needed there — add component import), `:394-407` (Pending Approvals card only)
- Test: `src/pages/FmsDashboard.test.tsx` (existing file — add one assertion, no new file)

**Interfaces:**
- Consumes: `ExpandableStatCard` from `@/components/ui/expandable-stat-card` (Task 1). Same `data-testid={\`stat-card-${label}\`}` targeting as Task 2 — this dashboard's card is titled `"Pending Approvals"`, so its testid is `stat-card-Pending Approvals`.

- [ ] **Step 1: Write the failing test**

This file's mock (lines 40–84) resolves the `antibiotic_forms` table to `[pendingForm]` (one `pending_specialist` row) and everything else — including `dispensing_requests` — to `[]`. So after this task's change, the Pending Approvals card renders count `1` with breakdown `Drug requests: 0` / `Antibiotic forms: 1`. `fireEvent` is already imported in this file (line 2); no import changes needed. Add both tests inside the existing `describe("FmsDashboard sections", ...)` block, after the last existing `it(...)`:

```tsx
  it("reveals the drug-vs-antibiotic breakdown when hovering the Pending Approvals card", async () => {
    render(<MemoryRouter><QueryClientProvider client={makeQC()}><FmsDashboard /></QueryClientProvider></MemoryRouter>);
    const card = await screen.findByTestId("stat-card-Pending Approvals");
    fireEvent.mouseEnter(card);
    expect(screen.getByText("Drug requests")).toBeInTheDocument();
    expect(screen.getByText("Antibiotic forms")).toBeInTheDocument();
  });

  it("still scrolls to the pending-approvals section when the card is clicked", async () => {
    render(<MemoryRouter><QueryClientProvider client={makeQC()}><FmsDashboard /></QueryClientProvider></MemoryRouter>);
    const card = await screen.findByTestId("stat-card-Pending Approvals");
    // jsdom's scrollIntoView is a no-op stub from src/test/setup.ts; replace it
    // with a spy so this test can verify the existing scroll-on-click behavior
    // is still wired up after the swap to ExpandableStatCard.
    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;
    fireEvent.click(card);
    expect(scrollIntoViewSpy).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/FmsDashboard.test.tsx`
Expected: FAIL — no element with `data-testid="stat-card-Pending Approvals"` exists yet

- [ ] **Step 3: Replace the Pending Approvals card**

In `src/pages/FmsDashboard.tsx`, add the import after line 17 (`Card` import):

```tsx
import { ExpandableStatCard } from "@/components/ui/expandable-stat-card";
```

Replace the existing `Pending Approvals` card block (existing lines 394–407):

```tsx
        <ExpandableStatCard
          icon={Clock}
          count={pendingRequests.length + pendingAntibiotic.length}
          label="Pending Approvals"
          bgClassName="bg-yellow-50"
          colorClassName="text-yellow-700"
          breakdown={[
            { label: "Drug requests", value: pendingRequests.length },
            { label: "Antibiotic forms", value: pendingAntibiotic.length },
          ]}
          onClick={() => pendingApprovalsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
```

Leave the other 3 cards in that grid (Active Drugs, Critical Stock, Low Stock) untouched — out of scope per the design spec.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/FmsDashboard.test.tsx`
Expected: PASS, all tests in the file (existing + new two)

- [ ] **Step 5: Typecheck and lint**

Run: `npm run verify`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add src/pages/FmsDashboard.tsx src/pages/FmsDashboard.test.tsx
git commit -m "feat: use ExpandableStatCard for FmsDashboard Pending Approvals"
```

---

### Task 4: Manual verification in the running app

**Files:** none (no code changes — verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify SpecialistDashboard**

Log in as a specialist role, open `/specialist`. Confirm:
- 4 stat cards render with the same counts as before
- Hovering "Pending (Drug)" shows a Regular/Pesara breakdown; hovering "Approved Today" / "Rejected Today" shows a Drug/Antibiotic breakdown; hovering "Pending (Antibiotic)" shows no breakdown section (none provided) and doesn't error
- Mouse-move over any card produces a subtle 3D tilt
- Cards are not clickable (no cursor-pointer, no ring)

- [ ] **Step 3: Verify FmsDashboard**

Open `/fms`. Confirm:
- "Pending Approvals" card hover shows Drug requests / Antibiotic forms breakdown and tilts on mouse-move
- Clicking it still scrolls smoothly to the Pending Approvals table section (unchanged from before)
- The other 3 summary cards (Active Drugs / Critical Stock / Low Stock) are visually unchanged and their click-to-filter behavior still works

- [ ] **Step 4: Check dark mode**

Toggle dark mode (if the app has a toggle, or via OS setting) and re-check both pages — `colorClassName`/`bgClassName` values passed in both tasks already include `dark:` variants for SpecialistDashboard; FmsDashboard's yellow card reuses its pre-existing light-only classes (`bg-yellow-50`, `text-yellow-700`), matching what was there before this change (no regression, but also no dark-mode improvement — out of scope).

- [ ] **Step 5: Check `prefers-reduced-motion`**

In Chrome DevTools → Rendering tab → "Emulate CSS media feature prefers-reduced-motion: reduce", reload `/specialist` and `/fms`. Confirm cards render fine with no tilt/spring animation (breakdown reveal still works, just without the height/opacity transition).

No commit for this task — verification only.
