import { Home, Pill, PackagePlus, FileText, Bell, Users, Stethoscope, ShieldCheck, UserCog, BarChart2, ClipboardList, Archive, Baby, ShieldAlert, Warehouse, Building2, Megaphone, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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

type NavGroup = {
  label: string;
  items: NavItem[];
};

// Grouped to match the Stitch "Modern Clinical" nav pattern used across the
// redesigned pages (Logistik HQ, Patient Registry, Clinics): section labels
// collapse away with the rail, item order within a group is unchanged from
// before.
const navGroups: NavGroup[] = [
  {
    label: "Operations & Core",
    items: [
      { title: "Dashboard",     url: "/",           icon: Home,        roles: ["admin", "pharmacist"] },
      { title: "Logistik HQ",   url: "/logistik",   icon: Warehouse,   roles: ["logistic_pharmacist"] },
      { title: "FMS Dashboard", url: "/fms",         icon: BarChart2,   showBadge: true, roles: ["admin", "fms"] },
      { title: "MO Dashboard",  url: "/mo",          icon: Stethoscope, roles: ["admin", "mo"] },
      { title: "Dispensing",    url: "/fulfilment",  icon: Bell,        showBadge: true, roles: ["admin", "fms", "pharmacist"] },
      { title: "Rx Dashboard",  url: "/specialist",  icon: ShieldCheck, showBadge: true, roles: ["admin", "fms", "pharmacist"] },
    ],
  },
  {
    label: "Inventory & Records",
    items: [
      { title: "Drug Master", url: "/drugs",    icon: Pill,          roles: ["admin", "fms", "pharmacist", "logistic_pharmacist"] },
      { title: "Terimaan",    url: "/terimaan", icon: PackagePlus,   roles: ["admin", "fms"] },
      { title: "Patients",    url: "/pesakit",  icon: Users,         roles: ["admin", "fms", "pharmacist", "logistic_pharmacist"] },
      { title: "Reports",     url: "/laporan",  icon: FileText,      roles: ["admin", "fms", "pharmacist"] },
      { title: "Request",     url: "/request",  icon: ClipboardList, roles: ["admin", "fms", "mo"] },
    ],
  },
  {
    label: "Specialized Protocols",
    items: [
      { title: "Paeds Dose",  url: "/dos-paediatrik", icon: Baby,        roles: ["admin", "fms", "mo", "pharmacist"] },
      { title: "G6PD",        url: "/g6pd",           icon: ShieldAlert, roles: ["admin", "fms", "mo", "pharmacist"] },
      { title: "Abx Archive", url: "/abx-archive",    icon: Archive,     roles: ["admin", "fms", "pharmacist"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Role Management", url: "/role-management", icon: UserCog, showBadge: true, roles: ["admin"] },
      // Empty roles: the filter below admits super_admin unconditionally, so
      // this is how a super_admin-only entry is spelled — matching /clinics'
      // ROUTE_PERMISSIONS entry, which is super_admin only too.
      { title: "Clinics", url: "/clinics", icon: Building2, roles: [] },
      { title: "Settings", url: "/settings", icon: Megaphone, roles: ["admin"] },
    ],
  },
];

export function AppSidebar() {
  const { state, isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const { role, profile } = useAuth();
  const collapsed = state === "collapsed";

  // Whose data the user is actually looking at. Was hardcoded to one clinic,
  // which is a lie at every other clinic and at HQ. super_admin has clinic_id
  // NULL by design and does span every clinic, so they get a label rather than
  // a blank. Matches TopNavbar.
  const scopeLabel = role === "super_admin" ? "All clinics" : profile?.clinic_name;

  // On phones the sidebar is a Sheet overlaying the page, and nothing was
  // closing it on navigation — so tapping a nav item left the drawer sitting on
  // top of the page it had just opened. Handled here rather than inside NavLink,
  // which is generic and would then require sidebar context everywhere it is
  // used.
  const closeOnNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };

  // Filter within each group, then drop groups nothing survived in — an empty
  // "Administration" header with no rows under it would just be noise.
  const visibleGroups = role
    ? navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => role === "super_admin" || item.roles.includes(role)),
        }))
        .filter((group) => group.items.length > 0)
    : [];

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
  const canSeeApprovals = role === "admin" || role === "fms" || role === "pharmacist" || role === "super_admin";

  const { data: specialistBadge = 0 } = useQuery({
    queryKey: ["pending-specialist-badge-count"],
    enabled: canSeeApprovals,
    refetchInterval: 15000,
    queryFn: async () => {
      const [{ count: drugCount, error: drugError }, { data: abData, error: abError }] =
        await Promise.all([
          supabase
            .from("dispensing_requests")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending_specialist"),
          supabase
            .from("antibiotic_forms")
            .select("id")
            .eq("status", "pending_specialist"),
        ]);
      if (drugError && abError) return 0;
      return (drugCount ?? 0) + (abData?.length ?? 0);
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
            <span className="shimmer-emerald-on-dark text-base font-bold">PharmaSync</span>
            {scopeLabel && (
              <>
                <br />
                <span className="text-xs font-normal text-sidebar-foreground/70">{scopeLabel}</span>
              </>
            )}
          </span>
        )}
      </div>

      <SidebarContent>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild tooltip={item.title}>
                      <NavLink
                        to={item.url}
                        end={item.url === "/"}
                        onClick={closeOnNavigate}
                        className="border-l-2 border-transparent hover:bg-sidebar-accent"
                        activeClassName="border-sidebar-ring bg-sidebar-accent text-sidebar-accent-foreground font-medium"
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
        ))}
      </SidebarContent>

      {/* Explicit hide/show affordance on the sidebar itself, in addition to
          the TopNavbar trigger and the Cmd/Ctrl+B shortcut — the rail alone
          (a 4px hover strip) is too easy to miss. */}
      <SidebarFooter>
        <SidebarMenuButton
          onClick={toggleSidebar}
          tooltip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="justify-center text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && <span className="ml-2">Collapse</span>}
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
