# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server on http://localhost:8080
npm run build        # Production build
npm run build:dev    # Development build
npm run lint         # ESLint
npm run test         # Run tests once (Vitest)
npm run test:watch   # Watch mode tests
```

Run a single test file:
```bash
npx vitest run src/components/ProtectedRoute.test.tsx
```

## Environment Variables

Required in `.env`:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

## Architecture

### Tech Stack
- **React 18 + TypeScript + Vite** (SWC plugin, port 8080)
- **shadcn/ui** (Radix UI primitives + Tailwind CSS) — components in `src/components/ui/`
- **TanStack React Query** — all server state; mutations invalidate relevant query keys
- **React Router v6** — all routes in `src/App.tsx`
- **Supabase** — PostgreSQL backend + Auth; client at `src/integrations/supabase/client.ts`
- **React Hook Form + Zod** — form validation
- **Sonner** — toast notifications
- **Recharts** — charts on dashboard/reports

### Path Alias
`@/` maps to `src/` — use this for all imports.

### Authentication & Roles

`AuthContext` (`src/contexts/AuthContext.tsx`) fetches two things after login:
1. `profiles` table → `full_name`, `facility`
2. `user_roles` table → `role`

Roles: `admin`, `fms`, `mo`, `pharmacist`

`ProtectedRoute` (`src/components/ProtectedRoute.tsx`) enforces role-based access:
- `/specialist` → `fms` only
- `/fulfilment` → `admin` or `pharmacist` only
- Other routes → any authenticated user

### Layout System

All authenticated pages wrap in `<AppLayout>` which renders `<AppSidebar>` + `<TopNavbar>` + content. The sidebar is role-aware and shows nav items based on the user's role with pending-count badges.

### Database Schema (Supabase)

Key tables (types auto-generated at `src/integrations/supabase/types.ts`):

| Table | Purpose |
|-------|---------|
| `drugs` | Drug master; Malay field names (`drug_name`, `unit_pengukuran`, `stok_min/max/reorder`, `perlu_kelulusan_pakar`, location codes: `gudang_seksyen`, `baris`, `rak`, `tingkat`, `petak`) |
| `transactions` | All inventory movements (terimaan/keluaran/baki_awal); stock is computed from this ledger |
| `dispensing_requests` | Doctor → pharmacist drug requests; status flow: `pending → approved/rejected/fulfilled/deferred` |
| `antibiotic_forms` | Doctor → specialist antibiotic approval (Clinical Pathway NAG 2024); status: `pending → approved/rejected → acknowledged` |
| `patient_registry` | Created automatically on dispensing fulfillment |
| `patient_drug_history` | Links patients to dispensed drugs |
| `profiles` | User full_name + facility |
| `user_roles` | User → role mapping |
| `drug_quotas` | Annual patient quota per controlled drug (admin sets per year) |
| `ai_audit_logs` | AI call audit trail (user_id, role, function_name, status_code, tokens_used) |

**Stock calculation:** There is no dedicated stock column. Current stock is always computed by summing `transactions` for a drug (`terimaan` adds, `keluaran` subtracts, `baki_awal` sets opening balance).

### Page → Route Map

| Route | Page | Access |
|-------|------|--------|
| `/` | `Index` (Dashboard) | admin/pharmacist |
| `/drugs` | `DrugMaster` | admin/pharmacist |
| `/drugs/:id/bincard` | `BinCard` | all |
| `/drugs/:id/ledger` | `DrugLedger` | all |
| `/terimaan` | `Terimaan` | admin/pharmacist |
| `/fulfilment` | `PharmacistFulfilment` | admin/pharmacist |
| `/pesakit` | `PatientRegistry` | pharmacist |
| `/laporan` | `Laporan` | admin/pharmacist |
| `/request` | `DoctorLanding` | mo |
| `/request/ubat` | `DoctorRequest` | mo |
| `/request/antibiotik` | `AntibioticForm` | mo |
| `/specialist` | `SpecialistDashboard` | fms |
| `/fms` | `FmsDashboard` | admin/fms/pharmacist |
| `/mo` | `MoDashboard` | admin/mo/pharmacist |

### UI Conventions

- UI language is **Malay** (Bahasa Malaysia) — field labels, status values, and toasts use Malay
- Color scheme: dark blue sidebar (`--sidebar-background: 216 62% 27%`), off-white canvas, semantic status colors (green=success, amber=warning, red=critical)
- Status badges are color-coded: `kritikal` (red), `rendah` (amber), `normal` (green), `lebihan` (blue)
- React Query refetch intervals: 15–30 seconds on pages with pending counts
- Dialogs used for create/edit forms (`DrugFormDialog`, `OpeningBalanceDialog`)
- `NoPermission` component shown (not redirect) when role doesn't match route
