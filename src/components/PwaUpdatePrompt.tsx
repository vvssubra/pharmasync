import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";

/**
 * Registers the service worker and surfaces updates as a sonner toast.
 *
 * Renders nothing. Mounted next to <Toaster /> in App.tsx, above AuthProvider, so
 * an update can still be offered on the login screen.
 *
 * The prompt is deliberately manual: duration Infinity with an explicit action,
 * never an automatic reload. A pharmacist part-way through an antibiotic form
 * must not lose it because a deploy landed. updateServiceWorker(true) is what
 * sends skipWaiting and reloads, which is why skipWaiting and clientsClaim are
 * both false in the VitePWA config.
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      // Registration failing is not fatal — the app works fine unregistered — so
      // this is logged rather than shown to a clinician.
      console.error("[pwa] service worker registration failed", error);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;

    toast("A new version of PharmaSync is available.", {
      description: "Reload when you are not part-way through a form.",
      duration: Infinity,
      action: {
        label: "Reload",
        onClick: () => updateServiceWorker(true),
      },
    });
  }, [needRefresh, updateServiceWorker]);

  return null;
}
