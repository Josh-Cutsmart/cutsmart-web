"use client";

import { createUserWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { auth, hasFirebaseConfig } from "@/lib/firebase";
import { saveUserProfilePatchDetailed } from "@/lib/firestore-data";
import { resolveCompanyIdForUid } from "@/lib/membership";
import { useAuth } from "@/lib/auth-context";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

export default function HomePage() {
  const router = useRouter();
  const { signIn, signInDemo, setUserColorLocal } = useAuth();
  const [hoveredSide, setHoveredSide] = useState<"login" | "register" | null>(null);
  const [lockedPreview, setLockedPreview] = useState<"login" | "register" | null>(null);
  const [loginFieldsVisible, setLoginFieldsVisible] = useState(false);
  const [registerFieldsVisible, setRegisterFieldsVisible] = useState(false);
  const [loginFormMounted, setLoginFormMounted] = useState(false);
  const [registerFormMounted, setRegisterFormMounted] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerMobile, setRegisterMobile] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const [registerUserColor, setRegisterUserColor] = useState("#2F6BFF");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegisterSubmitting, setIsRegisterSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerColorInputEl, setRegisterColorInputEl] = useState<HTMLInputElement | null>(null);
  const registerPasswordTimerRef = useRef<number | null>(null);
  const loginHideTimerRef = useRef<number | null>(null);
  const registerHideTimerRef = useRef<number | null>(null);
  const [loginFormFocused, setLoginFormFocused] = useState(false);
  const [registerFormFocused, setRegisterFormFocused] = useState(false);
  const loginFormRef = useRef<HTMLFormElement | null>(null);
  const registerFormRef = useRef<HTMLFormElement | null>(null);

  const loginBasis = hoveredSide === "login" ? "60%" : hoveredSide === "register" ? "40%" : "50%";
  const registerBasis = hoveredSide === "register" ? "60%" : hoveredSide === "login" ? "40%" : "50%";
  const showLoginForm = hoveredSide === "login" && lockedPreview !== "login";
  const showRegisterForm = hoveredSide === "register" && lockedPreview !== "register";

  const onCloseLogin = () => {
    setLockedPreview("login");
    setHoveredSide(null);
    setLoginFormFocused(false);
    setLoginFieldsVisible(false);
    setError(null);
    setIsSubmitting(false);
  };

  const onCloseRegister = () => {
    setLockedPreview("register");
    setHoveredSide(null);
    setRegisterFormFocused(false);
    setRegisterFieldsVisible(false);
    setShowRegisterPassword(false);
    setRegisterError(null);
    setIsRegisterSubmitting(false);
  };

  const toggleRegisterPasswordFor10s = () => {
    if (showRegisterPassword) {
      setShowRegisterPassword(false);
      if (registerPasswordTimerRef.current) {
        window.clearTimeout(registerPasswordTimerRef.current);
        registerPasswordTimerRef.current = null;
      }
      return;
    }
    setShowRegisterPassword(true);
    if (registerPasswordTimerRef.current) window.clearTimeout(registerPasswordTimerRef.current);
    registerPasswordTimerRef.current = window.setTimeout(() => setShowRegisterPassword(false), 10000);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (hasFirebaseConfig) {
        await signIn(email, password);
        const currentUid = String(auth?.currentUser?.uid || "").trim();
        if (currentUid) {
          const preferredCompanyId =
            typeof window !== "undefined"
              ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
              : "";
          const companyId = await resolveCompanyIdForUid(
            currentUid,
            preferredCompanyId ? [preferredCompanyId] : [],
          );
          if (!companyId) {
            router.push("/company-onboarding");
            return;
          }
          if (typeof window !== "undefined") {
            window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
          }
        }
      } else {
        signInDemo("owner");
      }
      router.push("/dashboard");
    } catch {
      setError("Could not sign in. Check email and password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onRegisterSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setRegisterError(null);
    if (registerPassword !== registerConfirmPassword) {
      setRegisterError("Passwords do not match.");
      return;
    }
    setIsRegisterSubmitting(true);
    try {
      if (hasFirebaseConfig && auth) {
        const created = await createUserWithEmailAndPassword(auth, registerEmail, registerPassword);
        const uid = String(created.user?.uid || "").trim();
        if (uid) {
          const fallbackName = String(registerEmail || "")
            .split("@")[0]
            ?.replace(/[._-]+/g, " ")
            .trim();
          await saveUserProfilePatchDetailed(uid, "", {
            email: String(registerEmail || "").trim(),
            mobile: String(registerMobile || "").trim(),
            userColor: String(registerUserColor || "").trim(),
            displayName: fallbackName || "CutSmart User",
          });
        }
        const preferredCompanyId =
          typeof window !== "undefined"
            ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
            : "";
        const companyId = uid
          ? await resolveCompanyIdForUid(uid, preferredCompanyId ? [preferredCompanyId] : [])
          : "";
        if (!companyId) {
          router.push("/company-onboarding");
          return;
        }
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
        }
      } else {
        signInDemo("owner");
        setUserColorLocal(String(registerUserColor || "").trim());
      }
      router.push("/dashboard");
    } catch {
      setRegisterError("Could not register. Check email/password and try again.");
    } finally {
      setIsRegisterSubmitting(false);
    }
  };

  const formatMobile = (raw: string): string => {
    const digits = String(raw || "").replace(/\D+/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  };

  useEffect(() => {
    if (loginHideTimerRef.current) {
      window.clearTimeout(loginHideTimerRef.current);
      loginHideTimerRef.current = null;
    }
    if (!showLoginForm) {
      setLoginFieldsVisible(false);
      loginHideTimerRef.current = window.setTimeout(() => {
        setLoginFormMounted(false);
        loginHideTimerRef.current = null;
      }, 430);
      return;
    }
    setLoginFormMounted(true);
    const timeout = window.setTimeout(() => setLoginFieldsVisible(true), 30);
    return () => window.clearTimeout(timeout);
  }, [showLoginForm]);

  useEffect(() => {
    if (registerHideTimerRef.current) {
      window.clearTimeout(registerHideTimerRef.current);
      registerHideTimerRef.current = null;
    }
    if (!showRegisterForm) {
      setRegisterFieldsVisible(false);
      registerHideTimerRef.current = window.setTimeout(() => {
        setRegisterFormMounted(false);
        registerHideTimerRef.current = null;
      }, 430);
      return;
    }
    setRegisterFormMounted(true);
    const timeout = window.setTimeout(() => setRegisterFieldsVisible(true), 30);
    return () => window.clearTimeout(timeout);
  }, [showRegisterForm]);

  useEffect(() => {
    return () => {
      if (registerPasswordTimerRef.current) window.clearTimeout(registerPasswordTimerRef.current);
      if (loginHideTimerRef.current) window.clearTimeout(loginHideTimerRef.current);
      if (registerHideTimerRef.current) window.clearTimeout(registerHideTimerRef.current);
    };
  }, []);
  const safeRegisterColor = /^#[0-9A-Fa-f]{6}$/.test(registerUserColor) ? registerUserColor : "#2F6BFF";
  const registerColorText =
    parseInt(safeRegisterColor.slice(1, 3), 16) * 0.299 +
      parseInt(safeRegisterColor.slice(3, 5), 16) * 0.587 +
      parseInt(safeRegisterColor.slice(5, 7), 16) * 0.114 >
    160
      ? "#111827"
      : "#FFFFFF";

  return (
    <div
      className="relative flex min-h-screen flex-row overflow-hidden"
      style={{
        backgroundImage: "url('/bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onMouseEnter={() => setHoveredSide("login")}
        onMouseLeave={() => {
          if (showLoginForm && loginFormFocused) return;
          setHoveredSide(null);
          setLockedPreview(null);
        }}
        className="group relative z-10 flex min-h-screen shrink-0 overflow-hidden border-r border-[rgba(215,222,232,0.55)] hover:bg-[rgba(47,107,255,0.50)]"
        style={{
          backgroundColor: "rgba(47,107,255,0.30)",
          flex: `0 0 ${loginBasis}`,
          transition: "flex-basis 900ms cubic-bezier(0.22,1,0.36,1), background-color 300ms ease",
        }}
      >
        <div className="absolute inset-0 z-20 flex items-center justify-center px-8">
          {!loginFormMounted ? (
            <span
              className="whitespace-nowrap text-center uppercase text-[#0F274A] transition-all"
              style={{
                fontSize: "clamp(26px, 3.2vw, 46px)",
                lineHeight: 0.95,
                fontWeight: 600,
              }}
            >
              LOG IN
            </span>
          ) : (
            <form
              ref={loginFormRef}
              onClick={(e) => e.stopPropagation()}
              onFocusCapture={() => setLoginFormFocused(true)}
              onBlurCapture={() => {
                window.setTimeout(() => {
                  const active = document.activeElement as Node | null;
                  setLoginFormFocused(!!(active && loginFormRef.current?.contains(active)));
                }, 0);
              }}
              onSubmit={onSubmit}
              className="max-w-none"
              style={{ width: "min(550px, calc(100vw - 120px))" }}
            >
              <p
                className="whitespace-nowrap text-center uppercase text-[#0F274A] transition-all"
                style={{
                  fontSize: "clamp(26px, 3.2vw, 46px)",
                  lineHeight: 0.95,
                  fontWeight: 600,
                  marginBottom: loginFieldsVisible ? 18 : 0,
                  transform: loginFieldsVisible ? "translateY(-10px)" : "translateY(0)",
                  transition: "transform 380ms ease, margin-bottom 380ms ease",
                }}
              >
                LOG IN
              </p>

              <div
                className="grid grid-cols-1 gap-3"
                style={{
                  opacity: loginFieldsVisible ? 1 : 0,
                  transform: loginFieldsVisible ? "translateX(0)" : "translateX(-28px)",
                  maxHeight: loginFieldsVisible ? "420px" : "0px",
                  overflow: "hidden",
                  transition: "opacity 420ms ease, transform 420ms ease, max-height 420ms ease",
                }}
              >
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required={hasFirebaseConfig}
                  className="h-[50px] w-full min-w-0 rounded-[12px] border border-[#D7DEE8] bg-white px-5 text-[15px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={hasFirebaseConfig}
                  className="h-[50px] w-full min-w-0 rounded-[12px] border border-[#D7DEE8] bg-white px-5 text-[15px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                />
                {error && <p className="text-[12px] font-semibold text-[#D32F2F]">{error}</p>}
                <div className="grid grid-cols-1 gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="h-[50px] w-full rounded-[12px] border border-[#2F6BFF] bg-[#2F6BFF] text-[14px] font-bold text-white disabled:opacity-60"
                  >
                    {isSubmitting ? "Signing..." : "Sign In"}
                  </button>
                  <button
                    type="button"
                    onClick={onCloseLogin}
                    className="h-[50px] w-full rounded-[12px] border border-[#D7DEE8] bg-white text-[14px] font-bold text-[#334155]"
                  >
                    Back
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        onMouseEnter={() => setHoveredSide("register")}
        onMouseLeave={() => {
          if (showRegisterForm && registerFormFocused) return;
          setHoveredSide(null);
          setLockedPreview(null);
        }}
        className="group relative z-10 flex min-h-screen shrink-0 items-center justify-center overflow-hidden hover:bg-[rgba(255,255,255,0.50)]"
        style={{
          backgroundColor: "rgba(255,255,255,0.42)",
          flex: `0 0 ${registerBasis}`,
          transition: "flex-basis 900ms cubic-bezier(0.22,1,0.36,1), background-color 300ms ease, opacity 220ms ease",
        }}
      >
        <div className="absolute inset-0 z-20 flex items-center justify-center px-8">
          {!registerFormMounted ? (
            <span
              className="text-center uppercase text-[#111827] transition-all"
              style={{
                fontSize: "clamp(26px, 3.2vw, 46px)",
                lineHeight: 0.95,
                fontWeight: 600,
              }}
            >
              REGISTER
            </span>
          ) : (
            <form
              ref={registerFormRef}
              onClick={(e) => e.stopPropagation()}
              onFocusCapture={() => setRegisterFormFocused(true)}
              onBlurCapture={() => {
                window.setTimeout(() => {
                  const active = document.activeElement as Node | null;
                  setRegisterFormFocused(!!(active && registerFormRef.current?.contains(active)));
                }, 0);
              }}
              onSubmit={onRegisterSubmit}
              className="max-w-none"
              style={{ width: "min(550px, calc(100vw - 120px))" }}
            >
              <p
                className="text-center uppercase text-[#111827] transition-all"
                style={{
                  fontSize: "clamp(26px, 3.2vw, 46px)",
                  lineHeight: 0.95,
                  fontWeight: 600,
                  marginBottom: registerFieldsVisible ? 18 : 0,
                  transform: registerFieldsVisible ? "translateY(-10px)" : "translateY(0)",
                  transition: "transform 380ms ease, margin-bottom 380ms ease",
                }}
              >
                REGISTER
              </p>

              <div
                className="grid grid-cols-1 gap-3"
                style={{
                  opacity: registerFieldsVisible ? 1 : 0,
                  transform: registerFieldsVisible ? "translateX(0)" : "translateX(28px)",
                  maxHeight: registerFieldsVisible ? "520px" : "0px",
                  overflow: "hidden",
                  transition: "opacity 420ms ease, transform 420ms ease, max-height 420ms ease",
                }}
              >
                <input
                  type="email"
                  placeholder="Email"
                  value={registerEmail}
                  onChange={(e) => setRegisterEmail(e.target.value)}
                  required={hasFirebaseConfig}
                  className="h-[50px] w-full min-w-0 rounded-[12px] border border-[#D7DEE8] bg-white px-5 text-[15px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                />
                <input
                  type="text"
                  placeholder="Mobile"
                  value={registerMobile}
                  onChange={(e) => setRegisterMobile(formatMobile(e.target.value))}
                  className="h-[50px] w-full min-w-0 rounded-[12px] border border-[#D7DEE8] bg-white px-5 text-[15px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                />
                <div className="relative">
                  <input
                    type={showRegisterPassword ? "text" : "password"}
                    placeholder="Password"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    required={hasFirebaseConfig}
                    className="h-[50px] w-full min-w-0 rounded-[12px] border border-[#D7DEE8] bg-white px-5 pr-16 text-[15px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                  />
                  <button
                    type="button"
                    onClick={toggleRegisterPasswordFor10s}
                    className="absolute right-2 top-1/2 z-20 h-7 min-w-[52px] -translate-y-1/2 cursor-pointer rounded-[8px] border border-[#CBD5E1] bg-white px-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[#6B7280] shadow-sm"
                  >
                    {showRegisterPassword ? "HIDE" : "SHOW"}
                  </button>
                </div>
                <input
                  type="password"
                  placeholder="Confirm Password"
                  value={registerConfirmPassword}
                  onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                  required={hasFirebaseConfig}
                  className="h-[50px] w-full min-w-0 rounded-[12px] border border-[#D7DEE8] bg-white px-5 text-[15px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                />
                <div
                  className="flex h-[50px] items-center justify-between gap-3 rounded-[12px] border border-[#D7DEE8] px-5"
                  style={{ backgroundColor: safeRegisterColor }}
                  onClick={() => registerColorInputEl?.click()}
                >
                  <p className="whitespace-nowrap text-[15px] font-semibold" style={{ color: registerColorText }}>
                    Icon Colour Picker
                  </p>
                  <input
                    ref={setRegisterColorInputEl}
                    type="color"
                    value={safeRegisterColor}
                    onChange={(e) => setRegisterUserColor(e.target.value)}
                    className="pointer-events-none absolute h-0 w-0 opacity-0"
                    title="Choose Icon Colour"
                  />
                </div>
                {registerError && <p className="text-[12px] font-semibold text-[#D32F2F]">{registerError}</p>}
                <div className="grid grid-cols-1 gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={isRegisterSubmitting}
                    className="h-[50px] w-full rounded-[12px] border border-[#2F6BFF] bg-[#2F6BFF] text-[14px] font-bold text-white disabled:opacity-60"
                  >
                    {isRegisterSubmitting ? "Registering..." : "Register"}
                  </button>
                  <button
                    type="button"
                    onClick={onCloseRegister}
                    className="h-[50px] w-full rounded-[12px] border border-[#D7DEE8] bg-white text-[14px] font-bold text-[#334155]"
                  >
                    Back
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

