import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDrugQuotaUsage } from "@/hooks/useDrugQuotaUsage";
import { quotaDerivedStatus } from "@/lib/quotaHelpers";
import { computeStock } from "@/lib/stock";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Stethoscope, ClipboardList, Pill, AlertTriangle, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface MyRequestRow {
  id: string;
  created_at: string;
  patient_name: string;
  quantity: number;
  status: string;
  drugs: { drug_name: string; unit_pengukuran: string } | null;
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
  const [stockFilter, setStockFilter] = useState<"critical" | "available" | null>(null);

  // Drug quota
  const { data: rawDrugStock = [], isLoading: stockLoading } = useQuery({
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
          .select("drug_id, jenis, kuantiti, tarikh, created_at"),
      ]);
      return (drugs ?? []).map(d => {
        const stock = computeStock(d.id, txns ?? []);
        let physicalStatus = "normal";
        if (stock <= (d.stok_min ?? 0)) physicalStatus = "critical";
        else if (stock <= (d.stok_reorder ?? 0)) physicalStatus = "low";
        return { ...d, current_stock: stock, physicalStatus };
      });
    },
  });

  const currentYear = new Date().getFullYear();

  // Server-computed usage — also fixes this page's previous status='fulfilled'
  // filter, which under-counted quota use versus every other dashboard
  // (usage is meant to be deducted the moment a request is submitted, not
  // only once the pharmacist fulfils it).
  const { byDrugId: quotaUsageByDrug } = useDrugQuotaUsage(currentYear);

  // Controlled drugs (insulin under the FMS quota register) aren't tracked by
  // physical stock thresholds — Critical/Low/Normal must come from remaining
  // annual quota instead. Non-controlled drugs keep the physical-stock status.
  const drugStock = useMemo(() => rawDrugStock.map(d => ({
    ...d,
    status: quotaDerivedStatus(d.perlu_kelulusan_pakar, quotaUsageByDrug.get(d.id)) ?? d.physicalStatus,
  })), [rawDrugStock, quotaUsageByDrug]);

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
      return (data ?? []) as MyRequestRow[];
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

      {/* Summary — click a card to filter the table below */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          role="button" tabIndex={0}
          onClick={() => setStockFilter(null)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setStockFilter(null); } }}
          className={cn("cursor-pointer transition-shadow hover:shadow-md", stockFilter === null && "ring-2 ring-primary")}
        >
          <CardContent className="flex items-center gap-3 p-4">
            <Pill className="h-6 w-6 text-primary" />
            <div>
              <p className="text-2xl font-bold">{drugStock.length}</p>
              <p className="text-xs text-muted-foreground">Total Active Drugs</p>
            </div>
          </CardContent>
        </Card>
        <Card
          role="button" tabIndex={0}
          onClick={() => setStockFilter((f) => (f === "available" ? null : "available"))}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setStockFilter((f) => (f === "available" ? null : "available")); } }}
          className={cn("bg-green-50 cursor-pointer transition-shadow hover:shadow-md", stockFilter === "available" && "ring-2 ring-primary")}
        >
          <CardContent className="flex items-center gap-3 p-4">
            <Pill className="h-6 w-6 text-green-600" />
            <div>
              <p className="text-2xl font-bold text-green-700">{availableDrugs.length}</p>
              <p className="text-xs text-muted-foreground">Available to Request</p>
            </div>
          </CardContent>
        </Card>
        <Card
          role="button" tabIndex={0}
          onClick={() => setStockFilter((f) => (f === "critical" ? null : "critical"))}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setStockFilter((f) => (f === "critical" ? null : "critical")); } }}
          className={cn("bg-red-50 cursor-pointer transition-shadow hover:shadow-md", stockFilter === "critical" && "ring-2 ring-primary")}
        >
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Pill className="h-4 w-4" />
            Available Drug Quota
            {stockFilter && (
              <span className="ml-2 font-normal text-sm text-muted-foreground">
                — filtered to {stockFilter === "available" ? "available" : "critical"}
              </span>
            )}
          </CardTitle>
          {stockFilter && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setStockFilter(null)}>
              Clear filter
            </Button>
          )}
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
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drugStock
                  .filter(d => !stockFilter || (stockFilter === "critical" ? d.status === "critical" : d.status !== "critical"))
                  .map(d => (
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
                        const quotaRow = quotaUsageByDrug.get(d.id);
                        if (!quotaRow) return <Badge variant="outline" className="text-[10px] text-muted-foreground">No quota set</Badge>;
                        const remaining = quotaRow.remaining;
                        const pct = quotaRow.quota_limit > 0 ? remaining / quotaRow.quota_limit : 0;
                        const cls = pct <= 0.1 ? "bg-red-100 text-red-700 border-red-300"
                                   : pct <= 0.25 ? "bg-amber-100 text-amber-700 border-amber-300"
                                   : "bg-green-100 text-green-700 border-green-300";
                        return <Badge variant="outline" className={`text-[10px] ${cls}`}>{remaining} / {quotaRow.quota_limit}</Badge>;
                      })() : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => navigate(`/pesakit?drug=${d.id}`)}>
                        <Users className="h-3 w-3 mr-1" /> Patient Registry
                      </Button>
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
                    <TableCell className="text-sm">{r.drugs?.drug_name}</TableCell>
                    <TableCell className="text-right text-sm">{r.quantity} {r.drugs?.unit_pengukuran}</TableCell>
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
