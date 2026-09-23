"use client";

import { ProtectedRoute } from "@/components/protected-route";
import { AppShell } from "@/components/app-shell";
import { VerifyEmailGate } from "@/components/verify-email-gate";
import { useAuth } from "@/lib/auth-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, membershipStatus } = useAuth();
  // A signed-in but unverified account never reaches the actual app — no sidebar, no nav, nothing
  // — until the code is confirmed. `!user` (still loading/not signed in) falls through to
  // ProtectedRoute's own redirect-to-login handling, unaffected by this gate.
  //
  // membershipStatus === "ready" matters as much as user.verified === false here — a slow/failed
  // membership load leaves user.verified as an UNKNOWN (not a confirmed false; see auth-context's
  // own comment on its error fallback), and without this guard an already-verified user hitting
  // that fallback got shown this full-screen gate purely from fetch latency, not real account
  // state — the reported "phantom verification prompt."
  if (user && membershipStatus === "ready" && user.verified === false) {
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
