import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuotaBenchmarkCard } from "./QuotaBenchmarkCard";
import type { DrugQuotaUsage } from "@/hooks/useDrugQuotaUsage";

function makeUsage(overrides: Partial<DrugQuotaUsage> = {}): DrugQuotaUsage {
  return {
    clinic_id: "clinic-1",
    drug_id: "drug-novomix",
    year: 2026,
    quota_limit: 100,
    alert_threshold_pct: 20,
    used: 71,
    remaining: 29,
    ...overrides,
  };
}

const noop = () => {};

describe("QuotaBenchmarkCard", () => {
  it("renders 100 / 71 / 29 for Novomix's Kempas numbers", () => {
    const usage = makeUsage();
    render(
      <QuotaBenchmarkCard
        drugId="drug-novomix"
        drugName="Insulin Novomix"
        year={2026}
        availableYears={[2026, 2025]}
        onYearChange={noop}
        usage={usage}
        allUsage={new Map([["drug-novomix", usage]])}
        prevUsage={undefined}
        drugNamesById={new Map([["drug-novomix", "Insulin Novomix"]])}
      />
    );
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("71")).toBeInTheDocument();
    expect(screen.getByText("29")).toBeInTheDocument();
  });

  it("clamps a negative remaining to 0 for display only, keeps the exhausted badge honest", () => {
    const usage = makeUsage({ drug_id: "drug-x", quota_limit: 40, used: 45, remaining: -5 });
    const peer = makeUsage({ drug_id: "drug-peer", used: 15 });
    render(
      <QuotaBenchmarkCard
        drugId="drug-x"
        drugName="Ubat X"
        year={2026}
        availableYears={[2026]}
        onYearChange={noop}
        usage={usage}
        allUsage={new Map([["drug-x", usage], ["drug-peer", peer]])}
        prevUsage={undefined}
        drugNamesById={new Map([["drug-x", "Ubat X"], ["drug-peer", "Ubat Peer"]])}
      />
    );
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Kuota Habis")).toBeInTheDocument();
  });

  it("shows the healthy badge when usage is well under the alert threshold", () => {
    const usage = makeUsage({ drug_id: "drug-y", quota_limit: 100, used: 10, remaining: 90 });
    render(
      <QuotaBenchmarkCard
        drugId="drug-y"
        drugName="Ubat Y"
        year={2026}
        availableYears={[2026]}
        onYearChange={noop}
        usage={usage}
        allUsage={new Map([["drug-y", usage]])}
        prevUsage={undefined}
        drugNamesById={new Map([["drug-y", "Ubat Y"]])}
      />
    );
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("hides the delta line when there is no prior-year quota row", () => {
    const usage = makeUsage();
    render(
      <QuotaBenchmarkCard
        drugId="drug-novomix"
        drugName="Insulin Novomix"
        year={2026}
        availableYears={[2026]}
        onYearChange={noop}
        usage={usage}
        allUsage={new Map([["drug-novomix", usage]])}
        prevUsage={undefined}
        drugNamesById={new Map([["drug-novomix", "Insulin Novomix"]])}
      />
    );
    expect(screen.queryByText(/berbanding tahun lalu/)).not.toBeInTheDocument();
  });

  it("shows a falling (green, ▼) delta when usage dropped versus last year", () => {
    const usage = makeUsage({ used: 40 });
    const prevUsage = makeUsage({ used: 80 });
    render(
      <QuotaBenchmarkCard
        drugId="drug-novomix"
        drugName="Insulin Novomix"
        year={2026}
        availableYears={[2026, 2025]}
        onYearChange={noop}
        usage={usage}
        allUsage={new Map([["drug-novomix", usage]])}
        prevUsage={prevUsage}
        drugNamesById={new Map([["drug-novomix", "Insulin Novomix"]])}
      />
    );
    const delta = screen.getByText(/berbanding tahun lalu/);
    expect(delta.textContent).toContain("▼");
    expect(delta.className).toContain("text-emerald-500");
  });

  it("shows the empty state when the drug has no quota row this year", () => {
    render(
      <QuotaBenchmarkCard
        drugId="drug-none"
        drugName="Ubat Tiada Kuota"
        year={2026}
        availableYears={[2026]}
        onYearChange={noop}
        usage={undefined}
        allUsage={new Map()}
        prevUsage={undefined}
        drugNamesById={new Map()}
      />
    );
    expect(screen.getByText(/Tiada kuota ditetapkan/)).toBeInTheDocument();
  });

  it("renders a loading skeleton instead of numbers", () => {
    const usage = makeUsage();
    render(
      <QuotaBenchmarkCard
        drugId="drug-novomix"
        drugName="Insulin Novomix"
        year={2026}
        availableYears={[2026]}
        onYearChange={noop}
        usage={usage}
        allUsage={new Map([["drug-novomix", usage]])}
        prevUsage={undefined}
        drugNamesById={new Map([["drug-novomix", "Insulin Novomix"]])}
        isLoading
      />
    );
    expect(screen.queryByText("71")).not.toBeInTheDocument();
  });
});
