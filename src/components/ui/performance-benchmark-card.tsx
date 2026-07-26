import * as React from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Generic type definitions for the component props
export interface BenchmarkCompetitor {
  name: string;
  value: number;
  icon: React.ReactNode;
}

export interface BenchmarkLevel {
  label: string;
  value: number;
  color: string;
}

export interface BenchmarkFilterOption {
  value: string;
  label: string;
}

export interface PerformanceCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  headerIcon?: React.ReactNode;
  mainValue: number;
  /** null hides the delta line entirely (e.g. no prior-period data to compare). */
  percentageChange: number | null;
  percentageChangeLabel?: string;
  benchmarkAverage: number;
  benchmarkLabel?: string;
  competitors: BenchmarkCompetitor[];
  competitorsLabel?: string;
  performanceLevels: BenchmarkLevel[];
  levelsLabel?: string;
  /** Optional dropdown in the header (e.g. a year picker). Omitted entirely when no options are given. */
  filterOptions?: BenchmarkFilterOption[];
  filterValue?: string;
  onFilterChange?: (value: string) => void;
  filterAriaLabel?: string;
  /** Footer action buttons — the host decides what "Share" / "Copy link" actually do. */
  actions?: React.ReactNode;
  /** Extra content rendered between the header and the main metric (e.g. a remaining-balance line + status badge). */
  subHeader?: React.ReactNode;
}

// Renders `value` as its final text immediately (deterministic — no
// interpolated count-up, so screen readers and tests always see the real
// number) with a brief fade+slide whenever it changes. `key={value}` retriggers
// the transition on updates (e.g. switching the selected drug); reduced-motion
// users skip the transition entirely via `transition={{ duration: 0 }}`.
const AnimatedNumber = ({ value }: { value: number }) => {
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
    >
      {value.toLocaleString()}
    </motion.span>
  );
};

// Generic performance-vs-benchmark card: a headline metric, a benchmark-average
// marker on its progress bar, a short list of comparators, and a banded
// threshold bar. Domain meaning (what "benchmark" and "competitors" represent)
// is entirely up to the caller.
export const PerformanceCard = React.forwardRef<HTMLDivElement, PerformanceCardProps>(
  (
    {
      className,
      title,
      headerIcon,
      mainValue,
      percentageChange,
      percentageChangeLabel = "to last period",
      benchmarkAverage,
      benchmarkLabel = "Benchmark average",
      competitors,
      competitorsLabel = "Main competitors",
      performanceLevels,
      levelsLabel = "Performance benchmark levels",
      filterOptions,
      filterValue,
      onFilterChange,
      filterAriaLabel,
      actions,
      subHeader,
      ...props
    },
    ref
  ) => {
    const cardRef = React.useRef<HTMLDivElement>(null);
    const isInView = useInView(cardRef, { once: true, margin: "-100px" });
    const maxValue = Math.max(mainValue, benchmarkAverage, ...competitors.map((c) => c.value), 1);
    const lastLevel = performanceLevels[performanceLevels.length - 1];
    const totalLevelValue = lastLevel ? lastLevel.value : 0;

    return (
      <Card ref={cardRef} className={cn("w-full max-w-lg mx-auto", className)} {...props}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              {headerIcon}
              <span>{title}</span>
            </div>
            {filterOptions && filterOptions.length > 0 && (
              <Select value={filterValue} onValueChange={onFilterChange}>
                <SelectTrigger className="w-[120px] h-8 text-xs" aria-label={filterAriaLabel}>
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  {filterOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subHeader}
          {/* Main Metric Section */}
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <p className="text-4xl font-bold tracking-tight">
                <AnimatedNumber value={mainValue} />
              </p>
              {percentageChange !== null && (
                <p
                  className={cn(
                    "text-xs font-medium",
                    percentageChange > 0 ? "text-red-500" : percentageChange < 0 ? "text-emerald-500" : "text-muted-foreground"
                  )}
                >
                  {percentageChange >= 0 ? "▲" : "▼"} {Math.abs(percentageChange)}% {percentageChangeLabel}
                </p>
              )}
            </div>
            <div className="w-1/2">
              <div className="relative h-2 rounded-full bg-muted">
                <motion.div
                  className="absolute h-2 rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: isInView ? `${Math.min(100, (mainValue / maxValue) * 100)}%` : 0 }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
                <motion.div
                  className="absolute h-2 -translate-y-1/2 top-1/2"
                  style={{
                    left: `${Math.min(100, (benchmarkAverage / maxValue) * 100)}%`,
                    width: "1px",
                    height: "16px",
                    backgroundColor: "hsl(var(--foreground))",
                  }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: isInView ? 1 : 0 }}
                  transition={{ duration: 0.5, delay: 0.8 }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>{benchmarkLabel}</span>
                <span>{benchmarkAverage.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Competitors Section */}
          {competitors.length > 0 && (
            <div className="space-y-3 mb-6">
              <h3 className="text-sm font-medium">{competitorsLabel}</h3>
              {competitors.map((competitor) => (
                <div key={competitor.name} className="flex items-center gap-3">
                  <div className="text-muted-foreground">{competitor.icon}</div>
                  <span className="flex-1 text-sm">{competitor.name}</span>
                  <span className="text-sm font-medium">{competitor.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {/* Performance Levels Section */}
          {performanceLevels.length > 0 && (
            <div className="space-y-3 mb-6">
              <h3 className="text-sm font-medium">{levelsLabel}</h3>
              <div className="relative flex w-full h-2 rounded-full overflow-hidden bg-muted">
                {performanceLevels.map((level, i) => {
                  const prevValue = i > 0 ? performanceLevels[i - 1].value : 0;
                  const width = totalLevelValue > 0 ? ((level.value - prevValue) / totalLevelValue) * 100 : 0;
                  return <div key={level.label} className={level.color} style={{ width: `${Math.max(0, width)}%` }} />;
                })}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                {performanceLevels.map((level) => (
                  <span key={level.label}>{level.label}</span>
                ))}
              </div>
            </div>
          )}

          {actions && <div className="flex gap-2">{actions}</div>}
        </CardContent>
      </Card>
    );
  }
);

PerformanceCard.displayName = "PerformanceCard";
