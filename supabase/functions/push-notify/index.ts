// supabase/functions/push-notify/index.ts
//
// Sends a Web Push notification to every approver (fms / admin / super_admin)
// when an MO's submission enters the specialist queue. Called by the pg_net
// triggers in 20260730000000_push_notifications.sql — NOT by the browser.
//
// Auth model: this endpoint is machine-to-machine only. The trigger sends
// x-push-secret (a random value set via ALTER DATABASE, mirrored into this
// function's env). No JWT path exists on purpose: the payload identifies rows
// by id only, and the function itself decides who to notify.
//
// Required env (Coolify → supabase service → Environment Variables):
//   PUSH_WEBHOOK_SECRET  — must equal the DB setting app.push_webhook_secret
//   VAPID_KEYS_JSON      — ExportedVapidKeys JSON ({publicKey, privateKey} JWKs)
//   VAPID_SUBJECT        — mailto: contact for push services (optional, has default)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — already present in the stack.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import * as webpush from "https://esm.sh/jsr/@negrel/webpush@0.5.0";

const NOTIFY_ROLES = ["fms", "admin", "super_admin"];

// Deliberately no patient identifiers: lock screens are readable by whoever is
// holding the phone. The queue page has the details.
//
// Keyed by `table` or `table:event`. Events come from notify_push_event()
// (migration 20260731000000): 'rejected' targets the submitting MO, and
// 'resubmitted' broadcasts to approvers like a fresh submission.
const MESSAGES: Record<string, { title: string; body: string; tag: string; url: string }> = {
  dispensing_requests: {
    title: "PharmaSync — New drug request",
    body: "A controlled-drug request is awaiting specialist approval.",
    tag: "dispensing",
    url: "/specialist",
  },
  antibiotic_forms: {
    title: "PharmaSync — New antibiotic form",
    body: "An antibiotic form is awaiting specialist approval.",
    tag: "antibiotic",
    url: "/specialist",
  },
  "antibiotic_forms:rejected": {
    title: "PharmaSync — Antibiotic form returned",
    body: "The FMS returned your antibiotic form for correction. Tap to fix and resubmit.",
    tag: "antibiotic-rejected",
    url: "/request/antibiotik", // ?edit=<id> appended below
  },
  "antibiotic_forms:resubmitted": {
    title: "PharmaSync — Antibiotic form resubmitted",
    body: "A corrected antibiotic form is awaiting specialist approval.",
    tag: "antibiotic",
    url: "/specialist",
  },
};

// Import once per isolate, not per request.
const appServerPromise = (async () => {
  const keysJson = Deno.env.get("VAPID_KEYS_JSON");
  if (!keysJson) throw new Error("VAPID_KEYS_JSON not set");
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(keysJson), {
    extractable: false,
  });
  return webpush.ApplicationServer.new({
    contactInformation: Deno.env.get("VAPID_SUBJECT") ?? "mailto:psubramaniam@moh.gov.my",
    vapidKeys,
  });
})();

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }

  const secret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-push-secret") !== secret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  let table: string;
  let event: string;
  let rowId: string;
  let targetUser: string | null;
  try {
    const payload = await req.json();
    table = String(payload.table ?? "");
    event = String(payload.event ?? "");
    rowId = String(payload.id ?? "");
    targetUser = payload.target_user ? String(payload.target_user) : null;
  } catch {
    return new Response(JSON.stringify({ error: "bad payload" }), { status: 400 });
  }

  const message = MESSAGES[event ? `${table}:${event}` : table] ?? MESSAGES[table];
  if (!message) {
    return new Response(JSON.stringify({ error: `unknown table ${table}` }), { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Who rings: a targeted event addresses exactly one user (the submitting MO
  // on rejection); everything else broadcasts to the approver roles. A user
  // with several devices has several subscription rows; all of them ring.
  let userIds: string[];
  if (targetUser) {
    userIds = [targetUser];
  } else {
    const { data: roles, error: rolesErr } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", NOTIFY_ROLES);
    if (rolesErr) {
      return new Response(JSON.stringify({ error: rolesErr.message }), { status: 500 });
    }
    userIds = [...new Set((roles ?? []).map((r) => r.user_id))];
  }
  if (userIds.length === 0) {
    return new Response(JSON.stringify({ sent: 0, pruned: 0 }), { status: 200 });
  }

  const { data: subs, error: subsErr } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (subsErr) {
    return new Response(JSON.stringify({ error: subsErr.message }), { status: 500 });
  }

  const appServer = await appServerPromise;
  // Rejections deep-link straight into the correction form.
  const url =
    event === "rejected" && rowId ? `${message.url}?edit=${rowId}` : message.url;
  const text = JSON.stringify({
    title: message.title,
    body: message.body,
    tag: message.tag,
    url,
  });

  let sent = 0;
  const pruneIds: string[] = [];
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        const subscriber = appServer.subscribe({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        });
        await subscriber.pushTextMessage(text, {});
        sent++;
      } catch (err) {
        // 404/410 mean the subscription is dead (uninstalled, expired,
        // permission revoked) — prune it. Anything else: log, keep the row.
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404 || status === 410) {
          pruneIds.push(s.id);
        } else {
          console.error(`[push-notify] push failed for ${s.endpoint.slice(0, 40)}…:`, err);
        }
      }
    }),
  );

  if (pruneIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", pruneIds);
  }

  return new Response(JSON.stringify({ sent, pruned: pruneIds.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
