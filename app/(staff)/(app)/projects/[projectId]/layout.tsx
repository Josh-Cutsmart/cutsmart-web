import type { Metadata } from "next";

// A project's tab title until it's loaded — then its name (the page's useDocumentTitle): "Smith Kitchen · CutSmart".
export const metadata: Metadata = {
  title: "Project",
};

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
