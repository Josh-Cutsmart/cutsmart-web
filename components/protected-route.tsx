"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { keepPinUnlocked, usePinLocked } from "@/lib/device-pin";

// Where a signed-out visitor was headed, so signing in takes them back there (read by the login page).
// e.g. a home-screen "Calendar" icon opening /calendar in a fresh, signed-out web app.
export const AFTER_LOGIN_PATH_KEY = "cutsmart_after_login_path";

// How often an open app tells the PIN lock it's still in use (lib/device-pin.ts).
const PIN_KEEPALIVE_MS = 60_000;

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  // A device that remembers the account by its PIN sends it to the login screen for the PIN first.
  const pinLocked = usePinLocked(user?.uid);

  useEffect(() => {
    if (!isLoading && (!user || pinLocked)) {
      try {
        const path = `${window.location.pathname}${window.location.search}`;
        if (path !== "/") window.sessionStorage.setItem(AFTER_LOGIN_PATH_KEY, path);
      } catch {
        // storage unavailable — they'll land on the dashboard instead
      }
      router.replace("/");
    }
  }, [isLoading, pinLocked, router, user]);

  useEffect(() => {
    const uid = String(user?.uid || "");
    if (!uid || pinLocked) return;
    keepPinUnlocked(uid);
    const timer = window.setInterval(() => keepPinUnlocked(uid), PIN_KEEPALIVE_MS);
    return () => window.clearInterval(timer);
  }, [pinLocked, user?.uid]);

  // Also covers the one-frame gap between isLoading flipping false and this component's own
  // redirect effect above actually firing (effects run after render/commit) — a real, if brief,
  // "nothing renders" window that used to return null here. A redirect is already inbound in that
  // case, so keep showing the spinner instead of a blank page for that frame.
  if (isLoading || !user || pinLocked) {
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
