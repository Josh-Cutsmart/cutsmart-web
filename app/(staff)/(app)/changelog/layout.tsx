import type { Metadata } from "next";

// The Changelog's tab title: "Changelog · CutSmart" (app/layout.tsx's template).
export const metadata: Metadata = {
  title: "Changelog",
};

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
