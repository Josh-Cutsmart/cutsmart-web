import type { Metadata } from "next";

// Company Wrapped's tab title: "Company Wrapped · CutSmart" (app/layout.tsx's template).
export const metadata: Metadata = {
  title: "Company Wrapped",
};

export default function WrappedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
