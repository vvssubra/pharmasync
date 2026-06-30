# Product

## Register

product

## Users

Pharmacy staff (pharmacists, admin), medical officers (doctors), and FMS specialists working in a Malaysian government clinic or health facility. Used during active shifts — pharmacists at the dispensing counter, doctors submitting drug requests, FMS approving antibiotic pathways. UI language is Bahasa Malaysia. Users range from tech-comfortable to occasional users on shared office PCs.

## Product Purpose

Pharmacy inventory and workflow management system for Malaysian public health facilities. Tracks drug stock via ledger transactions, manages dispensing requests from doctors to pharmacists, and enforces antibiotic approval workflows per Clinical Pathway NAG 2024. Replaces paper-based bin cards and manual approval chains. Success = zero stock discrepancies and audit-ready records.

## Brand Personality

Precise, Trustworthy, Calm. A tool staff rely on when accuracy matters — not a consumer app, not a startup dashboard. Authority without bureaucracy.

## Anti-references

- Old government systems: KKM/JPA portals with blue-bordered tables, grey form backgrounds, Times New Roman, Windows-XP-era fieldsets. This app should feel modern and capable.
- Generic SaaS dashboards: Notion/Linear aesthetic, over-minimalist, startup-flavored. This is a clinical tool, not a productivity app.

## Design Principles

1. **Clarity over cleverness** — every status, number, and action should be readable at a glance, especially under time pressure at the dispensing counter.
2. **Role-aware surfaces** — the UI adapts to who's logged in; no role sees irrelevant noise.
3. **Trustworthy defaults** — confirmations before destructive actions, clear error states, no ambiguous status labels.
4. **Malay-first** — all UI copy, labels, and status values in Bahasa Malaysia; no code-switching in the interface.
5. **Legible at distance** — sufficient type weight and size for shared monitors and bright office lighting.

## Accessibility & Inclusion

WCAG 2.1 AA. Focus rings on all interactive elements. Reduced-motion media query applied globally. Adequate contrast on muted text (≥4.5:1). Keyboard navigation supported via Radix UI primitives.
