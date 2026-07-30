import { useEffect, useRef, useState } from "react";
import { Share, Plus, X, Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

// Set only when the app is actually installed (appinstalled event). Deliberately
// NOT set on dismiss: the requirement is that uninstalled users are prompted
// again on every login, and only installed users are left alone.
const INSTALLED_KEY = "pharmasync:app-installed";

// Not in lib.dom: beforeinstallprompt is a Chromium-only event.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Captured at module scope: Chrome fires beforeinstallprompt once, early, often
// before React has mounted anything. preventDefault() suppresses Chrome's own
// mini-infobar so the app can offer install at a moment of its choosing —
// right after login.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    promptListeners.forEach((notify) => notify());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    localStorage.setItem(INSTALLED_KEY, "1");
    promptListeners.forEach((notify) => notify());
  });
}

function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own non-standard flag; the media query alone is not reliable there.
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    // Installed via Chrome earlier but currently browsing in the tab version.
    localStorage.getItem(INSTALLED_KEY) === "1"
  );
}

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as MacIntel, so touch points are the only tell.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Install-the-app popup, shown after login, every login, until the app is
 * actually installed. Dismissing hides it for the current sign-in only;
 * installing (or already running standalone) suppresses it for good.
 *
 * Two platforms, two mechanisms:
 * - Chromium (Android and desktop): the captured beforeinstallprompt event
 *   drives a real Install button — tapping it opens the browser's own install
 *   dialog directly.
 * - iOS Safari: there is no programmatic install and never has been, so the
 *   card explains Share → Add to Home Screen instead. Safari also never fires
 *   appinstalled, so an iOS user who installed but opens the Safari tab again
 *   will still see the card — that is as good as detection gets there.
 */
export function InstallPrompt() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [canPrompt, setCanPrompt] = useState(() => deferredPrompt !== null);
  // Which sign-in the user last dismissed for. Comparing ids (not a boolean)
  // re-arms the prompt on every fresh login, per requirement.
  const dismissedForUser = useRef<string | null>(null);

  useEffect(() => {
    const notify = () => setCanPrompt(deferredPrompt !== null);
    promptListeners.add(notify);
    return () => {
      promptListeners.delete(notify);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setVisible(false);
      return;
    }
    if (isInstalled()) return;
    if (dismissedForUser.current === user.id) return;
    // iOS always has instructions to offer; Chromium only once the browser has
    // volunteered its install event.
    if (isIos() || canPrompt) setVisible(true);
  }, [user, canPrompt]);

  if (!visible) return null;

  const dismiss = () => {
    dismissedForUser.current = user?.id ?? null;
    setVisible(false);
  };

  const install = async () => {
    const evt = deferredPrompt;
    if (!evt) return;
    // A BeforeInstallPromptEvent can only be used once.
    deferredPrompt = null;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === "accepted") {
      localStorage.setItem(INSTALLED_KEY, "1");
    }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Install PharmaSync"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-lg"
    >
      <div className="mx-auto flex max-w-md items-start gap-3">
        <img src="/pwa-192x192.png" alt="" aria-hidden="true" className="h-10 w-10 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Install PharmaSync on this phone</p>
          {isIos() ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Tap <Share className="inline h-3 w-3 align-[-2px]" aria-label="Share" /> in
              Safari&apos;s toolbar, then{" "}
              <Plus className="inline h-3 w-3 align-[-2px]" aria-hidden="true" /> Add to Home
              Screen.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                Opens full-screen from its own icon, like a regular app.
              </p>
              <Button size="touch" className="mt-2 gap-1.5" onClick={install}>
                <Download className="h-4 w-4" /> Install
              </Button>
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-touch"
          aria-label="Dismiss install prompt"
          onClick={dismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
