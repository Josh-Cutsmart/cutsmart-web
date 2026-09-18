"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/");
    }
  }, [isLoading, router, user]);

  // Also covers the one-frame gap between isLoading flipping false and this component's own
  // redirect effect above actually firing (effects run after render/commit) — a real, if brief,
  // "nothing renders" window that used to return null here. A redirect is already inbound in that
  // case, so keep showing the spinner instead of a blank page for that frame.
  if (isLoading || !user) {
    return (
      <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4">
        <p className="text-sm font-semibold text-[var(--text-muted)]">Loading...</p>
        <div
          className="h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--glass-border)] border-t-[var(--brand-strong)]"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  return <>{children}</>;
}
