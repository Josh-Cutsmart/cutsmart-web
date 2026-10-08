"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Building2, ChevronRight, Eye, EyeOff, LogOut, Mail, MailCheck, Sparkles, Users } from "lucide-react";
import "./login-screen.css";
import { DotField } from "@/components/login/dot-field";
import { FeatureSlider } from "@/components/login/feature-slider";
import { AFTER_LOGIN_PATH_KEY } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import {
  ACTIVE_COMPANY_STORAGE_KEY,
  acceptCompanyInvite,
  createCompany,
  declineCompanyInvite,
  joinCompanyWithCode,
  loadCompanyInvites,
  type CompanyInvite,
} from "@/lib/company-onboarding";
import {
  PIN_LENGTH,
  accountHasPin,
  checkPin,
  forgetPinLock,
  markPinUnlocked,
  readPinLock,
  recordWrongPin,
  rememberWithPin,
  savePin,
  usePinLocked,
} from "@/lib/device-pin";
import { auth, hasFirebaseConfig } from "@/lib/firebase";
import { saveUserProfilePatchDetailed } from "@/lib/firestore-data";
import { hedgedAsync } from "@/lib/load-retry";
import { resolveCompanyIdForUid } from "@/lib/membership";
import { enterPreview, exitPreview, isPreviewMode } from "@/lib/preview-mode";
import { parseUpdateNotesText } from "@/lib/update-notes-utils";
import { useAccountVerification } from "@/lib/use-account-verification";

// The login screen ("/"): one card that walks through logging in or registering, then whatever the
// account still needs — its PIN, verifying its email, joining or creating a company — before opening
// the app. Each step slides in from the side. On desktop the feature slider sits beside it; on phones
// the card is the whole screen. Someone already signed in (Remember me, or a PIN — lib/device-pin.ts)
// goes straight through to their company.

type Step = "checking" | "login" | "register" | "pin-unlock" | "pin-setup" | "verify" | "company" | "join" | "create" | "opening";

// The order steps come in — going to a later one slides forward, an earlier one slides back.
const STEP_ORDER: Step[] = ["checking", "login", "register", "pin-unlock", "pin-setup", "verify", "company", "join", "create", "opening"];

const REMEMBER_DEVICE_STORAGE_KEY = "cutsmart_web_remember_device";
const DEFAULT_REGISTER_USER_COLOR = "#2F6BFF";
// How long a step takes to slide out (login-screen.css) before it's removed.
const STEP_LEAVE_MS = 360;

// After signing in: back to the page they were sent here from (see ProtectedRoute), else the dashboard.
function takeAfterLoginPath(): string {
  try {
    const path = window.sessionStorage.getItem(AFTER_LOGIN_PATH_KEY) || "";
    window.sessionStorage.removeItem(AFTER_LOGIN_PATH_KEY);
    return path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

function readRememberChoice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(REMEMBER_DEVICE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function formatMobile(raw: string): string {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

function nameFromEmail(email: string): string {
  return String(email || "")
    .split("@")[0]
    ?.replace(/[._-]+/g, " ")
    .trim();
}

function registerErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "auth/email-already-in-use") return "That email already has an account. Log in instead.";
  if (code === "auth/invalid-email") return "That email address doesn't look right.";
  if (code === "auth/weak-password") return "Use a longer password — at least 6 characters.";
  return "Couldn't create your account. Try again.";
}

// The card's steps, sliding in and out. The step leaving stays on screen (behind) while it slides away.
function StepSlider({ step, render }: { step: Step; render: (step: Step) => ReactNode }) {
  const [shown, setShown] = useState<{ current: Step; previous: Step | null; dir: "forward" | "back" | null; id: number }>({
    current: step,
    previous: null,
    dir: null,
    id: 0,
  });
  if (shown.current !== step) {
    const dir = STEP_ORDER.indexOf(step) >= STEP_ORDER.indexOf(shown.current) ? "forward" : "back";
    setShown({ current: step, previous: shown.current, dir, id: shown.id + 1 });
  }
  const currentRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  // The card grows or shrinks to the step coming in.
  useEffect(() => {
    const el = currentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown.id]);

  // The step that slid out is removed once it's gone.
  useEffect(() => {
    if (!shown.previous) return;
    const id = shown.id;
    const timer = window.setTimeout(() => {
      setShown((prev) => (prev.id === id ? { ...prev, previous: null } : prev));
    }, STEP_LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [shown.id, shown.previous]);

  return (
    <div className="lg-steps" style={height !== null && shown.previous ? { height } : undefined}>
      {shown.previous ? (
        <div key={`step-${shown.id - 1}`} className="lg-step" data-dir={shown.dir ?? undefined} data-leaving="" aria-hidden="true">
          {render(shown.previous)}
        </div>
      ) : null}
      <div key={`step-${shown.id}`} ref={currentRef} className="lg-step" data-dir={shown.dir ?? undefined}>
        {render(shown.current)}
      </div>
    </div>
  );
}

function PinInput({
  value,
  onChange,
  onComplete,
  shake,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  shake: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="lg-pin" data-shake={shake ? "" : undefined}>
      {Array.from({ length: PIN_LENGTH }, (_, index) => (
        <div key={index} className="lg-pin-box" data-current={index === value.length ? "" : undefined}>
          {value[index] ? "•" : ""}
        </div>
      ))}
      <input
        className="lg-pin-input"
        value={value}
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
          onChange(next);
          if (next.length === PIN_LENGTH) onComplete(next);
        }}
      />
    </div>
  );
}

// Tells browsers and password managers to leave a field alone — no saved logins or addresses filled in.
const NO_AUTOFILL = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  companyCode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  // A company code, not a password: a plain text box with its letters hidden, so the browser doesn't
  // fill in (or offer to save) the person's own login.
  companyCode?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="lg-field">
      <span>{label}</span>
      <div className="lg-input-wrap">
        {companyCode ? (
          <input
            className="lg-input"
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            style={{ WebkitTextSecurity: visible ? "none" : "disc" } as CSSProperties}
            {...NO_AUTOFILL}
          />
        ) : (
          <input
            className="lg-input"
            type={visible ? "text" : "password"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoComplete={autoComplete}
            placeholder={placeholder}
          />
        )}
        <button type="button" className="lg-reveal" onClick={() => setVisible((v) => !v)} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </label>
  );
}

export function LoginScreen() {
  const router = useRouter();
  const { user, isLoading, membershipStatus, signIn, signInDemo, register, logout, retryMembershipLoad } = useAuth();
  const pinLocked = usePinLocked(user?.uid);

  const [signedOutView, setSignedOutView] = useState<"login" | "register">("login");
  const [companyView, setCompanyView] = useState<"company" | "join" | "create">("company");
  const [pinSetupPending, setPinSetupPending] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
  const [noCompany, setNoCompany] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(readRememberChoice);
  const [regEmail, setRegEmail] = useState("");
  const [regMobile, setRegMobile] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");

  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [shake, setShake] = useState(false);

  const [codeRequested, setCodeRequested] = useState(false);
  const verification = useAccountVerification();

  const [invites, setInvites] = useState<CompanyInvite[]>([]);
  const [inviteError, setInviteError] = useState("");
  const [busyInviteId, setBusyInviteId] = useState("");
  const [confirmDeclineId, setConfirmDeclineId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [companyCodeConfirm, setCompanyCodeConfirm] = useState("");

  let step: Step;
  if (!hasFirebaseConfig) step = signedOutView;
  else if (isLoading) step = "checking";
  else if (!user) step = signedOutView;
  else if (pinLocked) step = "pin-unlock";
  else if (pinSetupPending) step = "pin-setup";
  else if (membershipStatus === "loading") step = "opening";
  else if (membershipStatus === "ready" && user.verified === false) step = "verify";
  else if (noCompany && !leaving) step = companyView;
  else step = "opening";
  const isCompanyStep = step === "company" || step === "join" || step === "create";

  // Back here from CutSmart Preview: leave it (a fresh page load, so the real database is used again).
  useEffect(() => {
    if (isPreviewMode()) exitPreview();
  }, []);

  // Signed in with nothing left to do: open their company, or ask them to join or create one.
  useEffect(() => {
    if (step !== "opening" || !hasFirebaseConfig || !user?.uid || leaving || membershipStatus === "loading") return;
    let cancelled = false;
    const open = async () => {
      let preferred = "";
      try {
        preferred = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
      } catch {
        // storage unavailable
      }
      let companyId = String(user.companyId || "").trim();
      let lookupFailed = false;
      if (!companyId) {
        try {
          companyId = await hedgedAsync(() => resolveCompanyIdForUid(user.uid, preferred ? [preferred] : []), {
            delayMs: 350,
            message: "Company lookup timed out",
          });
        } catch {
          lookupFailed = true;
        }
      }
      if (cancelled) return;
      if (companyId) {
        try {
          window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
        } catch {
          // storage unavailable
        }
        router.replace(takeAfterLoginPath());
        return;
      }
      // Couldn't tell (a network hiccup): the app does its own retried lookup, which beats a stuck screen.
      if (lookupFailed) {
        router.replace(takeAfterLoginPath());
        return;
      }
      setNoCompany(true);
    };
    void open();
    return () => {
      cancelled = true;
    };
  }, [leaving, membershipStatus, router, step, user?.companyId, user?.uid]);

  // Invites to companies, shown on the company step.
  useEffect(() => {
    if (!isCompanyStep || !user?.email) return;
    let cancelled = false;
    void loadCompanyInvites(user.email).then((result) => {
      if (cancelled) return;
      setInvites(result.invites);
      setInviteError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [isCompanyStep, user?.email]);

  const goTo = (next: () => void) => {
    setError("");
    next();
  };

  const shakePin = (message: string) => {
    setError(message);
    setPin("");
    setShake(true);
    window.setTimeout(() => setShake(false), 420);
  };

  const resetAfterSignOut = (prefillEmail = "") => {
    setSignedOutView("login");
    setCompanyView("company");
    setPinSetupPending(false);
    setJustRegistered(false);
    setNoCompany(false);
    setLeaving(false);
    setBusy(false);
    setPin("");
    setFirstPin("");
    setCodeRequested(false);
    setInvites([]);
    if (prefillEmail) setEmail(prefillEmail);
    setPassword("");
  };

  const onLogOut = async (message = "", prefillEmail = "") => {
    forgetPinLock();
    try {
      await logout();
    } finally {
      resetAfterSignOut(prefillEmail);
      setError(message);
    }
  };

  const onLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!hasFirebaseConfig) {
      signInDemo("owner");
      router.push("/dashboard");
      return;
    }
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      await signIn(cleanEmail, password, remember);
      const uid = String(auth?.currentUser?.uid || "");
      // Without Remember me, a PIN still keeps them signed in on this device — behind the PIN.
      if (!remember && uid && (await accountHasPin(uid))) {
        await rememberWithPin({ uid, email: cleanEmail, name: nameFromEmail(cleanEmail) });
      }
      setPassword("");
      // Stays "busy" while the account loads; the card moves on by itself.
    } catch {
      setBusy(false);
      setError("That email and password don't match. Try again.");
    }
  };

  const onRegister = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const cleanEmail = regEmail.trim();
    if (!cleanEmail) {
      setError("Enter your email address.");
      return;
    }
    if (regPassword.length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }
    if (regPassword !== regConfirm) {
      setError("The passwords don't match.");
      return;
    }
    if (!hasFirebaseConfig) {
      signInDemo("owner");
      router.push("/dashboard");
      return;
    }
    setBusy(true);
    // The app's current version (public/release-notes.txt), fetched while the account is being created.
    // A new account starts with it already marked as seen: What's New is for people who used the app
    // before an update, so new users only get it from the next update on.
    const currentVersionPromise = fetch("/release-notes.txt", { cache: "no-store" })
      .then((res) => (res.ok ? res.text() : ""))
      .then((raw) => parseUpdateNotesText(raw).version.trim())
      .catch(() => "");
    // Set first, so the PIN step is next the moment the new account is signed in.
    setPinSetupPending(true);
    setJustRegistered(true);
    try {
      const uid = await register(cleanEmail, regPassword);
      if (uid) {
        const currentVersion = await currentVersionPromise;
        await saveUserProfilePatchDetailed(uid, "", {
          email: cleanEmail,
          mobile: regMobile.trim(),
          userColor: DEFAULT_REGISTER_USER_COLOR,
          displayName: nameFromEmail(cleanEmail) || "CutSmart User",
          ...(currentVersion ? { updateNoticeSeenVersions: [currentVersion] } : {}),
        });
      }
      setRegPassword("");
      setRegConfirm("");
    } catch (err) {
      setPinSetupPending(false);
      setJustRegistered(false);
      setError(registerErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Leaving the PIN step (set or skipped): a new account's verification email goes out now.
  const finishPinSetup = () => {
    setPin("");
    setFirstPin("");
    setPinSetupPending(false);
    if (justRegistered) {
      setCodeRequested(true);
      void verification.onSend();
    }
  };

  const onPinSetupEntered = async (value: string) => {
    if (!firstPin) {
      setFirstPin(value);
      setPin("");
      setError("");
      return;
    }
    if (value !== firstPin) {
      setFirstPin("");
      shakePin("Those PINs didn't match. Start again.");
      return;
    }
    const uid = String(user?.uid || "");
    if (!uid) return;
    setBusy(true);
    try {
      await savePin(uid, value);
      await rememberWithPin({ uid, email: String(user?.email || ""), name: String(user?.displayName || "") });
      setBusy(false);
      setError("");
      finishPinSetup();
    } catch {
      setBusy(false);
      setFirstPin("");
      shakePin("Couldn't save your PIN. Try again.");
    }
  };

  const onPinUnlockEntered = async (value: string) => {
    const uid = String(user?.uid || "");
    if (!uid) return;
    setBusy(true);
    let ok = false;
    try {
      ok = await checkPin(uid, value);
    } catch {
      setBusy(false);
      shakePin("Couldn't check your PIN. Check your connection and try again.");
      return;
    }
    setBusy(false);
    if (ok) {
      setPin("");
      setError("");
      markPinUnlocked(uid);
      return;
    }
    const left = recordWrongPin();
    if (left <= 0) {
      await onLogOut("Too many wrong tries. Log in with your password.", readPinLock()?.email || String(user?.email || ""));
      return;
    }
    shakePin(`That PIN isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`);
  };

  const onJoin = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.uid) return;
    if (!joinCode.trim()) {
      setError("Enter your company code.");
      return;
    }
    setBusy(true);
    setError("");
    const message = await joinCompanyWithCode(user, joinCode);
    if (message) {
      setBusy(false);
      setError(message);
      return;
    }
    openJoinedCompany();
  };

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.uid) return;
    if (!companyName.trim()) {
      setError("Enter a company name.");
      return;
    }
    if (!companyCode.trim()) {
      setError("Pick a company code.");
      return;
    }
    if (companyCode.trim() !== companyCodeConfirm.trim()) {
      setError("The codes don't match.");
      return;
    }
    setBusy(true);
    setError("");
    const message = await createCompany(user, companyName, companyCode);
    if (message) {
      setBusy(false);
      setError(message);
      return;
    }
    openJoinedCompany();
  };

  const onAcceptInvite = async (invite: CompanyInvite) => {
    if (!user?.uid) return;
    setBusyInviteId(invite.id);
    setError("");
    const message = await acceptCompanyInvite(user, invite);
    setBusyInviteId("");
    if (message) {
      setError(message);
      return;
    }
    openJoinedCompany();
  };

  const onDeclineInvite = async (invite: CompanyInvite) => {
    if (confirmDeclineId !== invite.id) {
      setConfirmDeclineId(invite.id);
      return;
    }
    setBusyInviteId(invite.id);
    setError("");
    const message = await declineCompanyInvite(invite);
    setBusyInviteId("");
    setConfirmDeclineId("");
    if (message) {
      setError(message);
      return;
    }
    setInvites((prev) => prev.filter((row) => !(row.companyId === invite.companyId && row.id === invite.id)));
  };

  // Joined or created: the account now has a company, so straight into it.
  const openJoinedCompany = () => {
    setLeaving(true);
    setBusy(false);
    retryMembershipLoad();
    router.push(takeAfterLoginPath());
  };

  const title = (text: string, sub: ReactNode) => (
    <>
      <h1 className="lg-title">{text}</h1>
      <p className="lg-subtitle">{sub}</p>
    </>
  );

  const errorLine = error ? (
    <p className="lg-error" role="alert">
      {error}
    </p>
  ) : null;

  const renderStep = (current: Step): ReactNode => {
    switch (current) {
      case "checking":
        return (
          <>
            {title("CutSmart", "Checking saved sign-in…")}
            <div className="lg-spinner" role="status" aria-label="Loading" />
          </>
        );
      case "opening":
        return (
          <>
            {title("You're in", leaving ? "Opening your company…" : "Opening your workspace…")}
            <div className="lg-spinner" role="status" aria-label="Loading" />
          </>
        );
      case "login":
        return (
          <form onSubmit={(event) => void onLogin(event)} noValidate>
            {title("Welcome back", "Log in to CutSmart")}
            <label className="lg-field">
              <span>Email</span>
              <input
                className="lg-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="you@company.co.nz"
              />
            </label>
            <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="Your password" />
            <label className="lg-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => {
                  setRemember(event.target.checked);
                  try {
                    window.localStorage.setItem(REMEMBER_DEVICE_STORAGE_KEY, event.target.checked ? "1" : "0");
                  } catch {
                    // storage unavailable
                  }
                }}
              />
              Remember me on this device
            </label>
            {errorLine}
            <button type="submit" className="lg-primary" disabled={busy}>
              {busy ? "Logging in…" : "Log in"}
            </button>
          </form>
        );
      case "register":
        return (
          <form onSubmit={(event) => void onRegister(event)} noValidate>
            {title("Create your account", "Start using CutSmart with your team")}
            <label className="lg-field">
              <span>Email</span>
              <input
                className="lg-input"
                type="email"
                value={regEmail}
                onChange={(event) => setRegEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@company.co.nz"
              />
            </label>
            <label className="lg-field">
              <span>Mobile</span>
              <input
                className="lg-input"
                type="tel"
                value={regMobile}
                onChange={(event) => setRegMobile(formatMobile(event.target.value))}
                autoComplete="tel"
                placeholder="021 123 4567"
              />
            </label>
            <PasswordField label="Password" value={regPassword} onChange={setRegPassword} autoComplete="new-password" placeholder="At least 6 characters" />
            <PasswordField label="Confirm password" value={regConfirm} onChange={setRegConfirm} autoComplete="new-password" placeholder="Type it again" />
            {errorLine}
            <button type="submit" className="lg-primary" disabled={busy}>
              {busy ? "Creating your account…" : "Create account"}
            </button>
          </form>
        );
      case "pin-setup":
        return (
          <>
            {title(firstPin ? "Enter it again" : "Set a PIN", firstPin ? "Type the same 4 digits to confirm." : "Get back in quickly with 4 digits instead of your password.")}
            <PinInput
              key={firstPin ? "confirm" : "first"}
              value={pin}
              onChange={(value) => {
                setPin(value);
                if (error) setError("");
              }}
              onComplete={(value) => void onPinSetupEntered(value)}
              shake={shake}
              disabled={busy}
              label={firstPin ? "Confirm your PIN" : "Choose a PIN"}
            />
            {errorLine}
            <p className="lg-note">This device will remember you and ask for your PIN when you come back.</p>
            <button type="button" className="lg-link" onClick={() => goTo(finishPinSetup)} disabled={busy}>
              Skip for now
            </button>
          </>
        );
      case "pin-unlock": {
        const lock = readPinLock();
        return (
          <>
            {title("Welcome back", lock?.email || user?.email || "Enter your PIN")}
            <PinInput
              value={pin}
              onChange={(value) => {
                setPin(value);
                if (error) setError("");
              }}
              onComplete={(value) => void onPinUnlockEntered(value)}
              shake={shake}
              disabled={busy}
              label="Your PIN"
            />
            {errorLine}
            <button
              type="button"
              className="lg-link"
              onClick={() => void onLogOut("", lock?.email || String(user?.email || ""))}
              disabled={busy}
            >
              Use your password instead
            </button>
          </>
        );
      }
      case "verify":
        return (
          <>
            <div className="lg-icon-badge">
              <MailCheck size={26} />
            </div>
            {title(
              "Verify your email",
              codeRequested ? (
                <>
                  We&apos;ve sent a 6-digit code to <b>{user?.email}</b>
                </>
              ) : (
                <>
                  We&apos;ll send a 6-digit code to <b>{user?.email}</b>
                </>
              ),
            )}
            {codeRequested ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void verification.onConfirm();
                }}
              >
                <input
                  className="lg-input lg-code"
                  style={{ marginTop: 18 }}
                  value={verification.code}
                  onChange={(event) => verification.setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="••••••"
                  aria-label="Verification code"
                />
                {verification.error ? <p className="lg-error">{verification.error}</p> : null}
                <button type="submit" className="lg-primary" disabled={verification.busy || verification.code.trim().length !== 6}>
                  {verification.busy ? "Checking…" : "Verify"}
                </button>
                <button
                  type="button"
                  className="lg-secondary"
                  disabled={verification.busy || verification.resendCooldown > 0}
                  onClick={() => void verification.onSend()}
                >
                  {verification.resendCooldown > 0 ? `Send a new code (${verification.resendCooldown}s)` : "Send a new code"}
                </button>
              </form>
            ) : (
              <>
                {verification.error ? <p className="lg-error">{verification.error}</p> : null}
                <button
                  type="button"
                  className="lg-primary"
                  disabled={verification.busy}
                  onClick={() => {
                    setCodeRequested(true);
                    void verification.onSend();
                  }}
                >
                  <Mail size={17} />
                  {verification.busy ? "Sending…" : "Send code"}
                </button>
              </>
            )}
            <button type="button" className="lg-link" onClick={() => void onLogOut()}>
              <LogOut size={14} />
              Not you? Log out
            </button>
          </>
        );
      case "company":
        return (
          <>
            {title("Set up your workspace", "Join your team or start a new company")}
            {invites.map((invite) => (
              <div key={`${invite.companyId}:${invite.id}`} className="lg-invite">
                <p>
                  <Mail size={15} style={{ color: "var(--brand)" }} />
                  {invite.companyName} invited you
                </p>
                <div className="lg-invite-actions">
                  <button
                    type="button"
                    disabled={Boolean(busyInviteId)}
                    onClick={() => void onAcceptInvite(invite)}
                    style={{ border: 0, color: "#fff", backgroundImage: "var(--brand-gradient)" }}
                  >
                    {busyInviteId === invite.id && confirmDeclineId !== invite.id ? "Joining…" : "Accept"}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyInviteId)}
                    onClick={() => void onDeclineInvite(invite)}
                    style={{
                      border: "1px solid var(--lg-field-border)",
                      background: "var(--lg-field-bg)",
                      color: confirmDeclineId === invite.id ? "var(--danger)" : "var(--text-main)",
                    }}
                  >
                    {confirmDeclineId === invite.id ? "Decline invite?" : "Decline"}
                  </button>
                </div>
              </div>
            ))}
            {inviteError && !invites.length ? <p className="lg-note">{inviteError}</p> : null}
            <button type="button" className="lg-option" onClick={() => goTo(() => setCompanyView("join"))}>
              <span className="lg-option-icon" style={{ background: "var(--lg-blue-bg)", color: "var(--lg-blue-fg)" }}>
                <Users size={19} />
              </span>
              <span style={{ flex: 1 }}>
                <b>Join a company</b>
                <small>Use the code from your admin</small>
              </span>
              <ChevronRight size={18} style={{ color: "var(--text-muted)" }} />
            </button>
            <button type="button" className="lg-option" onClick={() => goTo(() => setCompanyView("create"))}>
              <span className="lg-option-icon" style={{ background: "var(--lg-purple-bg)", color: "var(--lg-purple-fg)" }}>
                <Building2 size={19} />
              </span>
              <span style={{ flex: 1 }}>
                <b>Create a company</b>
                <small>Start fresh — you&apos;ll be the owner</small>
              </span>
              <ChevronRight size={18} style={{ color: "var(--text-muted)" }} />
            </button>
            {errorLine}
            <button type="button" className="lg-link" onClick={() => void onLogOut()}>
              <LogOut size={14} />
              Log out
            </button>
          </>
        );
      case "join":
        return (
          <form onSubmit={(event) => void onJoin(event)} noValidate autoComplete="off">
            {title("Join a company", "Enter the code your admin gave you")}
            <PasswordField label="Company code" value={joinCode} onChange={setJoinCode} placeholder="The code from your admin" companyCode />
            {errorLine}
            <button type="submit" className="lg-primary" disabled={busy}>
              {busy ? "Joining…" : "Join company"}
            </button>
            <button type="button" className="lg-link" onClick={() => goTo(() => setCompanyView("company"))}>
              <ArrowLeft size={14} />
              Back
            </button>
          </form>
        );
      case "create":
        return (
          <form onSubmit={(event) => void onCreate(event)} noValidate autoComplete="off">
            {title("Create a company", "Your team joins with the code you set")}
            <label className="lg-field">
              <span>Company name</span>
              <input
                className="lg-input"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                {...NO_AUTOFILL}
                placeholder="Your company's name"
              />
            </label>
            <PasswordField label="Company code" value={companyCode} onChange={setCompanyCode} placeholder="Choose a code" companyCode />
            <PasswordField label="Confirm code" value={companyCodeConfirm} onChange={setCompanyCodeConfirm} placeholder="Type the code again" companyCode />
            {errorLine}
            <button type="submit" className="lg-primary" disabled={busy}>
              {busy ? "Creating…" : "Create company"}
            </button>
            <button type="button" className="lg-link" onClick={() => goTo(() => setCompanyView("company"))}>
              <ArrowLeft size={14} />
              Back
            </button>
          </form>
        );
    }
  };

  const showSwitch = step === "login" || step === "register";

  return (
    <div className="lg-root">
      <div className="lg-blob" style={{ width: 520, height: 520, background: "#8cc2ff", top: -160, left: -140 }} />
      <div className="lg-blob" style={{ width: 440, height: 440, background: "#c9c2ff", bottom: -160, right: -100 }} />
      <div className="lg-blob" style={{ width: 360, height: 360, background: "#a6ece2", bottom: 40, left: "32%" }} />
      <DotField className="lg-dots-canvas" />

      <main className="lg-main">
        <FeatureSlider />
        <section className="lg-card" aria-label="Log in to CutSmart">
          <Image src="/icon-192.png" alt="CutSmart" width={68} height={68} className="lg-logo" priority />
          <div
            style={{
              display: "grid",
              gridTemplateRows: showSwitch ? "1fr" : "0fr",
              opacity: showSwitch ? 1 : 0,
              transition: "grid-template-rows 0.35s ease, opacity 0.25s ease",
            }}
          >
            <div style={{ overflow: "hidden" }}>
              <div className="lg-switch" data-side={signedOutView} style={{ marginTop: 6, marginBottom: 18 }}>
                <button
                  type="button"
                  aria-pressed={signedOutView === "login"}
                  tabIndex={showSwitch ? 0 : -1}
                  onClick={() => goTo(() => setSignedOutView("login"))}
                >
                  Log in
                </button>
                <button
                  type="button"
                  aria-pressed={signedOutView === "register"}
                  tabIndex={showSwitch ? 0 : -1}
                  onClick={() => goTo(() => setSignedOutView("register"))}
                >
                  Register
                </button>
              </div>
            </div>
          </div>
          <StepSlider step={step} render={renderStep} />
        </section>
      </main>

      {step === "login" || step === "register" || step === "checking" ? (
        <button type="button" className="lg-preview" onClick={enterPreview}>
          <span className="lg-preview-icon">
            <Sparkles size={17} />
          </span>
          <span style={{ minWidth: 0, textAlign: "left" }}>
            <b>Try the CutSmart Preview</b>
            <small>Explore a demo company — no account needed</small>
          </span>
        </button>
      ) : null}
    </div>
  );
}
