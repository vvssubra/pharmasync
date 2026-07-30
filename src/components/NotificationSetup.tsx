import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { pushSupported, subscribeToPush, PUSH_NOTIFY_ROLES } from "@/lib/push";

/**
 * Gets approvers (fms / admin / super_admin — the roles push-notify targets)
 * subscribed to Web Push, so their phone rings when an MO submits a request.
 *
 * Three states after login:
 * - permission already granted → silently re-subscribe and upsert. This runs
 *   every login, which is what heals expired or rotated subscriptions.
 * - permission default → bottom card with an Enable button. requestPermission()
 *   MUST run inside the click handler; browsers ignore it otherwise.
 * - permission denied, or push unsupported (iOS Safari tab — push only exists
 *   in the installed PWA there) → show nothing. The install prompt already
 *   handles getting the app onto the phone.
 */
export function NotificationSetup() {
  const { user, role } = useAuth();
  const [visible, setVisible] = useState(false);
  const dismissedForUser = useRef<string | null>(null);

  const eligible = !!user && !!role && PUSH_NOTIFY_ROLES.includes(role);

  useEffect(() => {
    if (!eligible || !pushSupported()) {
      setVisible(false);
      return;
    }
    if (Notification.permission === "granted") {
      // Fire-and-forget heal; failures only log.
      void subscribeToPush(user!.id);
      setVisible(false);
      return;
    }
    if (Notification.permission === "denied") {
      setVisible(false);
      return;
    }
    if (dismissedForUser.current === user!.id) return;
    setVisible(true);
  }, [eligible, user]);

  if (!visible) return null;

  const dismiss = () => {
    dismissedForUser.current = user?.id ?? null;
    setVisible(false);
  };

  const enable = async () => {
    // Inside the click handler on purpose — see the component comment.
    const permission = await Notification.requestPermission();
    setVisible(false);
    if (permission !== "granted") return;
    const ok = await subscribeToPush(user!.id);
    if (ok) {
      toast.success("Notifications on — you'll be alerted when an MO submits a request.");
    } else {
      toast.error("Could not enable notifications. Try again from a reload.");
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Enable notifications"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-lg"
    >
      <div className="mx-auto flex max-w-md items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Bell className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Turn on request alerts</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Get a notification the moment an MO submits a drug request or antibiotic form —
            even when the app is closed.
          </p>
          <Button size="touch" className="mt-2 gap-1.5" onClick={enable}>
            <Bell className="h-4 w-4" /> Enable notifications
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-touch"
          aria-label="Dismiss notification setup"
          onClick={dismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
