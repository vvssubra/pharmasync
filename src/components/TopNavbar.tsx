import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";

export function TopNavbar() {
  const { profile, role, signOut } = useAuth();

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-4 shadow-sm">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        <div className="hidden sm:block">
          <p className="shimmer-emerald text-base font-bold leading-tight">PharmaSync</p>
          <p className="text-xs text-muted-foreground">
            {profile?.facility ?? "Klinik Kesihatan Kempas"}
          </p>
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