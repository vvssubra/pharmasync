import { format } from "date-fns";
import { AlertCircle } from "lucide-react";
import { formatIC, isValidIC } from "@/lib/ic";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface QuotaPatientRow {
  id: string;
  source_bil: number | null;
  tarikh_mula_rawatan: string | null;
  status: string;
  dosing: string | null;
  fms_name: string | null;
  catatan: string | null;
  kuota: number;
  patient_id: string;
  patient_registry: { id: string; patient_name: string; no_ic: string };
}

interface Props {
  rows: QuotaPatientRow[];
  selectedPatientId: string | null;
  onSelect: (patientId: string) => void;
  isLoading?: boolean;
  emptyMessage: string;
}

export function QuotaPatientTable({ rows, selectedPatientId, onSelect, isLoading, emptyMessage }: Props) {
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
            <TableHead>CATATAN</TableHead>
            <TableHead className="text-right">KUOTA</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 9 }).map((__, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">{emptyMessage}</TableCell>
            </TableRow>
          ) : rows.map((row, i) => {
            const patient = row.patient_registry;
            const validIC = isValidIC(patient.no_ic);
            const isAktif = row.status.toUpperCase() === "AKTIF";
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
                  <Badge variant="outline" className={isAktif ? "bg-green-100 text-green-700 border-green-300" : "bg-gray-100 text-gray-600 border-gray-300"}>
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">{row.dosing ?? "—"}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{row.fms_name ?? "—"}</TableCell>
                <TableCell className="text-xs max-w-[220px] truncate" title={row.catatan ?? undefined}>
                  {row.catatan ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {row.kuota > 1 ? (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">{row.kuota}</Badge>
                  ) : (
                    <span className={row.kuota === 0 ? "text-muted-foreground" : ""}>{row.kuota}</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
