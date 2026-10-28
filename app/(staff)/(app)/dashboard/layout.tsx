import type { Metadata } from "next";

// The Dashboard's tab title: "Dashboard · CutSmart" (app/layout.tsx's template).
export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
