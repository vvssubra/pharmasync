import { useEffect, useState } from "react";
import { Share, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISSED_KEY = "pharmasync:ios-install-dismissed";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own non-standard flag; the media query alone is not reliable there.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
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
 * Add-to-Home-Screen instructions for iOS.
 *
 * iOS Safari has never supported beforeinstallprompt, so there is no way to
 * trigger an install programmatically — the only route is Share → Add to Home
 * Screen, which users have to be told about. Android needs none of this; Chrome
 * offers its own install affordance.
 *
 * Shown only on iOS, only outside standalone mode, and only until dismissed.
 */
export function IosInstallPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isIos() || isStandalone()) return;
    if (localStorage.getItem(DISMISSED_KEY) === "1") return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
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
          <p className="text-sm font-medium">Install PharmaSync on this iPhone</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tap <Share className="inline h-3 w-3 align-[-2px]" aria-label="Share" /> in
            Safari&apos;s toolbar, then{" "}
            <Plus className="inline h-3 w-3 align-[-2px]" aria-hidden="true" /> Add to Home
            Screen.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-touch"
          aria-label="Dismiss install instructions"
          onClick={dismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
