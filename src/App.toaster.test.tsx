import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import App from "./App";

// Auth stays unresolved — we only care that the toast host is mounted at the root,
// not about any particular route's content.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}));

describe("App", () => {
  // Without a mounted <Toaster />, every toast.error/success call in the app is a
  // silent no-op — failed submissions look like a dead button.
  it("renders toasts fired from anywhere in the app", async () => {
    render(<App />);
    toast.error("Failed to submit form");
    await waitFor(() => expect(screen.getByText("Failed to submit form")).toBeTruthy());
  });
});
