"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GlassActionMenu } from "@/components/glass-dropdown";
import { useAuth } from "@/lib/auth-context";
import { fetchIsDevEmail } from "@/lib/dev-emails";
import { devButtonClass, sendDevTest, setDevUser, toggleDevMode, useDevModeOn, useIsDevUser } from "@/lib/dev-mode";
import { DEV_TEST_DELAYS } from "@/lib/push-dev-test";

// Dev mode's switch (lib/dev-mode.ts), for the Dev users in public/dev-emails.txt only: tapping the screen
// 5 times within a second turns it on or off — and on a computer, so does the tiny "dev" button in the top
// left corner of the window, with a dot beside it: green while it's on, red while it's off — always on
// top, even over pop-ups and their blurred backgrounds. Renders nothing for everyone else.

const TAPS_TO_TOGGLE = 5;
const TAP_WINDOW_MS = 1000;

const devButtonStyle = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" } as const;

export function DevMode() {
  const { user } = useAuth();
  const email = String(user?.email || "").trim().toLowerCase();
  useEffect(() => {
    if (!email) {
      setDevUser(false);
      return;
    }
    let cancelled = false;
    void fetchIsDevEmail(email).then((yes) => {
      if (!cancelled) setDevUser(yes);
    });
    return () => {
      cancelled = true;
    };
  }, [email]);

  const isDevUser = useIsDevUser();
  const isOn = useDevModeOn();

  // The button lives in the browser's top layer (a manual popover, shown once it's there), which sits above
  // everything on the page whatever its z-index — many of the app's pop-ups already use the highest one.
  const cornerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const corner = cornerRef.current;
    if (!isDevUser || !corner || typeof corner.showPopover !== "function") return;
    try {
      if (!corner.matches(":popover-open")) corner.showPopover();
    } catch {
      // No top layer here — the z-index still puts it above most things.
    }
  }, [isDevUser]);

  useEffect(() => {
    if (!isDevUser) return;
    let taps: number[] = [];
    const onPointerDown = () => {
      const now = performance.now();
      taps = [...taps.filter((at) => now - at < TAP_WINDOW_MS), now];
      if (taps.length < TAPS_TO_TOGGLE) return;
      taps = [];
      toggleDevMode();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [isDevUser]);

  if (!isDevUser || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={cornerRef}
      popover="manual"
      // A popover's default look (centred, bordered, filled) undone — just the button and its dot.
      className="fixed bottom-auto left-1.5 right-auto top-1.5 z-[2147483647] m-0 hidden items-center gap-1 overflow-visible border-0 bg-transparent p-0 lg:flex"
    >
      <button
        type="button"
        onClick={() => toggleDevMode()}
        title={isOn ? "Dev mode is on — click to turn it off" : "Turn on dev mode"}
        className={devButtonClass()}
        style={devButtonStyle}
      >
        dev
      </button>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: isOn ? "var(--success)" : "var(--danger)" }} />
    </div>,
    document.body,
  );
}

// A notification row's "test" button (shown while dev mode is on): asks when to send it, then sends that
// notification, with made-up details, to the user's own devices — counting down to it if it's for later,
// then saying how it went for a moment.
export function DevTestButton({ sample, label = "test" }: { sample: string; label?: string }) {
  const [status, setStatus] = useState<{ text: string; tone: "" | "ok" | "error" }>({ text: "", tone: "" });
  const timerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const later = (ms: number, run: () => void) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(run, ms);
  };
  const finish = (text: string, ok: boolean) => {
    setStatus({ text, tone: ok ? "ok" : "error" });
    later(ok ? 2000 : 4000, () => setStatus({ text: "", tone: "" }));
  };
  const send = async (delaySeconds: number) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setStatus({ text: "sending…", tone: "" });
    const result = await sendDevTest(sample, delaySeconds);
    if (!result.ok || !delaySeconds) {
      finish(result.text, result.ok);
      return;
    }
    let secondsLeft = delaySeconds;
    const tick = () => {
      if (secondsLeft <= 0) {
        finish("sent", true);
        return;
      }
      setStatus({ text: `in ${secondsLeft}s`, tone: "" });
      secondsLeft -= 1;
      later(1000, tick);
    };
    tick();
  };

  return (
    <GlassActionMenu
      ariaLabel="Send a test — when?"
      menuMinWidth={150}
      items={DEV_TEST_DELAYS.map((option) => ({
        key: String(option.seconds),
        label: option.label,
        onSelect: () => void send(option.seconds),
      }))}
      triggerClassName={`shrink-0 ${devButtonClass(Boolean(status.text))}`}
      triggerStyle={
        status.tone
          ? { ...devButtonStyle, color: status.tone === "ok" ? "var(--success-strong)" : "var(--danger-strong)" }
          : devButtonStyle
      }
    >
      {status.text || label}
    </GlassActionMenu>
  );
}
