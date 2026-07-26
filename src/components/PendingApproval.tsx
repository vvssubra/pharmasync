// src/components/PendingApproval.tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PendingApproval() {
  const { signOut, profile } = useAuth();
  const pendingClinicId = profile?.pending_clinic_id ?? null;

  // Resolved from the clinics list rather than embedded through profiles:
  // profiles has two foreign keys to clinics, which makes an embed ambiguous.
  const { data: requestedClinic } = useQuery({
    queryKey: ["pending-clinic-name", pendingClinicId],
    enabled: !!pendingClinicId,
    queryFn: async () => {
      const { data } = await supabase
        .from("clinics")
        .select("name")
        .eq("id", pendingClinicId!)
        .maybeSingle();
      return data?.name ?? null;
    },
  });

  return (
    <div className="flex min-h-screen items-start justify-center bg-background pt-24 px-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="text-xl">Akaun Dalam Proses Kelulusan</CardTitle>
          <CardDescription>Digital Bin Card — Klinik Kesihatan Kempas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Akaun anda telah didaftarkan. Sila hubungi pentadbir sistem untuk
            mendapatkan akses. Anda akan dapat log masuk setelah peranan ditetapkan.
          </p>
          {requestedClinic && (
            <p className="text-sm">
              <span className="text-muted-foreground">Klinik dipohon: </span>
              <span className="font-medium">{requestedClinic}</span>
            </p>
          )}
          <Button variant="outline" className="w-full" onClick={signOut}>
            Log Keluar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
