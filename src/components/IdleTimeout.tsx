import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// 1 hour of no activity signs the user out. Idle timeout, not an absolute
// session cap: an active user is never interrupted, only a genuinely
// unattended session (shared clinic workstation, forgotten tab) is closed.
export const IDLE_MS = 60 * 60 * 1000;
export const WARN_MS = 2 * 60 * 1000;
// Shared clock across tabs: any tab's activity writes here, any tab's tick
// reads it, so a background tab doesn't sign out while another is in use.
export const ACTIVITY_KEY = "pharmasync:last-activity";
const CHECK_MS = 10_000;
const WRITE_THROTTLE_MS = 5_000;
const WARNING_TOAST_ID = "idle-warning";

function readLastActivity(): number | null {
  const raw = localStorage.getItem(ACTIVITY_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function stampActivity() {
  localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
}

export function IdleTimeout() {
  const { user, signOut } = useAuth();
  const userId = user?.id ?? null;

  // Kept in a ref (not React state) so the toast action / interval tick
  // never race a re-render — signing out must only ever happen once.
  const signingOut = useRef(false);
  const warningShown = useRef(false);

  useEffect(() => {
    if (!userId) return;

    signingOut.current = false;
    warningShown.current = false;

    const doSignOut = async (reason: string) => {
      if (signingOut.current) return;
      signingOut.current = true;
      toast.dismiss(WARNING_TOAST_ID);
      localStorage.removeItem(ACTIVITY_KEY);
      try {
        await signOut();
      } catch {
        // Network down or request failed: still drop the local session so
        // ProtectedRoute redirects to /login instead of leaving a stale,
        // unattended session on screen.
        await supabase.auth.signOut({ scope: "local" });
      }
      toast(reason);
    };

    const staySignedIn = () => {
      stampActivity();
      warningShown.current = false;
      toast.dismiss(WARNING_TOAST_ID);
    };

    // Fresh login, or a stored timestamp so stale it means the browser was
    // closed/idle past the window (e.g. reopened the next day) — stamp or
    // sign out immediately rather than waiting for the first tick.
    const initial = readLastActivity();
    if (initial !== null && Date.now() - initial >= IDLE_MS) {
      doSignOut("Signed out after 1 hour of inactivity.");
    } else {
      stampActivity();
    }

    let lastWrite = Date.now();
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite < WRITE_THROTTLE_MS) return;
      lastWrite = now;
      stampActivity();
      if (warningShown.current) {
        warningShown.current = false;
        toast.dismiss(WARNING_TOAST_ID);
      }
    };

    const activityEvents: Array<[keyof WindowEventMap, AddEventListenerOptions?]> = [
      ["pointerdown", undefined],
      ["keydown", undefined],
      ["scroll", { passive: true }],
      ["touchstart", { passive: true }],
    ];
    activityEvents.forEach(([evt, opts]) => window.addEventListener(evt, onActivity, opts));

    const tick = () => {
      if (signingOut.current) return;
      const last = readLastActivity();
      const idleFor = Date.now() - (last ?? Date.now());

      if (idleFor >= IDLE_MS) {
        doSignOut("Signed out after 1 hour of inactivity.");
        return;
      }

      if (idleFor >= IDLE_MS - WARN_MS) {
        if (!warningShown.current) {
          warningShown.current = true;
          toast("You'll be signed out in 2 minutes due to inactivity.", {
            id: WARNING_TOAST_ID,
            duration: Infinity,
            action: { label: "Stay signed in", onClick: staySignedIn },
          });
        }
      } else if (warningShown.current) {
        // Cleared by another tab's activity, seen via the shared timestamp.
        warningShown.current = false;
        toast.dismiss(WARNING_TOAST_ID);
      }
    };

    const interval = window.setInterval(tick, CHECK_MS);

    return () => {
      activityEvents.forEach(([evt, opts]) => window.removeEventListener(evt, onActivity, opts));
      window.clearInterval(interval);
      toast.dismiss(WARNING_TOAST_ID);
    };
  }, [userId, signOut]);

  return null;
}
