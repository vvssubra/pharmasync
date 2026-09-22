-- Announcements shown as a ticker on the (pre-auth) login page, managed from
-- an admin settings page. Global, not clinic-scoped — matches the current
-- one-clinic-at-a-time deployment (CLAUDE.md) where "the district" is the
-- only meaningful audience; add clinic_id later if multi-clinic rollout ever
-- needs per-clinic announcements.
--
-- Apply on the VPS (repo is public, so no copy-paste of secrets here — this
-- file has none, but keeping the same runbook shape as
-- 20260730000000_push_notifications.sql):
--   curl -sSL https://raw.githubusercontent.com/vvssubra/pharmasync/main/supabase/migrations/20260922000000_announcements.sql \
--     | docker exec -i supabase-db-l8dsa2iokodt3yafiwcmfkvi psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Run in Coolify → Terminal → "VPS 1850682" (pharmasync-vps-access memory).
-- No PostgREST reload needed: it introspects new tables automatically, only
-- function drops require one.

create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  message    text not null,
  is_active  boolean not null default true,
  priority   integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_active_priority_idx
  on public.announcements (is_active, priority desc, created_at desc);

alter table public.announcements enable row level security;

-- Anon-readable (active rows only) so the login ticker works before sign-in —
-- same shape as the clinics picker (20260723000200_tenancy_3_rls.sql).
create policy "Anyone can view active announcements"
  on public.announcements for select
  to anon, authenticated
  using (is_active = true);

-- Admins additionally see inactive/scheduled rows, so the settings page can
-- manage what is not currently on air. Postgres ORs this with the policy
-- above rather than replacing it.
create policy "Admin can view all announcements"
  on public.announcements for select
  to authenticated
  using (public.is_admin() or public.is_super_admin());

create policy "Admin can create announcements"
  on public.announcements for insert
  to authenticated
  with check (public.is_admin() or public.is_super_admin());

create policy "Admin can update announcements"
  on public.announcements for update
  to authenticated
  using (public.is_admin() or public.is_super_admin());

create policy "Admin can delete announcements"
  on public.announcements for delete
  to authenticated
  using (public.is_admin() or public.is_super_admin());

-- Reuses the trigger fn every other timestamped table on this deployment
-- shares (transactions, profiles, push_subscriptions, …) rather than
-- defining a per-table duplicate.
create trigger trg_announcements_updated_at
  before update on public.announcements
  for each row execute function public.update_updated_at_column();

-- created_by is stamped server-side, not trusted from the client payload —
-- same reasoning as stamp_clinic_id() (20260723000200_tenancy_3_rls.sql).
create or replace function public.stamp_announcement_created_by()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

create trigger trg_announcements_created_by
  before insert on public.announcements
  for each row execute function public.stamp_announcement_created_by();
