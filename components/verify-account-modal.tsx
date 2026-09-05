"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MailCheck, X } from "lucide-react";
import { useAccountVerification } from "@/lib/use-account-verification";
import { useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

// Shared "enter your emailed account-verification code" popup — reused by the sidebar user
// settings panel (opened via its own "Unverified" pill) and by the app shell's own auto-prompt
// (opened automatically right after a fresh sign-in/registration while still unverified). The
// send/confirm/cooldown logic itself lives in useAccountVerification so it can't drift out of
// sync with the full-screen VerifyEmailGate, which uses the same hook.
export function VerifyAccountModal({
  open,
  origin,
  onClose,
}: {
  open: boolean;
  origin?: GlassModalOrigin;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = useGlassModalPopOrigin(open, origin ?? null, panelRef);
  const { code, setCode, error, setError, busy, resendCooldown, onSend, onConfirm } = useAccountVerification(onClose);

  useEffect(() => {
    if (open) {
      setCode("");
      setError("");
    }
  }, [open, setCode, setError]);

  if (!shouldRender || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center px-4 py-4" style={{ zIndex: 2147483647 }}>
      <button
        type="button"
        aria-label="Close verify account dialog backdrop"
        onClick={onClose}
        className="absolute inset-0 glass-modal-backdrop"
      />
      <div ref={panelRef} className="glass-modal-panel relative w-[min(420px,96vw)] overflow-hidden" style={{ zIndex: 2147483647 }}>
        <div className="glass-modal-header flex items-center justify-between gap-2 px-5 py-4">
          <p className="flex items-center gap-1.5 text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "#000000" }}>
            <MailCheck size={15} />
            Verify Account
          </p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] hover:brightness-95"
            style={{ color: "#000000" }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-[12px]" style={{ color: "#000000" }}>
            Enter the code emailed to you to unlock editing anywhere in the app.
          </p>
          <div className="flex flex-wrap items-center gap-2">
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
              className="h-10 w-[140px] rounded-[10px] border px-3 text-[13px] tracking-[2px] outline-none"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
            />
            <button
              type="button"
              disabled={busy || code.trim().length !== 6}
              onClick={() => void onConfirm()}
              className="h-10 rounded-[10px] px-4 text-[12px] font-bold text-white hover:brightness-95 disabled:opacity-55"
              style={{ backgroundImage: "var(--brand-gradient)" }}
            >
              Verify
            </button>
            <button
              type="button"
              disabled={busy || resendCooldown > 0}
              onClick={() => void onSend()}
              className="h-10 rounded-[10px] border px-4 text-[12px] font-bold hover:brightness-95 disabled:opacity-55"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
            >
              {resendCooldown > 0 ? `Resend (${resendCooldown}s)` : "Resend Code"}
            </button>
          </div>
          {error ? <p className="text-[12px] font-semibold" style={{ color: "var(--danger-strong)" }}>{error}</p> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
