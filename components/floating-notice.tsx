"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { glassShineStyle } from "@/lib/glass-shine";
import { isPreviewMode } from "@/lib/preview-mode";

// A short message in a floating bar at the bottom of the screen — the production cutlist's Notes/Contractors bar's look
// (glass pill, popping in with a little bounce and away with a pop: glass-bar-pop / -pop-away, globals.css). Shown for
// a few seconds, or until it's closed. show(text) shows it (or swaps its text); `element` goes anywhere in the page.
// tone "yellow": the same glass, washed yellow — e.g. a job's status that can't change (it's locked). `action`: a round
// button on it (e.g. Undo, after something's removed) — pressed, it does it and the bar goes. `takesBottom` (the Undo bar,
// components/undo-bar.tsx): while it shows, the other bars along the bottom of the screen step aside for it (body
// data-undo-bar — app/globals.css), it in their place; any other notice is one of those (data-bottom-bar). While the
// mouse is over it, it stays (its time paused — carrying on from there, or 1.5s at least, as the mouse leaves).
// `onHidden`: as it goes (its time up, closed, or its action pressed) — not when show() swaps in another.
export function useFloatingNotice({
  durationMs = 4000,
  tone = "glass",
  takesBottom = false,
  onHidden,
}: { durationMs?: number; tone?: "glass" | "yellow"; takesBottom?: boolean; onHidden?: () => void } = {}) {
  const [notice, setNotice] = useState<{
    text: string;
    icon: ReactNode;
    action: { label: string; onClick: () => void } | null;
    leaving: boolean;
    key: number;
  } | null>(null);
  const timersRef = useRef<number[]>([]);
  const clearTimers = () => {
    timersRef.current.splice(0).forEach((timer) => window.clearTimeout(timer));
  };
  const onHiddenRef = useRef(onHidden);
  useEffect(() => {
    onHiddenRef.current = onHidden;
  });
  // When its time's up (0: not counting down — gone, going, or held by the mouse), and the time it had left when held.
  const hideAtRef = useRef(0);
  const heldLeftRef = useRef<number | null>(null);
  const hide = () => {
    clearTimers();
    hideAtRef.current = 0;
    heldLeftRef.current = null;
    setNotice((prev) => (prev ? { ...prev, leaving: true } : prev));
    // Gone once its pop-away has played (180ms).
    timersRef.current.push(window.setTimeout(() => setNotice(null), 200));
    onHiddenRef.current?.();
  };
  const countDown = (ms: number) => {
    hideAtRef.current = Date.now() + ms;
    timersRef.current.push(window.setTimeout(hide, ms));
  };
  const show = (text: string, icon: ReactNode = null, action: { label: string; onClick: () => void } | null = null) => {
    clearTimers();
    heldLeftRef.current = null;
    setNotice((prev) => ({ text, icon, action, leaving: false, key: (prev?.key ?? 0) + 1 }));
    countDown(durationMs);
  };
  // The mouse over it: its time stops; off it again, it carries on (with long enough left to get back to it).
  const hold = () => {
    if (!hideAtRef.current) return;
    heldLeftRef.current = Math.max(0, hideAtRef.current - Date.now());
    clearTimers();
    hideAtRef.current = 0;
  };
  const letGo = () => {
    if (heldLeftRef.current == null) return;
    const left = heldLeftRef.current;
    heldLeftRef.current = null;
    countDown(Math.max(left, 1500));
  };
  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.splice(0).forEach((timer) => window.clearTimeout(timer));
  }, []);
  // (Taking the bottom: the others stepping aside while it shows — and back as it goes.)
  const showing = Boolean(notice && !notice.leaving);
  useEffect(() => {
    if (!takesBottom || typeof document === "undefined") return;
    if (showing) document.body.setAttribute("data-undo-bar", "");
    else document.body.removeAttribute("data-undo-bar");
    return () => document.body.removeAttribute("data-undo-bar");
  }, [showing, takesBottom]);

  const element =
    notice && typeof document !== "undefined"
      ? createPortal(
          <div
            data-bottom-bar={takesBottom ? undefined : ""}
            // (The Undo bar over everything — any pop-up too, a phone's whole-screen ones included: what it undoes can be in one.)
            className={`pointer-events-none fixed inset-x-0 flex justify-center px-4 ${takesBottom ? "z-[2147483647]" : "z-[1800]"}`}
            // (In the CutSmart Preview, above its own bar along the bottom — but the Undo bar, which takes its place.)
            style={{ bottom: `calc(${isPreviewMode() && !takesBottom ? 60 : 24}px + env(safe-area-inset-bottom))` }}
          >
            <div
              key={notice.key}
              role="status"
              // (A mouse only — a tap on a phone isn't a hover.)
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") hold();
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") letGo();
              }}
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
              {notice.action ? (
                <button
                  type="button"
                  onClick={() => {
                    notice.action?.onClick();
                    hide();
                  }}
                  className="glass-shine inline-flex h-7 shrink-0 items-center rounded-full border px-3.5 text-[12px] font-medium text-white transition hover:brightness-105"
                  style={glassShineStyle("var(--brand)")}
                >
                  {notice.action.label}
                </button>
              ) : null}
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
