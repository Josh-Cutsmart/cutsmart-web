import type { Metadata } from "next";

// User Settings's tab title: "User Settings · CutSmart" (app/layout.tsx's template).
export const metadata: Metadata = {
  title: "User Settings",
};

export default function UserSettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
