import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { TopNavbar } from "@/components/TopNavbar";
import AiChatWidget from "@/components/AiChatWidget";
import { AI_ENABLED } from "@/lib/featureFlags";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-dvh flex w-full">
        <AppSidebar />
        {/* min-w-0 is load-bearing: without it this flex item keeps the default
            min-width:auto, so a wide table's min-content width expands the whole
            content column past the viewport and the *body* scrolls sideways
            instead of the table scrolling inside its own overflow wrapper
            (ui/table.tsx). Do not remove. */}
        <div className="flex-1 flex flex-col min-w-0">
          <TopNavbar />
          <main className="flex-1 overflow-auto p-4 sm:p-6">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
      {AI_ENABLED && <AiChatWidget />}
    </SidebarProvider>
  );
}
