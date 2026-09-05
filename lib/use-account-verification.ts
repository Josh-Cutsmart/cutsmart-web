"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";

// Shared send/confirm/cooldown logic for the "enter your emailed account-verification code" flow
// — used by both the popup version (VerifyAccountModal) and the full-screen gate (VerifyEmailGate)
// so the two surfaces can't drift out of sync on retry/cooldown/error-message behavior.
export function useAccountVerification(onVerified?: () => void) {
  const { setUserVerifiedLocal } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownTimerRef = useRef<number | null>(null);

  const startCooldown = (seconds: number) => {
    if (cooldownTimerRef.current) window.clearInterval(cooldownTimerRef.current);
    setResendCooldown(seconds);
    cooldownTimerRef.current = window.setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) window.clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) window.clearInterval(cooldownTimerRef.current);
    };
  }, []);

  const onSend = async () => {
    if (busy || resendCooldown > 0 || !auth) return;
    setBusy(true);
    setError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        setError("Not signed in.");
        return;
      }
      const res = await fetch("/api/verify/user/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; retryAfterSeconds?: number };
      if (!data.ok) {
        if (data.error === "cooldown" && data.retryAfterSeconds) {
          startCooldown(data.retryAfterSeconds);
        } else {
          setError(data.error || "Could not send verification code.");
        }
        return;
      }
      startCooldown(30);
    } catch {
      setError("Could not send verification code.");
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    const trimmed = code.trim();
    if (!trimmed || busy || !auth) return;
    setBusy(true);
    setError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        setError("Not signed in.");
        return;
      }
      const res = await fetch("/api/verify/user/confirm", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!data.ok) {
        setError(
          data.error === "invalid-code"
            ? "Incorrect code."
            : data.error === "expired"
              ? "Code expired — resend a new one."
              : data.error === "too-many-attempts"
                ? "Too many attempts — resend a new code."
                : data.error || "Could not verify your account.",
        );
        return;
      }
      setUserVerifiedLocal(true);
      setCode("");
      onVerified?.();
    } catch {
      setError("Could not verify your account.");
    } finally {
      setBusy(false);
    }
  };

  return { code, setCode, error, setError, busy, resendCooldown, onSend, onConfirm };
}
