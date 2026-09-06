// Plain passthrough — deliberately no ProtectedRoute/AppShell. Everything under app/client/... is
// public, no-login content (see app/client/specs/[shareId]/page.tsx); those only live inside the
// (app) route group's own layout (app/(app)/layout.tsx), which this sibling segment never passes
// through.
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
