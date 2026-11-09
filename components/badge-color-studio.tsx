"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PRESET_SWATCHES } from "@/components/sidebar-color-picker-popover";

// Your badge, big (User Settings — tap your badge): as large as fits the screen, with its colours under it, so a change
// shows on the badge itself as it's made. It slides up out of the badge that was tapped (that one hidden meanwhile, so
// it's the badge itself that moves), growing to its place — and back down into it as it closes. Picking a colour saves it
// (as the small picker always has); a press anywhere off the badge and its colours closes it, in whatever colour it's in.

const OPEN_MS = 380;
const CLOSE_MS = 300;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export function BadgeColorStudio({
  open,
  originEl,
  color,
  initials,
  onSelect,
  onUseCompanyDefault,
  onClose,
}: {
  open: boolean;
  // The badge it grows out of, and goes back into.
  originEl?: HTMLElement | null;
  color: string;
  initials: string;
  onSelect: (hex: string) => void;
  onUseCompanyDefault: () => void;
  onClose: () => void;
}) {
  // Still on screen while it goes back into its badge.
  const [rendered, setRendered] = useState(open);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLButtonElement | null>(null);
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  // The colour shown while the advanced picker's being dragged (saved once it's let go).
  const [preview, setPreview] = useState("");
  const [hexDraft, setHexDraft] = useState(color);

  useEffect(() => {
    if (open) setRendered(true);
  }, [open]);
  useEffect(() => {
    setHexDraft(color);
    setPreview("");
  }, [color, open]);

  // From its badge (where it is now) to its place: the transform that puts it over that badge, at its size.
  const transformOver = (target: HTMLElement | null | undefined): string | null => {
    const badge = badgeRef.current;
    if (!badge || !target || !target.isConnected) return null;
    const from = target.getBoundingClientRect();
    const to = badge.getBoundingClientRect();
    if (from.width <= 0 || to.width <= 0) return null;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${from.width / to.width})`;
  };

  useLayoutEffect(() => {
    if (!rendered) return;
    const badge = badgeRef.current;
    const picker = pickerRef.current;
    const backdrop = backdropRef.current;
    if (!badge) return;
    if (open) {
      // Out of the tapped badge: that one hidden while this one's up.
      if (originEl) originEl.style.visibility = "hidden";
      const from = transformOver(originEl);
      if (from) badge.animate([{ transform: from }, { transform: "none" }], { duration: OPEN_MS, easing: EASE });
      picker?.animate([{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }], { duration: OPEN_MS, easing: EASE });
      backdrop?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS, easing: "ease" });
      return;
    }
    // Back down into its badge, then gone (and that badge shown again) — from wherever it is now (still growing, if it's
    // closed straight away), measured against where it sits with no animation on it.
    const current = getComputedStyle(badge).transform;
    badge.getAnimations().forEach((animation) => animation.cancel());
    const to = transformOver(originEl);
    const options: KeyframeAnimationOptions = { duration: CLOSE_MS, easing: EASE, fill: "forwards" };
    badge.animate([{ transform: current && current !== "none" ? current : "none" }, { transform: to ?? "scale(0.4)", ...(to ? {} : { opacity: 0 }) }], options);
    picker?.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(24px)" }], options);
    backdrop?.animate([{ opacity: 1 }, { opacity: 0 }], { ...options, easing: "ease" });
    // (A timer, not the animations finishing: they don't run on a page that isn't being drawn.)
    const timer = window.setTimeout(() => {
      if (originEl) originEl.style.visibility = "";
      setRendered(false);
    }, CLOSE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, open]);

  // The native picker: shown as it moves (input), saved once it's let go (change) — one save, not dozens.
  useEffect(() => {
    const el = colorInputRef.current;
    if (!el) return;
    const onInput = (event: Event) => setPreview((event.target as HTMLInputElement).value);
    const onChange = (event: Event) => {
      setPreview("");
      onSelect((event.target as HTMLInputElement).value);
    };
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
    };
  }, [onSelect, rendered]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  // (Gone without closing — left the page: its badge shown again.)
  useEffect(() => () => {
    if (originEl) originEl.style.visibility = "";
  }, [originEl]);

  if (!rendered || typeof document === "undefined") return null;
  const shown = preview || color;
  const commitHex = (value: string) => {
    const clean = value.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(clean)) onSelect(clean);
  };
  return createPortal(
    <div
      data-sidebar-color-popover="true"
      className="fixed inset-0 z-[9000] flex flex-col items-center justify-center gap-6 px-6 py-8"
      style={{ pointerEvents: open ? undefined : "none" }}
    >
      <button ref={backdropRef} type="button" aria-label="Done" onClick={onClose} className="glass-modal-backdrop absolute inset-0" />
      {/* As big as fits: the screen's width or the room left above its colours, whichever's less. */}
      <div
        ref={badgeRef}
        className="relative inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-white transition-colors"
        style={{
          width: "min(72vw, 42svh, 300px)",
          height: "min(72vw, 42svh, 300px)",
          fontSize: "calc(min(72vw, 42svh, 300px) * 0.36)",
          backgroundColor: shown,
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.28)",
        }}
      >
        {initials}
      </div>
      <div
        ref={pickerRef}
        className="relative w-full max-w-[340px] rounded-[20px] border p-4"
        style={{
          borderColor: "var(--glass-border)",
          backgroundColor: "var(--glass-modal-bg)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          boxShadow: "var(--shadow-glass)",
        }}
      >
        <div className="grid grid-cols-6 justify-items-center gap-2.5">
          {PRESET_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => onSelect(hex)}
              aria-label={`Use colour ${hex}`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 transition hover:scale-105"
              style={{ backgroundColor: hex, borderColor: hex.toLowerCase() === shown.toLowerCase() ? "var(--text-main)" : "transparent" }}
            />
          ))}
          {/* The rest of the colours: the device's own picker. */}
          <label
            className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2"
            style={{ borderColor: "var(--glass-border)", background: "conic-gradient(#ef4444, #f59e0b, #84cc16, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)" }}
            aria-label="Any colour"
          >
            <input
              ref={colorInputRef}
              type="color"
              value={/^#[0-9A-Fa-f]{6}$/.test(shown) ? shown : "#2F6BFF"}
              onChange={() => {}}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>
        <div className="mt-3.5 flex items-center gap-2">
          <input
            value={hexDraft}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={() => commitHex(hexDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitHex(hexDraft);
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="#2F6BFF"
            aria-label="Colour code"
            className="h-10 min-w-0 flex-1 rounded-full border px-4 text-[16px] font-medium outline-none"
            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
          />
          <button
            type="button"
            onClick={onUseCompanyDefault}
            className="glass-shine glass-shine-neutral h-10 shrink-0 rounded-full px-4 text-[13px] font-medium"
            style={{ color: "var(--text-main)" }}
          >
            Company colour
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
