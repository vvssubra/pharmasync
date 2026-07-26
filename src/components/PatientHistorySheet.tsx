import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";
import { formatIC } from "@/lib/ic";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";

interface Patient {
  id: string;
  patient_name: string;
  no_ic: string;
  created_at: string;
}

interface Props {
  patient: Patient | null;
  onOpenChange: (open: boolean) => void;
  onRefill: (patient: Patient) => void;
}

interface HistoryRow {
  id: string;
  dispensed_at: string;
  quantity: number;
  method: string;
  officer_name: string | null;
  stock_after: number | null;
  drugs: { drug_name: string; unit_pengukuran: string } | null;
}

// Moved verbatim (behaviourally) out of PatientRegistry.tsx's right-hand
// detail pane, now presented as a slide-over so the left side can be a
// full-width quota table instead of a 1/3-width master list.
export function PatientHistorySheet({ patient, onOpenChange, onRefill }: Props) {
  const { data: history = [] } = useQuery({
    queryKey: ["patient-history", patient?.id],
    enabled: !!patient?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_drug_history")
        .select("*, drugs(drug_name, unit_pengukuran)")
        .eq("patient_id", patient!.id)
        .order("dispensed_at", { ascending: false });
      if (error) throw error;
      return data as HistoryRow[];
    },
  });

  return (
    <Sheet open={!!patient} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {patient && (
          <>
            <SheetHeader>
              <SheetTitle>{patient.patient_name}</SheetTitle>
              <SheetDescription>
                {formatIC(patient.no_ic)} · Dalam sistem sejak {format(new Date(patient.created_at), "dd/MM/yyyy")}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => onRefill(patient)}>
                <RefreshCw className="mr-1 h-3 w-3" /> Isi Semula Ubat
              </Button>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Ubat Semasa", value: history.length > 0 ? history[0].drugs?.drug_name ?? "—" : "—" },
                  { label: "Jumlah Lawatan", value: history.length },
                  { label: "Lawatan Terakhir", value: history.length > 0 ? format(new Date(history[0].dispensed_at), "dd/MM/yyyy") : "—" },
                  { label: "Kuantiti Terkini", value: history.length > 0 ? history[0].quantity : "—" },
                ].map(s => (
                  <Card key={s.label}>
                    <CardContent className="p-3 text-center">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-lg font-bold text-foreground truncate">{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tarikh</TableHead>
                        <TableHead>Ubat</TableHead>
                        <TableHead>Kuantiti</TableHead>
                        <TableHead>Kaedah</TableHead>
                        <TableHead>Pegawai</TableHead>
                        <TableHead>Baki Stok</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Tiada sejarah pengeluaran.</TableCell></TableRow>
                      ) : history.map(h => (
                        <TableRow key={h.id}>
                          <TableCell className="text-xs">{format(new Date(h.dispensed_at), "dd/MM/yyyy")}</TableCell>
                          <TableCell className="text-sm">{h.drugs?.drug_name}</TableCell>
                          <TableCell>{h.quantity} {h.drugs?.unit_pengukuran}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={h.method === "walk_in" ? "bg-green-100 text-green-700 border-green-300" : "bg-blue-100 text-blue-700 border-blue-300"}>
                              {h.method === "walk_in" ? "Walk-in" : "Temujanji"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{h.officer_name}</TableCell>
                          <TableCell>{h.stock_after ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
