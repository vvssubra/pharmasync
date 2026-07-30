import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Archive, Search, Download, Eye } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AntibioticFormReadOnly } from "@/components/AntibioticFormReadOnly";
import { antibioticFormFilename, downloadMarkdown, formToMarkdown, type AntibioticFormRecord } from "@/lib/antibioticMarkdown";

type ArchivedAntibioticForm = AntibioticFormRecord & {
  id: string;
  submitted_by?: string | null;
  acknowledged_by?: string | null;
};

function formatIC(ic: string) {
  const d = (ic || "").replace(/\D/g, "");
  if (d.length === 12) return `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  return ic;
}

export default function AntibioticArchive() {
  const [search, setSearch] = useState("");
  const [viewTarget, setViewTarget] = useState<ArchivedAntibioticForm | null>(null);

  const { data: forms = [], isLoading } = useQuery({
    queryKey: ["antibiotic-archive"],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("antibiotic_forms")
        .select("*")
        .eq("status", "approved")
        .not("acknowledged_at", "is", null)
        .order("acknowledged_at", { ascending: false });
      if (error) throw error;

      const list = (rows ?? []) as ArchivedAntibioticForm[];
      const ids = [...new Set(list.flatMap(f => [f.submitted_by, f.acknowledged_by]).filter(Boolean) as string[])];
      const profileMap: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", ids);
        for (const p of profiles ?? []) profileMap[p.user_id] = p.full_name;
      }

      return list.map(f => ({
        ...f,
        submitted_by_name: profileMap[f.submitted_by] ?? "—",
        acknowledged_by_name: profileMap[f.acknowledged_by] ?? "—",
      }));
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return forms;
    return forms.filter(f =>
      (f.patient_name || "").toLowerCase().includes(q) ||
      (f.patient_ic || "").toLowerCase().includes(q) ||
      (f.diagnosis || "").toLowerCase().includes(q) ||
      (f.assigned_fms || "").toLowerCase().includes(q)
    );
  }, [forms, search]);

  const handleDownload = (form: ArchivedAntibioticForm) => {
    const md = formToMarkdown(form);
    downloadMarkdown(antibioticFormFilename(form), md);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Archive className="h-6 w-6" />
          Arkib Borang Antibiotik
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Rekod semua borang antibiotik yang telah diluluskan dan disahkan farmasi.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari mengikut nama, IC, diagnosis atau FMS..."
              className="w-full sm:max-w-md"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarikh</TableHead>
                  <TableHead>Pesakit</TableHead>
                  <TableHead>IC</TableHead>
                  <TableHead>Diagnosis</TableHead>
                  <TableHead>FMS</TableHead>
                  <TableHead>Disahkan</TableHead>
                  <TableHead className="text-right">Tindakan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Tiada borang antibiotik dijumpai</TableCell></TableRow>
                ) : filtered.map(f => (
                  <TableRow key={f.id}>
                    <TableCell className="text-xs">{f.tarikh}</TableCell>
                    <TableCell className="font-medium text-sm">{f.patient_name}</TableCell>
                    <TableCell className="text-xs">{formatIC(f.patient_ic)}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{f.diagnosis}</TableCell>
                    <TableCell className="text-xs">{f.assigned_fms || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {f.acknowledged_at ? format(new Date(f.acknowledged_at), "d MMM yyyy, HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap gap-2 justify-end">
                        <Button size="touch" variant="outline" className="text-xs gap-1" onClick={() => setViewTarget(f)}>
                          <Eye className="h-3 w-3" /> Lihat
                        </Button>
                        <Button size="touch" variant="outline" className="text-xs gap-1" onClick={() => handleDownload(f)}>
                          <Download className="h-3 w-3" /> .md
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewTarget} onOpenChange={open => { if (!open) setViewTarget(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Borang Antibiotik — {viewTarget?.patient_name}</DialogTitle>
          </DialogHeader>
          {viewTarget && <AntibioticFormReadOnly form={viewTarget} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewTarget(null)}>Tutup</Button>
            {viewTarget && (
              <Button className="gap-1" onClick={() => handleDownload(viewTarget)}>
                <Download className="h-3.5 w-3.5" /> Muat Turun .md
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
