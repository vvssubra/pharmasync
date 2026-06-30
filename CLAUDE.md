# CLAUDE.md

## Commands

```bash
npm run dev          # Start dev server on http://localhost:8080
npm run build        # Production build
npm run build:dev    # Development build
npm run lint         # ESLint
npm run test         # Run tests once (Vitest)
npm run test:watch   # Watch mode tests
```

Single test file:
```bash
npx vitest run src/components/ProtectedRoute.test.tsx
```

## Environment Variables

`.env` requires:
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
`@/` maps to `src/`. Use for all imports.

### Authentication & Roles

`AuthContext` (`src/contexts/AuthContext.tsx`) fetches after login:
1. `profiles` table → `full_name`, `facility`
2. `user_roles` table → `role`

Roles: `admin`, `fms`, `mo`, `pharmacist`

`ProtectedRoute` (`src/components/ProtectedRoute.tsx`) enforces role access:
- `/specialist` → `fms` only
- `/fulfilment` → `admin` or `pharmacist` only
- Other routes → any authenticated user

### Layout System

Authenticated pages wrap in `<AppLayout>` → `<AppSidebar>` + `<TopNavbar>` + content. Sidebar role-aware; shows nav items + pending-count badges by role.

### Database Schema (Supabase)

Tables (types at `src/integrations/supabase/types.ts`):

| Table | Purpose |
|-------|---------|
| `drugs` | Drug master; Malay field names (`drug_name`, `unit_pengukuran`, `stok_min/max/reorder`, `perlu_kelulusan_pakar`, location codes: `gudang_seksyen`, `baris`, `rak`, `tingkat`, `petak`) |
| `transactions` | All inventory movements (terimaan/keluaran/baki_awal); stock computed from ledger |
| `dispensing_requests` | Doctor → pharmacist drug requests; status: `pending → approved/rejected/fulfilled/deferred` |
| `antibiotic_forms` | Doctor → specialist antibiotic approval (Clinical Pathway NAG 2024); status: `pending → approved/rejected → acknowledged` |
| `patient_registry` | Created on dispensing fulfillment |
| `patient_drug_history` | Links patients to dispensed drugs |
| `profiles` | User full_name + facility |
| `user_roles` | User → role mapping |
| `drug_quotas` | Annual patient quota per controlled drug (admin sets per year) |
| `ai_audit_logs` | AI call audit trail (user_id, role, function_name, status_code, tokens_used) |

**Stock calculation:** No dedicated stock column. Compute by summing `transactions` per drug (`terimaan` adds, `keluaran` subtracts, `baki_awal` sets opening balance).

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

- UI language: **Malay** (Bahasa Malaysia) — field labels, status values, toasts
- Color scheme: dark blue sidebar (`--sidebar-background: 216 62% 27%`), off-white canvas, semantic status colors (green=success, amber=warning, red=critical)
- Status badges: `kritikal` (red), `rendah` (amber), `normal` (green), `lebihan` (blue)
- React Query refetch: 15–30s on pages with pending counts
- Dialogs for create/edit forms (`DrugFormDialog`, `OpeningBalanceDialog`)
- `NoPermission` shown (not redirect) when role doesn't match route
