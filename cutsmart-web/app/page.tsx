"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { hasFirebaseConfig } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

export default function HomePage() {
  const router = useRouter();
  const { signIn, signInDemo } = useAuth();
  const [hoveredSide, setHoveredSide] = useState<"login" | "register" | null>(null);
  const [loginTransition, setLoginTransition] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginBasis = loginTransition
    ? "100%"
    : hoveredSide === "login"
      ? "60%"
      : hoveredSide === "register"
        ? "40%"
        : "50%";

  const registerBasis = loginTransition
    ? "0%"
    : hoveredSide === "register"
      ? "60%"
      : hoveredSide === "login"
        ? "40%"
        : "50%";

  const onOpenLogin = () => {
    setHoveredSide(null);
    window.setTimeout(() => setLoginTransition(true), 0);
  };

  const onCloseLogin = () => {
    setLoginTransition(false);
    setHoveredSide(null);
    setError(null);
    setIsSubmitting(false);
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
          if (!loginTransition) onOpenLogin();
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !loginTransition) {
            e.preventDefault();
            onOpenLogin();
          }
        }}
        onMouseEnter={() => setHoveredSide("login")}
        onMouseLeave={() => setHoveredSide(null)}
        className="group relative z-10 flex min-h-screen shrink-0 border-r border-[rgba(215,222,232,0.55)] hover:bg-[rgba(47,107,255,0.50)]"
        style={{
          backgroundColor: "rgba(47,107,255,0.30)",
          flex: `0 0 ${loginBasis}`,
          transition: "flex-basis 900ms cubic-bezier(0.22,1,0.36,1), background-color 300ms ease",
        }}
      >
        <div className="absolute inset-0 z-20 flex items-center justify-center px-8">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={onSubmit}
            className="w-[460px] max-w-[92vw]"
            style={{ pointerEvents: loginTransition ? "auto" : "none" }}
          >
            <p
              className="text-center uppercase text-[#0F274A] transition-all"
              style={{
                fontSize: "clamp(26px, 3.2vw, 46px)",
                lineHeight: 0.95,
                fontWeight: hoveredSide === "login" || loginTransition ? 900 : 600,
                marginBottom: loginTransition ? 18 : 0,
              }}
            >
              LOG IN
            </p>

            <div
              className="grid grid-cols-1 gap-3"
              style={{
                opacity: loginTransition ? 1 : 0,
                transform: loginTransition ? "translateY(0)" : "translateY(-10px)",
                pointerEvents: loginTransition ? "auto" : "none",
                transition: "opacity 360ms ease, transform 360ms ease",
              }}
            >
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required={hasFirebaseConfig}
                className="h-[46px] w-full rounded-[12px] border border-[#D7DEE8] bg-[rgba(255,255,255,0.94)] px-4 text-[14px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={hasFirebaseConfig}
                className="h-[46px] w-full rounded-[12px] border border-[#D7DEE8] bg-[rgba(255,255,255,0.94)] px-4 text-[14px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
              />
              {error && <p className="text-[12px] font-semibold text-[#D32F2F]">{error}</p>}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-[44px] rounded-[10px] border border-[#2F6BFF] bg-[#2F6BFF] text-[13px] font-bold text-white disabled:opacity-60"
                >
                  {isSubmitting ? "Signing..." : "Sign In"}
                </button>
                <button
                  type="button"
                  onClick={onCloseLogin}
                  className="h-[44px] rounded-[10px] border border-[#D7DEE8] bg-[rgba(255,255,255,0.92)] text-[13px] font-bold text-[#334155]"
                >
                  Back
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <Link
        href="/login?mode=register"
        onMouseEnter={() => setHoveredSide("register")}
        onMouseLeave={() => setHoveredSide(null)}
        className="group relative z-10 flex min-h-screen shrink-0 items-center justify-center overflow-hidden hover:bg-[rgba(255,255,255,0.50)]"
        style={{
          backgroundColor: "rgba(255,255,255,0.42)",
          flex: `0 0 ${registerBasis}`,
          opacity: loginTransition ? 0 : 1,
          pointerEvents: loginTransition ? "none" : "auto",
          transition: "flex-basis 900ms cubic-bezier(0.22,1,0.36,1), background-color 300ms ease, opacity 220ms ease",
        }}
      >
        <span
          className="tracking-[0.10em] uppercase text-[#1F2937] transition-all group-hover:text-[#111827]"
          style={{
            fontSize: "clamp(26px, 3.2vw, 46px)",
            lineHeight: 0.95,
            fontWeight: hoveredSide === "register" ? 900 : 600,
          }}
        >
          REGISTER
        </span>
      </Link>
    </div>
  );
}
