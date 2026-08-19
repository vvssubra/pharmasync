// src/pages/LogistikDashboard.tsx
//
// Placeholder for the logistic_pharmacist HQ dashboard. Task 10 replaces this
// with the real page (national quota pool view, master patient registry,
// etc.) — routing, role gating, and the sidebar entry are already wired to
// this path by Task 8, so Task 10 only needs to fill in the component body.
import { Warehouse } from "lucide-react";

export default function LogistikDashboard() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
      <Warehouse className="h-8 w-8" />
      <p className="text-lg font-medium text-foreground">Logistik HQ Dashboard — coming soon</p>
      <p className="text-sm">This page will surface the national controlled-drug quota pool and master patient registry.</p>
    </div>
  );
}
