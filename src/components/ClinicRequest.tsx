// src/components/ClinicRequest.tsx
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * Shown to a signed-in user whose profile has no clinic and no pending request.
 *
 * The signup form collects a clinic and passes it through auth metadata, but a
 * Google sign-in carries no metadata, so handle_new_user() leaves both clinic
 * columns null and the account is unusable and invisible to clinic admins. This
 * asks for the clinic after the fact, writing it to pending_clinic_id — a
 * request an admin approves, never a grant (clinic_id is not writable here: the
 * tenancy hardening migration revokes that column from authenticated).
 */
export function ClinicRequest() {
  const { user, signOut, refreshProfile } = useAuth();
  const [clinicId, setClinicId] = useState("");

  // is_hq excluded: 'Logistik PKDJB' is the national HQ clinic, staffed only by
  // logistic pharmacists a super_admin provisions directly. Offering it here
  // lets anyone request membership of the clinic that owns the national quota
  // pool. RoleManagement's picker stays unfiltered — a super_admin does
  // legitimately provision HQ staff.
  const { data: clinics = [] } = useQuery({
    queryKey: ["clinics-request"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("is_hq", false)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const requestClinic = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ pending_clinic_id: clinicId })
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => refreshProfile(),
    onError: (err: unknown) => toast.error(getErrorMessage(err, "Gagal menghantar permohonan.")),
  });

  return (
    <div className="flex min-h-screen items-start justify-center bg-background pt-24 px-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="text-xl">Pilih Klinik Anda</CardTitle>
          <CardDescription>Digital Bin Card — Klinik Kesihatan Kempas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sila pilih klinik anda. Permohonan akan dihantar kepada pentadbir
            sistem untuk kelulusan sebelum anda boleh menggunakan sistem.
          </p>

          <Select value={clinicId} onValueChange={setClinicId}>
            <SelectTrigger data-testid="clinic-select">
              <SelectValue placeholder="Pilih klinik" />
            </SelectTrigger>
            <SelectContent>
              {clinics.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            className="w-full"
            data-testid="submit-clinic"
            disabled={!clinicId || requestClinic.isPending}
            onClick={() => requestClinic.mutate()}
          >
            {requestClinic.isPending ? "Menghantar…" : "Hantar Permohonan"}
          </Button>

          <Button variant="outline" className="w-full" onClick={signOut}>
            Log Keluar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
