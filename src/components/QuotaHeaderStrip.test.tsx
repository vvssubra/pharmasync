import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuotaHeaderStrip } from "./QuotaHeaderStrip";

describe("QuotaHeaderStrip", () => {
  it("renders 100 / 71 / 29 for Novomix's Kempas numbers", () => {
    render(<QuotaHeaderStrip quotaLimit={100} used={71} remaining={29} alertThresholdPct={20} />);
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("71")).toBeInTheDocument();
    expect(screen.getByText("29")).toBeInTheDocument();
  });

  it("clamps a negative remaining to 0 for display only", () => {
    render(<QuotaHeaderStrip quotaLimit={40} used={45} remaining={-5} alertThresholdPct={20} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    // The badge must still reflect the real over-quota state, not the clamp.
    expect(screen.getByText("Kuota Habis")).toBeInTheDocument();
  });

  it("shows the healthy badge when usage is well under the alert threshold", () => {
    render(<QuotaHeaderStrip quotaLimit={100} used={10} remaining={90} alertThresholdPct={20} />);
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("flips to the warning badge once remaining drops to the alert threshold", () => {
    // limit 100, alertThresholdPct 20 -> warning once used >= 80
    render(<QuotaHeaderStrip quotaLimit={100} used={80} remaining={20} alertThresholdPct={20} />);
    expect(screen.getByText("Kuota Rendah")).toBeInTheDocument();
  });

  it("flips to the exhausted badge once used reaches the limit", () => {
    render(<QuotaHeaderStrip quotaLimit={40} used={40} remaining={0} alertThresholdPct={20} />);
    expect(screen.getByText("Kuota Habis")).toBeInTheDocument();
  });

  it("renders skeletons instead of numbers while loading", () => {
    render(<QuotaHeaderStrip quotaLimit={0} used={0} remaining={0} alertThresholdPct={20} isLoading />);
    expect(screen.queryByText("Jumlah Kuota")).not.toBeInTheDocument();
  });
});
