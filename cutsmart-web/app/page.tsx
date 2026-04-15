"use client";

import { createUserWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { auth, hasFirebaseConfig } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

export default function HomePage() {
  const router = useRouter();
  const { signIn, signInDemo } = useAuth();
  const [hoveredSide, setHoveredSide] = useState<"login" | "register" | null>(null);
  const [activePanel, setActivePanel] = useState<"login" | "register" | null>(null);
  const [isClosingLogin, setIsClosingLogin] = useState(false);
  const [isClosingRegister, setIsClosingRegister] = useState(false);
  const [loginFieldsVisible, setLoginFieldsVisible] = useState(false);
  const [registerFieldsVisible, setRegisterFieldsVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegisterSubmitting, setIsRegisterSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const closeTransitionTimerRef = useRef<number | null>(null);

  const loginTransition = activePanel === "login";
  const registerTransition = activePanel === "register";

  const loginBasis = loginTransition
    ? "100%"
    : registerTransition
      ? "0%"
    : hoveredSide === "login"
      ? "60%"
      : hoveredSide === "register"
        ? "40%"
        : "50%";

  const registerBasis = registerTransition
    ? "100%"
    : loginTransition
      ? "0%"
    : hoveredSide === "register"
      ? "60%"
      : hoveredSide === "login"
        ? "40%"
        : "50%";

  const onOpenLogin = () => {
    setHoveredSide(null);
    setIsClosingLogin(false);
    setIsClosingRegister(false);
    if (closeTransitionTimerRef.current) {
      window.clearTimeout(closeTransitionTimerRef.current);
      closeTransitionTimerRef.current = null;
    }
    window.setTimeout(() => setActivePanel("login"), 0);
  };

  const onCloseLogin = () => {
    setIsClosingLogin(true);
    setLoginFieldsVisible(false);
    setActivePanel(null);
    setHoveredSide(null);
    setError(null);
    setIsSubmitting(false);
    if (closeTransitionTimerRef.current) {
      window.clearTimeout(closeTransitionTimerRef.current);
    }
    closeTransitionTimerRef.current = window.setTimeout(() => {
      setIsClosingLogin(false);
      closeTransitionTimerRef.current = null;
    }, 430);
  };

  const onOpenRegister = () => {
    setHoveredSide(null);
    setIsClosingRegister(false);
    setIsClosingLogin(false);
    if (closeTransitionTimerRef.current) {
      window.clearTimeout(closeTransitionTimerRef.current);
      closeTransitionTimerRef.current = null;
    }
    window.setTimeout(() => setActivePanel("register"), 0);
  };

  const onCloseRegister = () => {
    setIsClosingRegister(true);
    setRegisterFieldsVisible(false);
    setActivePanel(null);
    setHoveredSide(null);
    setRegisterError(null);
    setIsRegisterSubmitting(false);
    if (closeTransitionTimerRef.current) {
      window.clearTimeout(closeTransitionTimerRef.current);
    }
    closeTransitionTimerRef.current = window.setTimeout(() => {
      setIsClosingRegister(false);
      closeTransitionTimerRef.current = null;
    }, 430);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (hasFirebaseConfig) {
        await signIn(email, password);
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
        await createUserWithEmailAndPassword(auth, registerEmail, registerPassword);
      } else {
        signInDemo("owner");
      }
      router.push("/dashboard");
    } catch {
      setRegisterError("Could not register. Check email/password and try again.");
    } finally {
      setIsRegisterSubmitting(false);
    }
  };

  useEffect(() => {
    if (!loginTransition) {
      setLoginFieldsVisible(false);
      return;
    }
    const timeout = window.setTimeout(() => setLoginFieldsVisible(true), 30);
    return () => window.clearTimeout(timeout);
  }, [loginTransition]);

  useEffect(() => {
    if (!registerTransition) {
      setRegisterFieldsVisible(false);
      return;
    }
    const timeout = window.setTimeout(() => setRegisterFieldsVisible(true), 30);
    return () => window.clearTimeout(timeout);
  }, [registerTransition]);

  useEffect(() => {
    return () => {
      if (closeTransitionTimerRef.current) {
        window.clearTimeout(closeTransitionTimerRef.current);
      }
    };
  }, []);

  const showLoginForm = loginTransition || isClosingLogin;
  const showRegisterForm = registerTransition || isClosingRegister;

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
        onClick={() => {
          if (!activePanel) onOpenLogin();
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !activePanel) {
            e.preventDefault();
            onOpenLogin();
          }
        }}
        onMouseEnter={() => setHoveredSide("login")}
        onMouseLeave={() => setHoveredSide(null)}
        className="group relative z-10 flex min-h-screen shrink-0 overflow-hidden border-r border-[rgba(215,222,232,0.55)] hover:bg-[rgba(47,107,255,0.50)]"
        style={{
          backgroundColor: "rgba(47,107,255,0.30)",
          flex: `0 0 ${loginBasis}`,
          borderRightWidth: registerTransition ? 0 : 1,
          transition: "flex-basis 900ms cubic-bezier(0.22,1,0.36,1), background-color 300ms ease",
        }}
      >
        <div className="absolute inset-0 z-20 flex items-center justify-center px-8">
          {!showLoginForm ? (
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
              onClick={(e) => e.stopPropagation()}
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
                    className="h-[50px] w-full rounded-[12px] border border-[#D7DEE8] bg-[rgba(255,255,255,0.92)] text-[14px] font-bold text-[#334155]"
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
        onClick={() => {
          if (!activePanel) onOpenRegister();
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !activePanel) {
            e.preventDefault();
            onOpenRegister();
          }
        }}
        onMouseEnter={() => setHoveredSide("register")}
        onMouseLeave={() => setHoveredSide(null)}
        className="group relative z-10 flex min-h-screen shrink-0 items-center justify-center overflow-hidden hover:bg-[rgba(255,255,255,0.50)]"
        style={{
          backgroundColor: "rgba(255,255,255,0.42)",
          flex: `0 0 ${registerBasis}`,
          opacity: registerTransition ? 1 : 1,
          pointerEvents: activePanel === "login" ? "none" : "auto",
          transition: "flex-basis 900ms cubic-bezier(0.22,1,0.36,1), background-color 300ms ease, opacity 220ms ease",
        }}
      >
        <div className="absolute inset-0 z-20 flex items-center justify-center px-8">
          {!showRegisterForm ? (
            <span
              className="text-center uppercase text-[#1F2937] transition-all group-hover:text-[#111827]"
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
              onClick={(e) => e.stopPropagation()}
              onSubmit={onRegisterSubmit}
              className="max-w-none"
              style={{ width: "min(550px, calc(100vw - 120px))" }}
            >
              <p
                className="text-center uppercase text-[#1F2937] transition-all"
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
                  type="password"
                  placeholder="Password"
                  value={registerPassword}
                  onChange={(e) => setRegisterPassword(e.target.value)}
                  required={hasFirebaseConfig}
                  className="h-[50px] w-full min-w-0 rounded-[12px] border border-[#D7DEE8] bg-white px-5 text-[15px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                />
                <input
                  type="password"
                  placeholder="Confirm Password"
                  value={registerConfirmPassword}
                  onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                  required={hasFirebaseConfig}
                  className="h-[50px] w-full min-w-0 rounded-[12px] border border-[#D7DEE8] bg-white px-5 text-[15px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                />
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
                    className="h-[50px] w-full rounded-[12px] border border-[#D7DEE8] bg-[rgba(255,255,255,0.92)] text-[14px] font-bold text-[#334155]"
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
