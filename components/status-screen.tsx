"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import "@/components/login/login-screen.css";
import { DotField } from "@/components/login/dot-field";

// The app's "Page not found" and "Something went wrong": an icon, what's happened, and the way on.
//  - StatusScreen: a page of its own, in the login screen's card (components/login) — a link that goes nowhere
//    (app/not-found.tsx), or an error outside the app's pages (app/error.tsx, app/global-error.tsx).
//  - StatusPanel: inside the app, under its top bar and beside its sidebar, so everything else is still a tap away — an
//    error on one of its pages (app/(staff)/(app)/error.tsx), a project that isn't there.
// Their buttons: the login screen's (lg-primary, lg-link).

type StatusProps = {
  icon: ReactNode;
  title: string;
  message: ReactNode;
  // The buttons.
  children?: ReactNode;
  // An error's reference (lib/crash-reporting.ts's reportError), to match it up with what someone says they saw.
  reference?: string;
};

function StatusBody({ icon, title, message, children, reference }: StatusProps) {
  return (
    <>
      <div className="lg-icon-badge">{icon}</div>
      <h1 className="lg-title">{title}</h1>
      <p className="lg-subtitle" style={{ maxWidth: 320, marginInline: "auto", lineHeight: 1.5 }}>
        {message}
      </p>
      {children}
      {reference ? (
        <p className="mt-3 text-center text-[11px] font-medium select-text" style={{ color: "var(--text-muted)" }}>
          Reference: {reference}
        </p>
      ) : null}
    </>
  );
}

export function StatusScreen(props: StatusProps) {
  return (
    <div className="lg-root">
      <div className="lg-blob" style={{ width: 520, height: 520, background: "#8cc2ff", top: -160, left: -140 }} />
      <div className="lg-blob" style={{ width: 440, height: 440, background: "#c9c2ff", bottom: -160, right: -100 }} />
      <div className="lg-blob" style={{ width: 360, height: 360, background: "#a6ece2", bottom: 40, left: "32%" }} />
      <DotField className="lg-dots-canvas" />
      <main className="lg-main">
        <section className="lg-card" aria-label={props.title}>
          <Image src="/icon-192.png" alt="CutSmart" width={68} height={68} className="lg-logo" priority />
          <StatusBody {...props} />
        </section>
      </main>
    </div>
  );
}

export function StatusPanel(props: StatusProps) {
  return (
    <div className="flex justify-center px-1 py-8 md:py-16">
      <section aria-label={props.title} className="glass-shine glass-shine-neutral w-full max-w-[400px] rounded-[24px] border px-6 pb-5 pt-7">
        <StatusBody {...props} />
      </section>
    </div>
  );
}

// "Go back": the page before, or — opened straight onto this one (a link, a QR code) — `fallback`.
export function StatusBackButton({ fallback = "/", label = "Go back" }: { fallback?: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="lg-link"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.replace(fallback);
      }}
    >
      {label}
    </button>
  );
}
