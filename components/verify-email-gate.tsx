"use client";

import { useEffect, useState } from "react";
import { MailCheck, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAppTabs } from "@/lib/app-tabs-context";
import { useAccountVerification } from "@/lib/use-account-verification";

// Full-screen gate — replaces the entire app (no sidebar, no nav, nothing) whenever a signed-in
// user's account isn't verified yet. Mounted in app/(app)/layout.tsx (ahead of AppShell/children)
// and at the top of app/company-onboarding/page.tsx, since those are the only two places an
// authenticated user can land — a fresh registration goes to company-onboarding directly, an
// existing unverified account logging back in goes to the (app) group. Unlike VerifyAccountModal
// (a dismissable popup for an already-unlocked, view-only session), this one has no close button:
// the only way past it is a correct code, or logging out to use a different account.
export function VerifyEmailGate() {
  const { user, logout } = useAuth();
  const { setChromeHidden } = useAppTabs();
  const { code, setCode, error, busy, resendCooldown, onSend, onConfirm } = useAccountVerification();
  // Sending is always an explicit tap now, never a side effect of this gate merely mounting — a
  // slow/ambiguous membership load used to be able to mount this component for an already-verified
  // user (see the callers' own membershipStatus guard), and the old auto-send effect turned that
  // UI glitch into a real, unwanted "we sent you a code" email. The registration/company-creation
  // flows already trigger their own first send on a genuine fresh signup, so this gate never needs
  // to assume one is already on its way.
  const [hasRequestedCode, setHasRequestedCode] = useState(false);

  // GlobalAppTabsBar (rendered by the root layout, above this component) only knows to hide
  // itself on the pre-app "/" and "/company-onboarding" routes by pathname — it has no idea this
  // gate is covering an otherwise-normal (app) route instead of AppShell, so it'd otherwise keep
  // showing the tab bar right over this full-screen takeover. `chromeHidden` is the same shared
  // signal the fullscreen project views already use for exactly this purpose.
  useEffect(() => {
    setChromeHidden(true);
    return () => setChromeHidden(false);
  }, [setChromeHidden]);

  return (
    <div
      className="flex min-h-[100svh] items-center justify-center px-4 py-8"
      style={{
        backgroundImage: "url('/bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div
        className="w-[min(440px,96vw)] rounded-[18px] border p-6 backdrop-blur-[10px]"
        style={{
          borderColor: "rgba(255,255,255,0.45)",
          backgroundColor: "rgba(255,255,255,0.58)",
          boxShadow: "0 18px 50px rgba(15,23,42,0.10)",
        }}
      >
        <div className="flex flex-col items-center text-center">
          <div
            className="inline-flex h-14 w-14 items-center justify-center rounded-full"
            style={{ backgroundColor: "rgba(47,107,255,0.12)", color: "#2F6BFF" }}
          >
            <MailCheck size={26} />
          </div>
          <h1 className="mt-4 text-[20px] font-extrabold text-[#0F172A]">
            Verify your email
          </h1>
          <p className="mt-2 text-[13px] text-[#475467]">
            {hasRequestedCode ? (
              <>We&apos;ve sent a 6-digit code to <span className="font-semibold text-[#0F172A]">{user?.email || "your email"}</span></>
            ) : (
              <>Confirm <span className="font-semibold text-[#0F172A]">{user?.email || "your email"}</span> to continue — we&apos;ll send you a 6-digit code.</>
            )}
          </p>
        </div>

        {hasRequestedCode ? (
          <div className="mt-6 space-y-3">
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onConfirm();
                }
              }}
              placeholder="6-digit code"
              inputMode="numeric"
              className="h-12 w-full rounded-[10px] border border-[#D8DEE8] bg-white/80 px-4 text-center text-[18px] font-bold tracking-[6px] text-[#0F172A] outline-none"
            />
            {error ? <p className="text-[12px] font-semibold text-[#B42318]">{error}</p> : null}
            <button
              type="button"
              disabled={busy || code.trim().length !== 6}
              onClick={() => void onConfirm()}
              className="h-11 w-full rounded-[10px] bg-[#2F6BFF] text-[13px] font-bold text-white hover:brightness-95 disabled:opacity-55"
            >
              {busy ? "Verifying..." : "Verify"}
            </button>
            <button
              type="button"
              disabled={busy || resendCooldown > 0}
              onClick={() => void onSend()}
              className="h-11 w-full rounded-[10px] border border-[#D8DEE8] bg-white/60 text-[13px] font-bold text-[#334155] hover:brightness-95 disabled:opacity-55"
            >
              {resendCooldown > 0 ? `Resend Code (${resendCooldown}s)` : "Resend Code"}
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {error ? <p className="text-[12px] font-semibold text-[#B42318]">{error}</p> : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setHasRequestedCode(true);
                void onSend();
              }}
              className="h-11 w-full rounded-[10px] bg-[#2F6BFF] text-[13px] font-bold text-white hover:brightness-95 disabled:opacity-55"
            >
              {busy ? "Sending..." : "Send Code"}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => void logout()}
          className="mx-auto mt-5 flex items-center gap-1.5 text-[12px] font-semibold text-[#667085] hover:underline"
        >
          <LogOut size={13} />
          Not you? Log out
        </button>
      </div>
    </div>
  );
}
