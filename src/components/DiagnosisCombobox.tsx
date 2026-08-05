import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { NAG_DIAGNOSIS_OPTIONS, COMMON_DIAGNOSES, filterDiagnosisOptions } from "@/lib/diagnosisOptions";

interface DiagnosisComboboxProps {
  value: string;
  onChange: (value: string) => void;
  /** Most-recent-first; a picker convenience only, not stored anywhere here. */
  recent?: string[];
}

const MAX_RECENT = 5;

// cmdk's built-in filter only matches against each item's `value`, which
// here is the plain label — that would miss "sore throat" finding
// Pharyngitis. shouldFilter={false} + this local matcher searches label +
// aliases instead, and lets Recent/NAG/Common be filtered as one query.
export function DiagnosisCombobox({ value, onChange, recent = [] }: DiagnosisComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const recentOptions = useMemo(() => recent.slice(0, MAX_RECENT), [recent]);
  const recentLabels = useMemo(() => new Set(recentOptions.map((r) => r.toLowerCase())), [recentOptions]);

  const filteredRecent = useMemo(
    () => recentOptions.filter((r) => !query.trim() || r.toLowerCase().includes(query.trim().toLowerCase())),
    [recentOptions, query],
  );
  const filteredNag = useMemo(
    () => filterDiagnosisOptions(NAG_DIAGNOSIS_OPTIONS, query).filter((o) => !recentLabels.has(o.label.toLowerCase())),
    [query, recentLabels],
  );
  const filteredCommon = useMemo(
    () => filterDiagnosisOptions(COMMON_DIAGNOSES, query).filter((o) => !recentLabels.has(o.label.toLowerCase())),
    [query, recentLabels],
  );

  const trimmedQuery = query.trim();
  const exactMatch =
    filteredRecent.some((r) => r.toLowerCase() === trimmedQuery.toLowerCase()) ||
    filteredNag.some((o) => o.label.toLowerCase() === trimmedQuery.toLowerCase()) ||
    filteredCommon.some((o) => o.label.toLowerCase() === trimmedQuery.toLowerCase());
  const showFreeTextOption = trimmedQuery.length > 0 && !exactMatch;

  const select = (label: string) => {
    onChange(label);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Diagnosis"
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}
        >
          <span className="truncate">{value || "Select or type diagnosis..."}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search diagnosis..." value={query} onValueChange={setQuery} />
          <CommandList>
            {filteredRecent.length === 0 && filteredNag.length === 0 && filteredCommon.length === 0 && !showFreeTextOption && (
              <div className="py-6 text-center text-sm text-muted-foreground">No diagnosis found.</div>
            )}
            {filteredRecent.length > 0 && (
              <CommandGroup heading="Recent">
                {filteredRecent.map((label) => (
                  <CommandItem key={`recent-${label}`} value={label} onSelect={() => select(label)}>
                    <Check className={cn("mr-2 h-4 w-4", value === label ? "opacity-100" : "opacity-0")} />
                    {label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {filteredNag.length > 0 && (
              <CommandGroup heading="NAG 2024">
                {filteredNag.map((o) => (
                  <CommandItem key={`nag-${o.label}`} value={o.label} onSelect={() => select(o.label)}>
                    <Check className={cn("mr-2 h-4 w-4", value === o.label ? "opacity-100" : "opacity-0")} />
                    {o.label}
                    <Badge variant="secondary" className="ml-2 text-[10px]">NAG</Badge>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {filteredCommon.length > 0 && (
              <CommandGroup heading="Common">
                {filteredCommon.map((o) => (
                  <CommandItem key={`common-${o.label}`} value={o.label} onSelect={() => select(o.label)}>
                    <Check className={cn("mr-2 h-4 w-4", value === o.label ? "opacity-100" : "opacity-0")} />
                    {o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showFreeTextOption && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value={`__free-text-${trimmedQuery}`} onSelect={() => select(trimmedQuery)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Use "{trimmedQuery}"
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
