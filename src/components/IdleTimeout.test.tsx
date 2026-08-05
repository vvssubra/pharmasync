// src/components/IdleTimeout.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { IdleTimeout, IDLE_MS, WARN_MS, ACTIVITY_KEY } from "./IdleTimeout";

const signOut = vi.fn(() => Promise.resolve());
const supabaseLocalSignOut = vi.fn((..._args: unknown[]) => Promise.resolve());
let mockUser: { id: string } | null = { id: "user-1" };

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, signOut }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: (...args: unknown[]) => supabaseLocalSignOut(...args) } },
}));

const { toast } = vi.hoisted(() => {
  const fn = vi.fn() as unknown as { (...args: unknown[]): void; dismiss: ReturnType<typeof vi.fn> };
  fn.dismiss = vi.fn();
  return { toast: fn };
});
vi.mock("sonner", () => ({ toast }));

describe("IdleTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    localStorage.clear();
    mockUser = { id: "user-1" };
    signOut.mockClear();
    supabaseLocalSignOut.mockClear();
    (toast as unknown as ReturnType<typeof vi.fn>).mockClear();
    toast.dismiss.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not sign out at 59 minutes idle", () => {
    render(<IdleTimeout />);
    vi.advanceTimersByTime(59 * 60 * 1000);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("shows the warning toast once at 58 minutes idle", () => {
    render(<IdleTimeout />);
    vi.advanceTimersByTime(IDLE_MS - WARN_MS);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/signed out in 2 minutes/i),
      expect.objectContaining({ id: "idle-warning" }),
    );

    // Further ticks before sign-out must not re-show it.
    vi.advanceTimersByTime(30_000);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("signs out and clears the activity key at 60 minutes idle", async () => {
    render(<IdleTimeout />);
    await vi.advanceTimersByTimeAsync(IDLE_MS + 1_000);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(ACTIVITY_KEY)).toBeNull();
  });

  it("resets the clock on activity so 60 minutes after login does not sign out", async () => {
    render(<IdleTimeout />);
    // Activity at the 30-minute mark.
    vi.advanceTimersByTime(30 * 60 * 1000);
    window.dispatchEvent(new KeyboardEvent("keydown"));
    // 29 more minutes: 59 minutes since login, but only 29 since activity.
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out immediately on mount if the stored timestamp is already stale", async () => {
    localStorage.setItem(ACTIVITY_KEY, String(Date.now() - (IDLE_MS + 1_000)));
    render(<IdleTimeout />);
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("does nothing when there is no signed-in user", () => {
    mockUser = null;
    render(<IdleTimeout />);
    vi.advanceTimersByTime(IDLE_MS + 1_000);
    expect(signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACTIVITY_KEY)).toBeNull();
  });
});
