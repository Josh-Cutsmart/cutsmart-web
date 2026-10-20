"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { CircleCheck, KeyRound, LinkIcon } from "lucide-react";
import "./login-screen.css";
import { DotField } from "@/components/login/dot-field";
import { LOGIN_HANDOFF_EMAIL_KEY, LOGIN_HANDOFF_FORGOT_KEY, PasswordField } from "@/components/login/login-screen";
import { auth } from "@/lib/firebase";

// The page a password reset email links to ("/reset-password?oobCode=…" — app/api/auth/password-reset), in the login
// screen's own card: the link is checked (Firebase's one-time code, an hour), then a new password, twice. Done: back to
// log in with their email filled in. A link that's old or already used: a way to ask for a new one. The code is taken out
// of the address bar as soon as it's read, so it isn't left in the browser's history.

type ResetState = "checking" | "form" | "done" | "invalid";

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
}

function handOffToLogin(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // storage unavailable — the login screen just opens as usual
  }
}

export function ResetPasswordScreen() {
  const router = useRouter();
  const [state, setState] = useState<ResetState>("checking");
  const [resetCode, setResetCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const code = new URLSearchParams(window.location.search).get("oobCode") || "";
      if (!code || !auth) {
        if (!cancelled) setState("invalid");
        return;
      }
      let accountEmail = "";
      try {
        accountEmail = await verifyPasswordResetCode(auth, code);
      } catch {
        accountEmail = "";
      }
      if (cancelled) return;
      // (Once the page has settled — the app's router keeps its own state on the history entry.)
      window.history.replaceState(window.history.state, "", window.location.pathname);
      if (!accountEmail) {
        setState("invalid");
        return;
      }
      setResetCode(code);
      setEmail(accountEmail);
      setState("form");
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    if (!auth || !resetCode) return;
    setBusy(true);
    try {
      await confirmPasswordReset(auth, resetCode, password);
      setPassword("");
      setConfirm("");
      setState("done");
    } catch (err) {
      const code = errorCode(err);
      if (code === "auth/expired-action-code" || code === "auth/invalid-action-code") setState("invalid");
      else if (code === "auth/weak-password") setError("Use a longer password — at least 6 characters.");
      else setError("Couldn't change your password. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const goToLogin = () => {
    if (email) handOffToLogin(LOGIN_HANDOFF_EMAIL_KEY, email);
    router.replace("/");
  };
  const askForNewLink = () => {
    handOffToLogin(LOGIN_HANDOFF_FORGOT_KEY, "1");
    router.replace("/");
  };

  return (
    <div className="lg-root">
      <div className="lg-blob" style={{ width: 520, height: 520, background: "#8cc2ff", top: -160, left: -140 }} />
      <div className="lg-blob" style={{ width: 440, height: 440, background: "#c9c2ff", bottom: -160, right: -100 }} />
      <div className="lg-blob" style={{ width: 360, height: 360, background: "#a6ece2", bottom: 40, left: "32%" }} />
      <DotField className="lg-dots-canvas" />
      <main className="lg-main">
        <section className="lg-card" aria-label="Reset your CutSmart password">
          <Image src="/icon-192.png" alt="CutSmart" width={68} height={68} className="lg-logo" priority />
          {state === "checking" ? (
            <>
              <h1 className="lg-title">Reset your password</h1>
              <p className="lg-subtitle">Checking your link…</p>
              <div className="lg-spinner" role="status" aria-label="Loading" />
            </>
          ) : state === "form" ? (
            <form onSubmit={(event) => void onSubmit(event)} noValidate>
              <div className="lg-icon-badge">
                <KeyRound size={24} />
              </div>
              <h1 className="lg-title">Set a new password</h1>
              <p className="lg-subtitle">
                For <b>{email}</b>
              </p>
              {/* For password managers: the account this password belongs to. */}
              <input type="email" value={email} autoComplete="username" readOnly hidden />
              <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 6 characters" />
              <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Type it again" />
              {error ? (
                <p className="lg-error" role="alert">
                  {error}
                </p>
              ) : null}
              <button type="submit" className="lg-primary" disabled={busy}>
                {busy ? "Saving…" : "Save new password"}
              </button>
            </form>
          ) : state === "done" ? (
            <>
              <div className="lg-icon-badge">
                <CircleCheck size={26} />
              </div>
              <h1 className="lg-title">Password changed</h1>
              <p className="lg-subtitle">You can log in with your new password now.</p>
              <button type="button" className="lg-primary" onClick={goToLogin}>
                Log in
              </button>
            </>
          ) : (
            <>
              <div className="lg-icon-badge">
                <LinkIcon size={24} />
              </div>
              <h1 className="lg-title">This link has expired</h1>
              <p className="lg-subtitle">Reset links work for an hour, and only once. Ask for a new one and use the latest email.</p>
              <button type="button" className="lg-primary" onClick={askForNewLink}>
                Send a new link
              </button>
              <button type="button" className="lg-link" onClick={() => router.replace("/")}>
                Back to log in
              </button>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
