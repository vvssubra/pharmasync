import { format } from "date-fns";
import { AlertCircle } from "lucide-react";
import { formatIC, isValidIC } from "@/lib/ic";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  QUOTA_STATUSES, isQuotaStatus, statusBadgeClass, type QuotaStatus,
} from "@/lib/quotaStatus";

export interface QuotaPatientRow {
  id: string;
  source_bil: number | null;
  tarikh_mula_rawatan: string | null;
  status: string;
  dosing: string | null;
  fms_name: string | null;
  clinic_name: string | null;
  catatan: string | null;
  /**
   * Not rendered — the KUOTA column was dropped. Kept on the row because the
   * caller's duplicate-IC collapse folds a group down to max(kuota) to stay in
   * step with drug_quota_used(); the value decides which row survives.
   */
  kuota: number;
  patient_id: string;
  patient_registry: { id: string; patient_name: string; no_ic: string };
}

interface Props {
  rows: QuotaPatientRow[];
  selectedPatientId: string | null;
  onSelect: (patientId: string) => void;
  /**
   * Omitted for anyone who may not change a status — the cell stays a plain
   * badge. Only admin and super_admin get this, matching the trigger in
   * 20260827000000_quota_patient_status.sql; the database refuses the rest
   * whether or not the dropdown is on screen.
   */
  onStatusChange?: (row: QuotaPatientRow, status: QuotaStatus) => void;
  /** Row whose status write is in flight — its dropdown is disabled. */
  savingStatusRowId?: string | null;
  isLoading?: boolean;
  emptyMessage: string;
}

export function QuotaPatientTable({
  rows, selectedPatientId, onSelect, onStatusChange, savingStatusRowId, isLoading, emptyMessage,
}: Props) {
  // One clinic on screen means KLINIK is the same string on every row — noise.
  // It earns its place only when the list actually spans clinics, which is
  // super_admin and logistic_pharmacist (both read cross-clinic here). Same
  // rule RoleManagement applies to its own clinic column.
  const showClinic = new Set(rows.map(r => r.clinic_name).filter(Boolean)).size > 1;
  const colCount = showClinic ? 9 : 8;
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">BIL</TableHead>
            <TableHead>NAMA PESAKIT</TableHead>
            <TableHead>NO IC</TableHead>
            <TableHead>TARIKH MULA RAWATAN</TableHead>
            <TableHead>STATUS</TableHead>
            <TableHead>DOSING</TableHead>
            <TableHead>FMS</TableHead>
            {showClinic && <TableHead>KLINIK</TableHead>}
            <TableHead>CATATAN</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: colCount }).map((__, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">{emptyMessage}</TableCell>
            </TableRow>
          ) : rows.map((row, i) => {
            const patient = row.patient_registry;
            const validIC = isValidIC(patient.no_ic);
            return (
              <TableRow
                key={row.id}
                className={cn("cursor-pointer", selectedPatientId === patient.id && "bg-muted/50")}
                onClick={() => onSelect(patient.id)}
              >
                <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">{patient.patient_name}</TableCell>
                <TableCell className="text-xs">
                  <div className="flex items-center gap-1">
                    {formatIC(patient.no_ic)}
                    {!validIC && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent>No. IC tidak sah — sila sahkan</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {row.tarikh_mula_rawatan ? format(new Date(row.tarikh_mula_rawatan), "dd/MM/yyyy") : "—"}
                </TableCell>
                <TableCell>
                  {onStatusChange ? (
                    // stopPropagation: the row itself opens the patient history
                    // sheet on click, which would swallow every interaction with
                    // the dropdown (and pop the sheet open behind it).
                    <div onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={isQuotaStatus(row.status) ? row.status : undefined}
                        onValueChange={(next) => onStatusChange(row, next as QuotaStatus)}
                        disabled={savingStatusRowId === row.id}
                      >
                        <SelectTrigger
                          className="h-7 w-[8.5rem] text-xs"
                          aria-label={`Status ${patient.patient_name}`}
                        >
                          {/* A dispensing-request row carries the REQUEST's status
                              ("approved", "fulfilled") — not one of the three
                              enrolment statuses. Show it as the placeholder rather
                              than forcing it into the list, so the admin sees what
                              it is today and what they can change it to. */}
                          <SelectValue placeholder={row.status} />
                        </SelectTrigger>
                        <SelectContent>
                          {QUOTA_STATUSES.map(s => (
                            <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <Badge variant="outline" className={statusBadgeClass(row.status)}>
                      {row.status}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">{row.dosing ?? "—"}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{row.fms_name ?? "—"}</TableCell>
                {showClinic && (
                  <TableCell className="text-xs whitespace-nowrap">{row.clinic_name ?? "—"}</TableCell>
                )}
                <TableCell className="text-xs max-w-[220px] truncate" title={row.catatan ?? undefined}>
                  {row.catatan ?? "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
