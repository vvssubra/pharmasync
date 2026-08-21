import { KeyRound, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";

export function TopNavbar() {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-4 shadow-sm">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        <div className="hidden sm:block">
          <p className="shimmer-emerald text-base font-bold leading-tight">PharmaSync</p>
          {/* No fallback clinic name. A hardcoded one told a super_admin —
              whose clinic_id is NULL by design — that they were looking at one
              particular clinic's data while they were in fact looking at every
              clinic's. Say "All clinics" for them, and nothing at all when
              there is no clinic to name. */}
          {(role === "super_admin" || profile?.clinic_name) && (
            <p className="text-xs text-muted-foreground">
              {role === "super_admin" ? "All clinics" : profile?.clinic_name}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {profile && (
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-sm font-medium text-foreground leading-tight">
                {profile.full_name || "User"}
              </span>
              {role && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 capitalize">
                  {role}
                </Badge>
              )}
            </div>
            {/* Avatar circle */}
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold select-none">
              {initials}
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/change-password")}
          aria-label="Change password"
          className="text-muted-foreground hover:text-foreground"
        >
          <KeyRound className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={signOut}
          aria-label="Log keluar"
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}