import type { Metadata } from "next";

// Company Settings's tab title: "Company Settings · CutSmart" (app/layout.tsx's template).
export const metadata: Metadata = {
  title: "Company Settings",
};

export default function CompanySettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
