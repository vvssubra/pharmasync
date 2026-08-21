import { ShieldX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function NoPermission() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldX className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">No Permission</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {/* Was: "Contact the pharmacist to be assigned an appropriate role
              (doctor, specialist, or pharmacist)." Wrong on both counts — a
              pharmacist cannot assign roles, and neither "doctor" nor
              "specialist" is an assignable role (see ASSIGNABLE_ROLES in
              RoleManagement.tsx). Roles are granted by a clinic admin. */}
          <p>You do not have permission to access this page.</p>
          <p>If you need access, contact your clinic admin — roles are assigned there.</p>
        </CardContent>
      </Card>
    </div>
  );
}
