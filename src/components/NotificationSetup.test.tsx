import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NotificationSetup } from "./NotificationSetup";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/push")>();
  return {
    ...actual,
    pushSupported: vi.fn(() => true),
    subscribeToPush: vi.fn(() => Promise.resolve(true)),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useAuth } from "@/contexts/AuthContext";
import { pushSupported, subscribeToPush } from "@/lib/push";

// jsdom has no Notification API; the component reads permission and calls
// requestPermission, so a minimal stand-in is enough.
function stubNotification(permission: NotificationPermission) {
  vi.stubGlobal("Notification", {
    permission,
    requestPermission: vi.fn(() => Promise.resolve("granted" as NotificationPermission)),
  });
}

function setAuth(role: string | null, userId = "u-1") {
  vi.mocked(useAuth).mockReturnValue({
    user: userId ? { id: userId } : null,
    role,
    profile: null,
    loading: false,
    session: null,
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

describe("NotificationSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pushSupported).mockReturnValue(true);
    vi.mocked(subscribeToPush).mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers the enable card to an fms user without permission yet", () => {
    stubNotification("default");
    setAuth("fms");
    render(<NotificationSetup />);
    expect(screen.getByText("Turn on request alerts")).toBeInTheDocument();
  });

  it("renders nothing for a non-approver role", () => {
    stubNotification("default");
    setAuth("mo");
    render(<NotificationSetup />);
    expect(screen.queryByText("Turn on request alerts")).toBeNull();
  });

  it("silently re-subscribes when permission is already granted", async () => {
    stubNotification("granted");
    setAuth("admin");
    render(<NotificationSetup />);
    await waitFor(() => expect(subscribeToPush).toHaveBeenCalledWith("u-1"));
    expect(screen.queryByText("Turn on request alerts")).toBeNull();
  });

  it("requests permission then subscribes on Enable", async () => {
    stubNotification("default");
    setAuth("fms");
    render(<NotificationSetup />);
    screen.getByRole("button", { name: /enable notifications/i }).click();
    await waitFor(() => expect(subscribeToPush).toHaveBeenCalledWith("u-1"));
    expect(
      (globalThis.Notification as unknown as { requestPermission: ReturnType<typeof vi.fn> })
        .requestPermission,
    ).toHaveBeenCalledTimes(1);
  });

  it("stays hidden when push is unsupported (iOS Safari tab)", () => {
    stubNotification("default");
    vi.mocked(pushSupported).mockReturnValue(false);
    setAuth("fms");
    render(<NotificationSetup />);
    expect(screen.queryByText("Turn on request alerts")).toBeNull();
  });
});
