# Unassigned User Badge — Design

## Problem

Google OAuth signups (see `AuthContext.tsx`) create a `profiles` row but no `user_roles` row — the user sits in "Unassigned" state until an admin visits Role Management and assigns one manually. Admins currently have no way to know a new signup is waiting without navigating there proactively.

## Goal

Surface a count badge on the "Role Management" sidebar nav item, following the existing pending-count badge pattern (`AppSidebar.tsx`), so an admin sees at a glance that N users need a role.

## Scope

- Admin-only (matches who can act on Role Management).
- Clinic-scoped: count only unassigned users in the admin's own clinic.
- 15s polling, consistent with the existing "New Requests" / "Approvals" badges.
- No toast, no email, no push notification — badge only.

## Design

### 1. New RPC: `get_unassigned_user_count()`

New migration, security-definer, mirrors the clinic-scoping and admin gate already used by `get_all_users_with_roles()` (`20260724000000_security_tenancy_hardening.sql`), but returns a single integer count instead of full rows, and filters to `ur.role is null`:

```sql
create or replace function public.get_unassigned_user_count()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
  from public.profiles p
  left join public.user_roles ur on ur.user_id = p.user_id
  where public.is_admin()
    and ur.role is null
    and (
      p.clinic_id = public.user_clinic_id()
      or (p.clinic_id is null and p.pending_clinic_id = public.user_clinic_id())
    );
$$;
```

Returns `0` for non-admins (the `is_admin()` guard short-circuits the count to zero rows matched) rather than raising — consistent with how the sidebar's other badge queries swallow non-matches.

### 2. Sidebar wiring (`src/components/AppSidebar.tsx`)

- Add `showBadge: true` to the Role Management nav item.
- Add a `useQuery`:
  ```ts
  const { data: unassignedCount = 0 } = useQuery({
    queryKey: ["unassigned-user-count"],
    enabled: role === "admin",
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_unassigned_user_count");
      if (error) return 0;
      return data ?? 0;
    },
  });
  ```
- Add `"/role-management": unassignedCount` to the existing `badgeByUrl` map.
- No changes to badge render JSX — the existing `item.showBadge && (badgeByUrl[item.url] ?? 0) > 0` block already handles it.

## Out of scope

- Toasts, email, or browser push notifications on new signup (no notification system exists in the codebase today; this badge is pull-based like everything else in the sidebar).
- Sorting/highlighting unassigned users within the Role Management table itself — they're already visible there.
