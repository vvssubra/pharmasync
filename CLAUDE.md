# CLAUDE.md

## Architecture

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
| `profiles` | User full_name + clinic_id |
| `user_roles` | User → role mapping |
| `drug_quotas` | Annual patient quota per controlled drug (admin sets per year) |
| `ai_audit_logs` | AI call audit trail (user_id, role, function_name, status_code, tokens_used) |

**Stock calculation:** No dedicated stock column. Compute by summing `transactions` per drug (`terimaan` adds, `keluaran` subtracts, `baki_awal` sets opening balance).

### UI Conventions

- UI language: **English**, with domain nouns kept in Malay (Terimaan, Keluaran, Baki Awal, Pesara, Kuota, Arkib Antibiotik)
- React Query refetch: 15–30s on pages with pending counts
- Dialogs for create/edit forms (`DrugFormDialog`, `OpeningBalanceDialog`)
- `NoPermission` shown (not redirect) when role doesn't match route
