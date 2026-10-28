import type { Metadata } from "next";

// Small Jobs's tab title: "Small Jobs · CutSmart" (app/layout.tsx's template).
export const metadata: Metadata = {
  title: "Small Jobs",
};

export default function SmallJobsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
