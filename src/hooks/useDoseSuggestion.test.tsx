import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDoseSuggestion } from "./useDoseSuggestion";
import { suggestDose } from "@/lib/knowledgeClient";

vi.mock("@/lib/knowledgeClient", () => ({
  suggestDose: vi.fn(),
}));

const mockSuggestDose = vi.mocked(suggestDose);

// One QueryClient per test — created inside the component body it would be
// recreated on every re-render, resetting the query to loading forever.
function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const REQUEST = { query: "pneumonia", patient_group: "Adult" as const };

// Debounce timer + fetch + React Query's async state notification: run all
// timers, then flush the trailing microtask queue so the observer's final
// state lands before asserting.
async function flushDebounceAndQuery() {
  // First pass fires the debounce timer and starts the fetch; second pass
  // lets React Query's post-resolve notification land.
  await act(async () => { await vi.runAllTimersAsync(); });
  await act(async () => { await vi.runAllTimersAsync(); });
}

describe("useDoseSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is idle when disabled", () => {
    const { result } = renderHook(
      () => useDoseSuggestion(REQUEST, { enabled: false }),
      { wrapper: createWrapper() },
    );
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.status).toBe("idle");
    expect(mockSuggestDose).not.toHaveBeenCalled();
  });

  it("is idle when the request is null", () => {
    const { result } = renderHook(() => useDoseSuggestion(null), { wrapper: createWrapper() });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.status).toBe("idle");
    expect(mockSuggestDose).not.toHaveBeenCalled();
  });

  it("does not fetch before the debounce elapses", () => {
    renderHook(() => useDoseSuggestion(REQUEST), { wrapper: createWrapper() });
    act(() => { vi.advanceTimersByTime(300); });
    expect(mockSuggestDose).not.toHaveBeenCalled();
  });

  it("fetches after the debounce and reports ok with matches", async () => {
    const matches = [{
      drug: "Amoxicillin", indication: "CAP", patient_group: "Adult" as const,
      source: "NAG 2024", body: "Amoxicillin 1g PO TDS x 5 days", score: 0.91,
    }];
    mockSuggestDose.mockResolvedValueOnce({ matches, message: undefined });

    const { result } = renderHook(() => useDoseSuggestion(REQUEST), { wrapper: createWrapper() });

    await flushDebounceAndQuery();

    expect(mockSuggestDose).toHaveBeenCalledWith(REQUEST);
    expect(result.current.status).toBe("ok");
    expect(result.current.matches).toEqual(matches);
  });

  it("reports ok with the service message when there are no matches", async () => {
    mockSuggestDose.mockResolvedValueOnce({ matches: [], message: "No matching guideline found" });

    const { result } = renderHook(() => useDoseSuggestion(REQUEST), { wrapper: createWrapper() });

    await flushDebounceAndQuery();

    expect(result.current.status).toBe("ok");
    expect(result.current.matches).toEqual([]);
    expect(result.current.message).toBe("No matching guideline found");
  });

  it("reports error with empty matches when the lookup fails", async () => {
    mockSuggestDose.mockRejectedValueOnce(new Error("sidecar down"));

    const { result } = renderHook(() => useDoseSuggestion(REQUEST), { wrapper: createWrapper() });

    await flushDebounceAndQuery();

    expect(result.current.status).toBe("error");
    expect(result.current.matches).toEqual([]);
  });

  it("restarts the debounce when the request changes mid-wait", async () => {
    mockSuggestDose.mockResolvedValue({ matches: [], message: "No matching guideline found" });

    const { rerender } = renderHook(
      ({ req }) => useDoseSuggestion(req),
      { wrapper: createWrapper(), initialProps: { req: REQUEST } },
    );

    act(() => { vi.advanceTimersByTime(500); });
    rerender({ req: { query: "pneumonia, fever", patient_group: "Adult" as const } });
    await flushDebounceAndQuery();

    expect(mockSuggestDose).toHaveBeenCalledTimes(1);
    expect(mockSuggestDose).toHaveBeenCalledWith({ query: "pneumonia, fever", patient_group: "Adult" });
  });
});
