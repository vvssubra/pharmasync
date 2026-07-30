import { supabase } from "@/integrations/supabase/client";

// VAPID *public* application-server key. Public by definition — it ships to
// every browser as part of the subscribe call — so it is committed here rather
// than routed through Coolify env vars. The private half lives only in the
// push-notify edge function's environment (VAPID_KEYS_JSON). If the keypair is
// ever rotated, existing subscriptions all die at once: users re-enable via
// NotificationSetup's silent re-subscribe on next login.
export const VAPID_PUBLIC_KEY =
  "BJkoCNA19H-btYZ-3GhApZIvZViUEvYv-DfCe7Mt2JyIrp2eKyB4fpQeagizXJ9HEShwYxePgdFxyRtp5KTMvBk";

// Roles that receive push — mirrors the /specialist allow-list in
// ProtectedRoute.tsx and NOTIFY_ROLES in supabase/functions/push-notify.
export const PUSH_NOTIFY_ROLES = ["fms", "admin", "super_admin"];

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** True when this browser context can subscribe to push at all. On iOS this is
 * only true inside the installed PWA (16.4+), never in the Safari tab. */
export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/**
 * Subscribe this browser to push and persist the subscription. Assumes
 * Notification.permission === "granted" — callers own the permission request,
 * because browsers require it to happen inside a user gesture.
 *
 * Idempotent: getSubscription() returns the existing subscription when there is
 * one, and the upsert refreshes the stored keys on endpoint conflict. Called on
 * every login so an expired/rotated subscription heals itself.
 */
export async function subscribeToPush(userId: string): Promise<boolean> {
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY),
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    console.error("[push] failed to store subscription:", error.message);
    return false;
  }
  return true;
}
