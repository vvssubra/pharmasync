-- Pharmacist no longer has UI access to /terimaan, /fms, /mo, /request
-- (ProtectedRoute + AppSidebar, this same change set) — they now only submit
-- keluaran via PharmacistFulfilment and act on the Approvals (/specialist)
-- queue. The transactions INSERT policy still let pharmacist write any
-- `jenis`, including 'terimaan' (stock receiving), directly via PostgREST —
-- a same-clinic UI-gate bypass, not merely dead UI.
--
-- ReplenishQuotaDialog is the only other 'terimaan' insert site in the app,
-- and it is already unreachable by pharmacist: DrugMaster.tsx only renders
-- its trigger for role admin/super_admin, and drug_quotas' own INSERT/UPDATE
-- RLS is admin-only regardless of what the client sends. So pharmacist never
-- had a legitimate path to a 'terimaan' insert — narrowing this policy closes
-- the gap without touching any other jenis (keluaran, baki_awal) or role.
drop policy if exists "Clinic-scoped insert transactions" on public.transactions;
create policy "Clinic-scoped insert transactions" on public.transactions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and (public.is_admin() or (public.is_pharmacist() and jenis <> 'terimaan')))
  );
