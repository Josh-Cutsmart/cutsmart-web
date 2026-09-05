"use client";

import { ProtectedRoute } from "@/components/protected-route";
import { AppShell } from "@/components/app-shell";
import { VerifyEmailGate } from "@/components/verify-email-gate";
import { useAuth } from "@/lib/auth-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // A signed-in but unverified account never reaches the actual app — no sidebar, no nav, nothing
  // — until the code is confirmed. `!user` (still loading/not signed in) falls through to
  // ProtectedRoute's own redirect-to-login handling, unaffected by this gate.
  if (user && !user.verified) {
    return (
      <ProtectedRoute>
        <VerifyEmailGate />
      </ProtectedRoute>
    );
  }
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}
