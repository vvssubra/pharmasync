import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDoseSuggestion } from "./useDoseSuggestion";

const mockSuggestDose = vi.fn();
vi.mock("@/lib/knowledgeClient", () => ({
  suggestDose: (...args: unknown[]) => mockSuggestDose(...args),
}));

describe("useDoseSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in idle state", () => {
    const { result } = renderHook(() =>
      useDoseSuggestion(null, { enabled: true })
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.matches).toEqual([]);
  });

  it("does not call suggestDose when disabled", () => {
    renderHook(() =>
      useDoseSuggestion({ query: "Pharyngitis", patient_group: "Adult" }, { enabled: false })
    );
    act(() => { vi.advanceTimersByTime(2000); });
    expect(mockSuggestDose).not.toHaveBeenCalled();
  });

  it("does not call suggestDose when query is null", () => {
    renderHook(() => useDoseSuggestion(null, { enabled: true }));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(mockSuggestDose).not.toHaveBeenCalled();
  });

  it("calls suggestDose after debounce and transitions to ok with matches", async () => {
    const matches = [{ drug: "Amoxicillin", indication: "Pharyngitis", patient_group: "Adult", source: "NAG 2024", body: "dose text", score: 0.9 }];
    mockSuggestDose.mockResolvedValueOnce({ matches });

    const { result } = renderHook(() =>
      useDoseSuggestion({ query: "Pharyngitis", patient_group: "Adult" }, { enabled: true })
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockSuggestDose).toHaveBeenCalledWith({ query: "Pharyngitis", patient_group: "Adult" });
    expect(result.current.status).toBe("ok");
    expect(result.current.matches).toEqual(matches);
  });

  it("sets error status when suggestDose throws", async () => {
    mockSuggestDose.mockRejectedValueOnce(new Error("down"));

    const { result } = renderHook(() =>
      useDoseSuggestion({ query: "Pharyngitis", patient_group: "Adult" }, { enabled: true })
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.matches).toEqual([]);
  });

  it("carries a message when the service reports no match", async () => {
    mockSuggestDose.mockResolvedValueOnce({ matches: [], message: "No matching guideline found" });

    const { result } = renderHook(() =>
      useDoseSuggestion({ query: "unknown thing" as string, patient_group: "Any" }, { enabled: true })
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.status).toBe("ok");
    expect(result.current.matches).toEqual([]);
    expect(result.current.message).toBe("No matching guideline found");
  });
});
