import { Home, Pill, PackagePlus, FileText, Bell, Users, Stethoscope, ShieldCheck, UserCog, BarChart2, ClipboardList, Archive } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";

type NavItem = {
  title: string;
  url: string;
  icon: React.ElementType;
  showBadge?: boolean;
  roles: AppRole[];
};

const items: NavItem[] = [
  { title: "Dashboard",       url: "/",                   icon: Home,          roles: ["admin", "pharmacist"] },
  { title: "FMS Dashboard",   url: "/fms",                icon: BarChart2,     showBadge: true, roles: ["admin", "fms", "pharmacist"] },
  { title: "MO Dashboard",    url: "/mo",                 icon: Stethoscope,   roles: ["admin", "mo", "pharmacist"] },
  { title: "New Requests",    url: "/fulfilment",         icon: Bell,          showBadge: true, roles: ["admin", "fms", "pharmacist"] },
  { title: "Approvals",       url: "/specialist",         icon: ShieldCheck,   showBadge: true, roles: ["admin", "fms"] },
  { title: "Drug Master",     url: "/drugs",              icon: Pill,          roles: ["admin", "fms", "pharmacist"] },
  { title: "Terimaan",        url: "/terimaan",           icon: PackagePlus,   roles: ["admin", "fms", "pharmacist"] },
  { title: "Patients",        url: "/pesakit",            icon: Users,         roles: ["admin", "fms", "pharmacist"] },
  { title: "Reports",         url: "/laporan",            icon: FileText,      roles: ["admin", "fms", "pharmacist"] },
  { title: "Drug Request",    url: "/request/ubat",       icon: ClipboardList, roles: ["admin", "mo", "pharmacist"] },
  { title: "Antibiotic Form", url: "/request/antibiotik", icon: Pill,          roles: ["admin", "mo", "pharmacist"] },
  { title: "Arkib Antibiotik", url: "/arkib-antibiotik",   icon: Archive,       roles: ["admin", "fms", "pharmacist"] },
  { title: "Role Management", url: "/role-management",    icon: UserCog,       showBadge: true, roles: ["admin"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { role } = useAuth();
  const collapsed = state === "collapsed";

  const visibleItems = role ? items.filter((item) => role === "super_admin" || item.roles.includes(role)) : [];

  const canSeeFulfilment = role === "admin" || role === "fms" || role === "pharmacist" || role === "super_admin";

  // Pending ubat kawalan count (for pharmacist fulfilment queue)
  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["pending-requests-count"],
    enabled: canSeeFulfilment,
    refetchInterval: 15000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("dispensing_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_pharmacy");
      if (error) return 0;
      return count ?? 0;
    },
  });

  // Pending specialist approval count (drug requests + antibiotic forms awaiting FMS)
  const { data: specialistBadge = 0 } = useQuery({
    queryKey: ["pending-specialist-badge-count"],
    enabled: role === "admin" || role === "fms" || role === "super_admin",
    refetchInterval: 15000,
    queryFn: async () => {
      const [{ count: drugCount, error: drugError }, { data: abData, error: abError }] =
        await Promise.all([
          supabase
            .from("dispensing_requests")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending_specialist"),
          supabase
            .from("antibiotic_forms" as any)
            .select("id")
            .eq("status", "pending_specialist"),
        ]);
      if (drugError && abError) return 0;
      return (drugCount ?? 0) + ((abData as any[])?.length ?? 0);
    },
  });

  // Unassigned user count (admins need to assign a role to new signups, and
  // approve the ones with no clinic — super_admin does both too)
  const { data: unassignedCount = 0 } = useQuery({
    queryKey: ["unassigned-user-count"],
    enabled: role === "admin" || role === "super_admin",
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_unassigned_user_count");
      if (error) return 0;
      return data ?? 0;
    },
  });

  const badgeByUrl: Record<string, number> = {
    "/fulfilment": pendingCount,
    // FMS act on the same queue from both pages, so both carry the count.
    "/fms": specialistBadge,
    "/specialist": specialistBadge,
    "/role-management": unassignedCount,
  };

  return (
    <Sidebar collapsible="icon">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary/20">
          <Pill className="h-4 w-4 text-sidebar-primary" />
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold tracking-tight leading-tight">
            <span className="shimmer-emerald-on-dark text-base font-bold">PharmaSync</span><br />
            <span className="text-xs font-normal text-sidebar-foreground/70">KK Kempas</span>
          </span>
        )}
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="ml-2 truncate">{item.title}</span>}
                      {item.showBadge && (badgeByUrl[item.url] ?? 0) > 0 && (
                        <Badge
                          variant="destructive"
                          className="ml-auto h-5 min-w-5 text-[10px] flex items-center justify-center rounded-full px-1.5"
                        >
                          {badgeByUrl[item.url]}
                        </Badge>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
