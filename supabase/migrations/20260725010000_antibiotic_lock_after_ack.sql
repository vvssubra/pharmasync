-- Locks an antibiotic_forms row once the pharmacist has acknowledged it.
-- Acknowledged forms feed the new archive/export feature (Arkib Antibiotik)
-- and are a medico-legal record — nothing should be able to edit the row
-- after acknowledgement, including a legitimate clinic-scoped writer
-- (admin/pharmacist/fms) hitting the update policy from
-- 20260724000200_security_writer_role_gates.sql. super_admin is exempted
-- for support/correction purposes only.

create or replace function public.enforce_antibiotic_form_lock()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.acknowledged_at is not null and not public.is_super_admin() then
    raise exception 'Acknowledged antibiotic form is locked and cannot be modified';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_zz_enforce_antibiotic_form_lock on public.antibiotic_forms;
create trigger trg_zz_enforce_antibiotic_form_lock
  before update on public.antibiotic_forms
  for each row execute function public.enforce_antibiotic_form_lock();
