import type { Metadata } from "next";

// Reports's tab title: "Reports · CutSmart" (app/layout.tsx's template).
export const metadata: Metadata = {
  title: "Reports",
};

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
