"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// A short message in a floating bar at the bottom of the screen — the production cutlist's Notes/Contractors bar's look
// (glass pill, popping in with a little bounce and away with a pop: glass-bar-pop / -pop-away, globals.css). Shown for
// a few seconds, or until it's closed. show(text) shows it (or swaps its text); `element` goes anywhere in the page.
// tone "yellow": the same glass, washed yellow — e.g. a job's status that can't change (it's locked).
export function useFloatingNotice({ durationMs = 4000, tone = "glass" }: { durationMs?: number; tone?: "glass" | "yellow" } = {}) {
  const [notice, setNotice] = useState<{ text: string; icon: ReactNode; leaving: boolean; key: number } | null>(null);
  const timersRef = useRef<number[]>([]);
  const clearTimers = () => {
    timersRef.current.splice(0).forEach((timer) => window.clearTimeout(timer));
  };
  const hide = () => {
    clearTimers();
    setNotice((prev) => (prev ? { ...prev, leaving: true } : prev));
    // Gone once its pop-away has played (180ms).
    timersRef.current.push(window.setTimeout(() => setNotice(null), 200));
  };
  const show = (text: string, icon: ReactNode = null) => {
    clearTimers();
    setNotice((prev) => ({ text, icon, leaving: false, key: (prev?.key ?? 0) + 1 }));
    timersRef.current.push(window.setTimeout(hide, durationMs));
  };
  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.splice(0).forEach((timer) => window.clearTimeout(timer));
  }, []);

  const element =
    notice && typeof document !== "undefined"
      ? createPortal(
          <div
            className="pointer-events-none fixed inset-x-0 z-[1800] flex justify-center px-4"
            style={{ bottom: "calc(24px + env(safe-area-inset-bottom))" }}
          >
            <div
              key={notice.key}
              role="status"
              className={`pointer-events-auto flex max-w-[min(560px,calc(100vw-32px))] items-center gap-2 rounded-full border py-1.5 pl-3.5 pr-1.5 ${
                notice.leaving ? "glass-bar-pop-away" : "glass-bar-pop"
              }`}
              style={{
                borderColor: tone === "yellow" ? "color-mix(in srgb, #EAB308 55%, var(--glass-border))" : "var(--glass-border)",
                backgroundColor: tone === "yellow" ? "color-mix(in srgb, #FACC15 40%, var(--glass-modal-bg))" : "var(--glass-modal-bg)",
                backdropFilter: "blur(16px) saturate(200%)",
                WebkitBackdropFilter: "blur(16px) saturate(200%)",
                boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass), 0 16px 40px rgba(15,23,42,0.25)",
                color: "var(--text-main)",
              }}
            >
              {notice.icon ? <span className="inline-flex shrink-0">{notice.icon}</span> : null}
              <span className="min-w-0 text-[12.5px] font-medium">{notice.text}</span>
              <button
                type="button"
                onClick={hide}
                aria-label="Dismiss"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)]"
                style={{ color: "var(--text-main)" }}
              >
                <X size={14} />
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return { show, hide, element };
}
