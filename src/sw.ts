/// <reference lib="webworker" />
// Custom service worker (vite-plugin-pwa injectManifest strategy).
//
// Replaced the generated worker the day Web Push landed: generateSW cannot host
// a push handler. Everything the generated worker did is reproduced here —
// precache the shell, SPA navigation fallback, prompt-style updates — plus the
// push handlers at the bottom. If you touch this file, keep two invariants:
//
//   1. NO runtime caching. This app shows live stock and controlled-drug quota
//      balances; a cached Supabase response would show a pharmacist a number
//      that is no longer true. Supabase is a different origin and no route here
//      matches it — keep it that way.
//   2. NO skipWaiting()/clientsClaim() outside the SKIP_WAITING message. The
//      update flow is prompt-based (PwaUpdatePrompt) so a deploy never reloads
//      a pharmacist mid-form.

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA fallback, same as the generated worker's navigateFallback.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));

// Sent by useRegisterSW's updateServiceWorker(true) when the user taps Reload
// on the update toast. Without this listener the Reload button does nothing.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// ─── Web Push ────────────────────────────────────────────────────────────────

interface PushPayload {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
}

self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    // Non-JSON push (should not happen) — fall through to defaults.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? "PharmaSync", {
      body: payload.body ?? "You have a new notification.",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      // Sound comes from the OS: a non-silent notification plays the device's
      // default tone. The vibration pattern is for phones on silent-with-haptics.
      // `vibrate` was dropped from TS's NotificationOptions but Android Chrome
      // still honours it, hence the widened type.
      vibrate: [200, 100, 200],
      tag: payload.tag,
      data: { url: payload.url ?? "/" },
    } as NotificationOptions & { vibrate?: number[] }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url: string = event.notification.data?.url ?? "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open window if there is one — navigate it to the queue.
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client && new URL(client.url).pathname !== url) {
            await client.navigate(url);
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
