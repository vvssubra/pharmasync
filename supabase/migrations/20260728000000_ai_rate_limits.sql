-- supabase/migrations/20260728000000_ai_rate_limits.sql
-- Replaces the Upstash Redis sliding-window limiter (external dependency,
-- fails open on outage) with a Postgres fixed-window limiter in the same
-- database the edge functions already talk to for getUserRole/writeAuditLog.

create table public.ai_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  function_name text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, function_name, window_start)
);

create index idx_ai_rate_limits_window on public.ai_rate_limits (window_start);

alter table public.ai_rate_limits enable row level security;
-- Zero policies by design: only service_role touches it (same pattern as
-- ai_audit_logs — RLS enabled, no policies, service_role bypasses RLS).

-- Ollama runs locally at zero marginal cost, so tokens_used is now a
-- latency/capacity signal rather than a billing one; duration_ms lets it be
-- read alongside wall-clock time.
alter table public.ai_audit_logs add column if not exists duration_ms integer;

create or replace function public.ai_rate_limit_hit(
  p_user_id uuid,
  p_function text,
  p_limit integer,
  p_window_seconds integer default 3600
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.ai_rate_limits (user_id, function_name, window_start, request_count)
  values (p_user_id, p_function, v_start, 1)
  on conflict (user_id, function_name, window_start)
  do update set request_count = public.ai_rate_limits.request_count + 1
  returning request_count into v_count;

  if v_count > p_limit then
    -- Clamp the stored count so a burst of rejected requests doesn't
    -- overflow — the exact count above the limit is not meaningful.
    update public.ai_rate_limits
       set request_count = p_limit
     where user_id = p_user_id
       and function_name = p_function
       and window_start = v_start;

    return query select
      false,
      ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds)) - now()))::int;
    return;
  end if;

  -- Opportunistic GC (~1% of calls) — avoids a pg_cron dependency for a
  -- table that only ever needs rows from the last couple of hours.
  if random() < 0.01 then
    delete from public.ai_rate_limits where window_start < now() - interval '2 hours';
  end if;

  return query select true, 0;
end;
$$;

revoke all on function public.ai_rate_limit_hit(uuid, text, integer, integer) from public, anon, authenticated;

-- No admin-readable policy on ai_audit_logs: it has no clinic_id column, so
-- `is_admin() or is_super_admin()` (unlike every other admin policy in this
-- schema, which additionally ANDs clinic_id = user_clinic_id()) would let a
-- single clinic's admin read every clinic's audit trail. Stays service-role
-- -only, same as before this migration.

notify pgrst, 'reload schema';
