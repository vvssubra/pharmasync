# Web Push — Deployment Runbook

Push notifications to approvers (fms / admin / super_admin) when an MO submits
a controlled-drug request or antibiotic form. Works with the app fully closed.

Pipeline: `INSERT (status pending_specialist)` → pg_net trigger →
`push-notify` edge function → Web Push (VAPID) → service worker
`showNotification` (OS default sound + vibration) → tap opens `/specialist`.

Pieces in this repo:
- `supabase/migrations/20260730000000_push_notifications.sql` — table, RLS, triggers
- `supabase/functions/push-notify/index.ts` — the sender
- `src/sw.ts` — push + notificationclick handlers (injectManifest worker)
- `src/components/NotificationSetup.tsx` — post-login enable card / silent re-subscribe
- `src/lib/push.ts` — committed VAPID **public** key + subscribe helper

## One-time VPS setup (order matters — do this BEFORE or right after the frontend deploy)

Until steps 1–3 are done, the only degradation is that the “Enable
notifications” button reports an error. Nothing else breaks.

### 1. Apply the migration

```sh
curl -sSL https://raw.githubusercontent.com/vvssubra/pharmasync/main/supabase/migrations/20260730000000_push_notifications.sql \
  | docker exec -i supabase-db-l8dsa2iokodt3yafiwcmfkvi psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

### 2. Set the DB settings (values typed only on the VPS — repo is public)

Must run as `supabase_admin` — the `postgres` role in this stack is not a
superuser and gets "permission denied to set parameter" (learned the hard way
on first deploy):

```sh
docker exec -i supabase-db-l8dsa2iokodt3yafiwcmfkvi psql -U supabase_admin -d postgres <<'SQL'
ALTER DATABASE postgres SET app.push_kong_url       = 'http://supabase-kong:8000';
ALTER DATABASE postgres SET app.push_anon_key       = '<ANON_KEY from Coolify supabase env>';
ALTER DATABASE postgres SET app.push_webhook_secret = '<output of: openssl rand -hex 32>';
SQL
```

The secret in the DB setting and PUSH_WEBHOOK_SECRET in the Coolify env MUST be
the same value — a mismatch means triggers get 401 and no notification is ever
sent. Verify:

```sh
SEC=$(docker exec supabase-edge-functions-l8dsa2iokodt3yafiwcmfkvi printenv PUSH_WEBHOOK_SECRET)
DBSEC=$(docker exec supabase-db-l8dsa2iokodt3yafiwcmfkvi psql -U supabase_admin -d postgres -tAc "show app.push_webhook_secret")
[ "$SEC" = "$DBSEC" ] && echo MATCH || echo MISMATCH
```

New settings apply to new connections. PostgREST holds a pool — restart the
`supabase-rest` container (Coolify) if the trigger warns about missing settings.

### 3. Deploy the edge function

Copy `supabase/functions/push-notify/` into the functions volume (same flow as
the AI functions — AI runbook §“functions volume”):

```
/data/coolify/services/l8dsa2iokodt3yafiwcmfkvi/volumes/functions/push-notify/index.ts
```

Add to Coolify → supabase service → Environment Variables:

```
PUSH_WEBHOOK_SECRET=<same value as app.push_webhook_secret>
VAPID_SUBJECT=mailto:psubramaniam@moh.gov.my
VAPID_KEYS_JSON=<the ExportedVapidKeys JSON — see “Keys” below>
```

Restart the edge-runtime container.

### 4. Frontend

Auto-deploys on push to main. The VAPID public key is a committed constant
(`src/lib/push.ts`) — no frontend env needed.

## Keys

Generated once, locally. Public half committed. Private half exists ONLY in
`VAPID_KEYS_JSON` on the VPS — never in the repo, never in the DB.

To rotate: generate a new P-256 pair in the same `{publicKey, privateKey}` JWK
shape, update `VAPID_KEYS_JSON` + the constant in `src/lib/push.ts`, redeploy
both. All existing subscriptions die on rotation; they heal on each approver's
next login (silent re-subscribe).

## Verify end-to-end

```sh
# 1. Function answers and rejects a bad secret (expect 401):
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://supabasekong-l8dsa2iokodt3yafiwcmfkvi.187.127.209.179.sslip.io/functions/v1/push-notify \
  -H 'apikey: <ANON_KEY>' -H 'Authorization: Bearer <ANON_KEY>' \
  -H 'x-push-secret: wrong' -d '{"table":"dispensing_requests","id":"x"}'

# 2. With the right secret (expect {"sent":N,"pruned":M}):
curl -s ...same... -H 'x-push-secret: <real secret>' -d '{"table":"dispensing_requests","id":"x"}'

# 3. Trigger fired? After an MO submits, check pg_net's log:
docker exec -i supabase-db-l8dsa2iokodt3yafiwcmfkvi psql -U postgres -d postgres \
  -c "SELECT status_code, error_msg FROM net._http_response ORDER BY id DESC LIMIT 5;"
```

Real-device: FMS phone → install app → log in → “Turn on request alerts” →
Enable → close app fully. MO submits a quota-drug request from another device.
Phone rings; tapping the notification opens the approvals queue. A
non-specialist drug request must stay silent (trigger WHEN clause).

## Design notes

- **No patient identifiers in push payloads.** Lock screens are readable by
  whoever holds the phone. The queue page has the details.
- **A broken webhook can never block a clinical insert** — `notify_push()` is
  fully exception-guarded, and `net.http_post` is queued/async anyway.
- iOS: push requires the installed PWA (16.4+); the Safari tab cannot
  subscribe, and the setup card stays hidden there.
- Dead subscriptions (404/410 from the push service) are pruned on every send.
