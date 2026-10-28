"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloudCheck, CloudOff, CloudUpload } from "lucide-react";
import { waitForPendingWrites } from "@/lib/firestore-client";
import { db } from "@/lib/firebase";
import { isPreviewMode } from "@/lib/preview-mode";

// The connection, when it matters — a little glass pill under the top bar, so on a site with bad signal nobody wonders
// whether their work went in:
//  - Offline (the device says so): "Offline — changes will save when you're back". They will: every change waits on this
//    device till then, through a refresh or the app being closed (lib/firebase.ts).
//  - Online as far as the device knows, but changes not reaching the database for a while (one bar of signal):
//    "Waiting for signal — your changes are saved on this device".
//  - Back: "Saving your changes…" till the database has them all, then "All changes saved" for a moment.
// Not in the CutSmart Preview: nothing there is sent anywhere.

type Look = "offline" | "waiting" | "saving" | "saved";

const LOOKS: Record<Look, { icon: typeof CloudOff; text: string; color: string }> = {
  offline: { icon: CloudOff, text: "Offline — changes will save when you're back", color: "#D97706" },
  waiting: { icon: CloudOff, text: "Waiting for signal — your changes are saved on this device", color: "#D97706" },
  saving: { icon: CloudUpload, text: "Back online — saving your changes…", color: "var(--brand)" },
  saved: { icon: CloudCheck, text: "All changes saved", color: "#16A34A" },
};

// How long changes can take to reach the database before it's "waiting for signal", how often that's checked, and how
// long "All changes saved" stays.
const WAITING_AFTER_MS = 8000;
const CHECK_EVERY_MS = 10000;
const SAVED_FOR_MS = 2500;

// Whether this device's changes have all reached the database — false if they haven't within `ms` (no answer either way:
// a browser that can't say, true).
async function allSavedWithin(ms: number): Promise<boolean> {
  if (!db) return true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      waitForPendingWrites(db).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } catch {
    return true;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function ConnectionStatus() {
  const [look, setLook] = useState<Look | null>(null);
  const lookRef = useRef<Look | null>(null);
  const [leaving, setLeaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isPreviewMode()) return;
    let cancelled = false;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let checking = false;
    const show = (next: Look | null) => {
      if (cancelled || lookRef.current === next) return;
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      lookRef.current = next;
      if (next) {
        setLeaving(false);
        setLook(next);
      } else {
        // (Popped away, then gone.)
        setLeaving(true);
        hideTimer = setTimeout(() => {
          if (!cancelled && !lookRef.current) setLook(null);
        }, 220);
      }
    };
    const savedThenHide = () => {
      show("saved");
      hideTimer = setTimeout(() => show(null), SAVED_FOR_MS);
    };
    // Waits for this device's changes to reach the database: "waiting for signal" while they haven't (and
    // `whileWaiting` first, if given), "All changes saved" once they have — or nothing, if they got there quickly.
    const watchUntilSaved = async (whileWaiting?: Look) => {
      if (checking) return;
      checking = true;
      try {
        if (whileWaiting) show(whileWaiting);
        let slow = Boolean(whileWaiting);
        while (!cancelled && navigator.onLine) {
          if (await allSavedWithin(WAITING_AFTER_MS)) break;
          slow = true;
          if (!cancelled && navigator.onLine) show("waiting");
        }
        if (cancelled || !navigator.onLine) return;
        if (slow) savedThenHide();
      } finally {
        checking = false;
      }
    };
    const onOffline = () => show("offline");
    const onOnline = () => void watchUntilSaved("saving");
    const startedOffline = setTimeout(() => {
      if (!navigator.onLine) onOffline();
    }, 0);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    // Online, now and then: is anything stuck on its way?
    const interval = setInterval(() => {
      if (navigator.onLine && !lookRef.current) void watchUntilSaved();
    }, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      if (hideTimer) clearTimeout(hideTimer);
      clearTimeout(startedOffline);
      clearInterval(interval);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  // Just under the top bar (wherever it is — taller on a phone), or near the top of the screen with none. (Placed
  // straight onto it: where it is, not something to render.)
  useLayoutEffect(() => {
    if (!look) return;
    const place = () => {
      const bar = document.querySelector<HTMLElement>('[data-app-top-bar="true"]');
      const bottom = bar ? Math.max(bar.getBoundingClientRect().bottom, 0) : 0;
      if (wrapRef.current) wrapRef.current.style.top = `max(${bottom + 8}px, calc(env(safe-area-inset-top) + 8px))`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [look]);

  if (!look || typeof document === "undefined") return null;
  const { icon: Icon, text, color } = LOOKS[look];
  return createPortal(
    <div ref={wrapRef} className="pointer-events-none fixed inset-x-0 top-3 z-[1800] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex max-w-[min(560px,calc(100vw-32px))] items-center gap-2 rounded-full border px-3.5 py-1.5 ${leaving ? "glass-bar-pop-away" : "glass-bar-pop"}`}
        style={{
          borderColor: "var(--glass-border)",
          backgroundColor: "var(--glass-modal-bg)",
          backdropFilter: "blur(16px) saturate(200%)",
          WebkitBackdropFilter: "blur(16px) saturate(200%)",
          boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass), 0 12px 30px rgba(15,23,42,0.18)",
          color: "var(--text-main)",
        }}
      >
        <Icon size={15} className="shrink-0" style={{ color }} aria-hidden="true" />
        <span className="min-w-0 text-[12.5px] font-medium">{text}</span>
      </div>
    </div>,
    document.body,
  );
}
