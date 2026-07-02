import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";
import { Stethoscope, ClipboardList, Pill, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

function computeStock(drugId: string, txns: { drug_id: string; jenis: string; kuantiti: number }[]) {
  let stock = 0;
  for (const t of txns.filter(t => t.drug_id === drugId)) {
    if (t.jenis === "baki_awal") stock = t.kuantiti;
    else if (t.jenis === "terimaan") stock += t.kuantiti;
    else if (t.jenis === "keluaran") stock -= t.kuantiti;
  }
  return stock;
}

const STATUS_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-300",
  low:      "bg-amber-100 text-amber-700 border-amber-300",
  normal:   "bg-green-100 text-green-700 border-green-300",
};

const REQUEST_STATUS_BADGE: Record<string, string> = {
  pending:           "bg-yellow-100 text-yellow-700 border-yellow-300",
  pending_specialist:"bg-blue-100 text-blue-700 border-blue-300",
  pending_pharmacy:  "bg-cyan-100 text-cyan-700 border-cyan-300",
  approved:          "bg-green-100 text-green-700 border-green-300",
  rejected:          "bg-red-100 text-red-700 border-red-300",
  fulfilled:         "bg-gray-100 text-gray-700 border-gray-300",
};

const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending:            "Pending",
  pending_specialist: "Awaiting Approval",
  pending_pharmacy:   "Approved — Awaiting Pharmacist",
  approved:           "Approved",
  rejected:           "Rejected",
  fulfilled:          "Fulfilled",
};

export default function MoDashboard() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();

  // Drug quota
  const { data: drugStock = [], isLoading: stockLoading } = useQuery({
    queryKey: ["mo-drug-quota"],
    refetchInterval: 30000,
    queryFn: async () => {
      const [{ data: drugs }, { data: txns }] = await Promise.all([
        supabase
          .from("drugs")
          .select("id, drug_name, unit_pengukuran, stok_min, stok_reorder, perlu_kelulusan_pakar")
          .eq("is_active", true)
          .order("drug_name"),
        supabase
          .from("transactions")
          .select("drug_id, jenis, kuantiti"),
      ]);
      return (drugs ?? []).map(d => {
        const stock = computeStock(d.id, txns ?? []);
        let status = "normal";
        if (stock <= (d.stok_min ?? 0)) status = "critical";
        else if (stock <= (d.stok_reorder ?? 0)) status = "low";
        return { ...d, current_stock: stock, status };
      });
    },
  });

  const currentYear = new Date().getFullYear();

  const { data: drugQuotas = [] } = useQuery({
    queryKey: ["mo-drug-quotas", currentYear],
    queryFn: async () => {
      const { data } = await supabase.from("drug_quotas").select("drug_id, quota_limit").eq("year", currentYear);
      return (data ?? []) as { drug_id: string; quota_limit: number }[];
    },
  });

  const { data: ytdCounts = {} } = useQuery({
    queryKey: ["mo-ytd-counts", currentYear],
    refetchInterval: 30000,
    queryFn: async () => {
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear + 1}-01-01`;
      const { data } = await supabase.from("dispensing_requests").select("drug_id").eq("status", "fulfilled").gte("created_at", yearStart).lt("created_at", yearEnd);
      const counts: Record<string, number> = {};
      for (const r of data ?? []) counts[r.drug_id] = (counts[r.drug_id] ?? 0) + 1;
      return counts;
    },
  });

  // My recent requests
  const { data: myRequests = [], isLoading: reqLoading } = useQuery({
    queryKey: ["mo-my-requests", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("dispensing_requests")
        .select("*, drugs(drug_name, unit_pengukuran)")
        .eq("submitted_by", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const availableDrugs = drugStock.filter(d => d.status !== "critical");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Stethoscope className="h-6 w-6" />
            MO Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}. View available drug quota and your recent requests.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate("/request/ubat")} className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Drug Request
          </Button>
          <Button variant="outline" onClick={() => navigate("/request/antibiotik")} className="gap-2">
            <Pill className="h-4 w-4" />
            Antibiotic Form
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Pill className="h-6 w-6 text-primary" />
            <div>
              <p className="text-2xl font-bold">{drugStock.length}</p>
              <p className="text-xs text-muted-foreground">Total Active Drugs</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-green-50">
          <CardContent className="flex items-center gap-3 p-4">
            <Pill className="h-6 w-6 text-green-600" />
            <div>
              <p className="text-2xl font-bold text-green-700">{availableDrugs.length}</p>
              <p className="text-xs text-muted-foreground">Available to Request</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-red-50">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-6 w-6 text-red-600" />
            <div>
              <p className="text-2xl font-bold text-red-700">
                {drugStock.filter(d => d.status === "critical").length}
              </p>
              <p className="text-xs text-muted-foreground">Critical / Out of Stock</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Drug quota table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Pill className="h-4 w-4" />
            Available Drug Quota
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {stockLoading ? (
            <div className="p-4 space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Drug Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Current Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requires Approval</TableHead>
                  <TableHead>Quota Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drugStock.map(d => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium text-sm">{d.drug_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{d.unit_pengukuran}</TableCell>
                    <TableCell className="text-right font-semibold">{d.current_stock}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_BADGE[d.status]}`}>
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {d.perlu_kelulusan_pakar ? (
                        <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-300">Specialist Approval</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">Standard</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {d.perlu_kelulusan_pakar ? (() => {
                        const quotaRow = drugQuotas.find(q => q.drug_id === d.id);
                        if (!quotaRow) return <Badge variant="outline" className="text-[10px] text-muted-foreground">No quota set</Badge>;
                        const remaining = quotaRow.quota_limit - ((ytdCounts as Record<string,number>)[d.id] ?? 0);
                        const pct = quotaRow.quota_limit > 0 ? remaining / quotaRow.quota_limit : 0;
                        const cls = pct <= 0.1 ? "bg-red-100 text-red-700 border-red-300"
                                   : pct <= 0.25 ? "bg-amber-100 text-amber-700 border-amber-300"
                                   : "bg-green-100 text-green-700 border-green-300";
                        return <Badge variant="outline" className={`text-[10px] ${cls}`}>{remaining} / {quotaRow.quota_limit}</Badge>;
                      })() : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* My recent requests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            My Recent Requests
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {reqLoading ? (
            <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Drug</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myRequests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No requests yet. Use the buttons above to submit a drug request.
                    </TableCell>
                  </TableRow>
                ) : myRequests.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</TableCell>
                    <TableCell className="font-medium text-sm">{r.patient_name}</TableCell>
                    <TableCell className="text-sm">{(r.drugs as any)?.drug_name}</TableCell>
                    <TableCell className="text-right text-sm">{r.quantity} {(r.drugs as any)?.unit_pengukuran}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${REQUEST_STATUS_BADGE[r.status] ?? ""}`}>
                        {REQUEST_STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
