import type { Metadata } from "next";

// The Archive's tab title: "Archive · CutSmart" (app/layout.tsx's template).
export const metadata: Metadata = {
  title: "Archive",
};

export default function ArchiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
