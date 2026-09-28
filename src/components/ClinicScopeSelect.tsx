import { Building2 } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { ScopeClinic } from "@/hooks/useClinicScope";

/**
 * Names the one clinic whose figures the page is showing, and lets a
 * super_admin change it. Render only when useClinicScope().isSuperAdmin —
 * every other role has exactly one clinic and no choice to make.
 *
 * Its real job is labelling, not filtering: a super_admin's figures are
 * always one clinic's, so the page must never present a number without
 * saying whose it is.
 */
export function ClinicScopeSelect({
  clinics,
  value,
  onChange,
  label = "Viewing",
}: {
  clinics: ScopeClinic[];
  value: string | null;
  onChange: (id: string) => void;
  /** Verb shown before the select; "Viewing" on report pages. */
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">{label}</span>
      {/* "" not undefined while the clinic list is still loading: undefined
          makes Radix treat the Select as uncontrolled on the first render and
          then warn when a real value arrives. "" is a valid root value (only
          SelectItem forbids it) and shows the placeholder. */}
      {/* Ignore "": Radix's hidden native <select> can emit an empty change while
          its options re-render, and a saved "" would clear the derived clinic. */}
      <Select value={value ?? ""} onValueChange={(id) => { if (id) onChange(id); }}>
        <SelectTrigger className="h-9 w-[220px]" aria-label="Clinic">
          <SelectValue placeholder="Select a clinic" />
        </SelectTrigger>
        <SelectContent>
          {clinics.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
