"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { modalCloseButtonClass } from "@/components/glass-modal-header";

// The phone / tablet cutlist's sheets (Rooms, Notes, a part's Edit, what needs fixing before Add to cutlist): a glass
// pop-up (.glass-modal-panel — so the app's swipe down to close works on it, through its Close X) that rises from the
// bottom of the screen and keeps its box on a phone (data-phone-keep-box) rather than filling it. On a tablet, centred
// along the bottom, no wider than `maxWidth`. Stays on the page while it slides away.
const SHEET_EXIT_MS = 220;

export function useSheetPresence(open: boolean) {
  const [shown, setShown] = useState(open);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open && !shown) setShown(true);
  }
  useEffect(() => {
    if (open || !shown) return;
    const timer = window.setTimeout(() => setShown(false), SHEET_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, shown]);
  return shown;
}

export type CutlistSheetTint = { panelBg: string; headerBg: string; text: string };

export function CutlistSheet({
  open,
  onClose,
  title,
  subtitle,
  icon,
  headerActions,
  children,
  footer,
  tint,
  maxWidth = 640,
  tall = false,
  bodyClassName = "",
  bodyStyle,
  zIndex = 210,
  flushHeader = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  // A part's own colours (its Edit sheet): washed over the glass, its words in them.
  tint?: CutlistSheetTint;
  maxWidth?: number;
  // As tall as it can be (the Notes sheet's editor), rather than only as tall as what's in it.
  tall?: boolean;
  bodyClassName?: string;
  bodyStyle?: CSSProperties;
  zIndex?: number;
  // No gap under its header — what's at the top of its body brings its own (the Notes sheet's chips: their room inside
  // their sideways scroller, so their shadows aren't cut off).
  flushHeader?: boolean;
}) {
  const shown = useSheetPresence(open);
  if (!shown || typeof document === "undefined") return null;
  const closing = !open;
  const textColor = tint?.text ?? "var(--text-main)";
  return createPortal(
    <div className="fixed inset-0 flex items-end justify-center" style={{ zIndex }} data-app-gesture-exempt="true">
      <button
        type="button"
        aria-label="Dismiss"
        tabIndex={-1}
        onClick={onClose}
        className="glass-modal-backdrop cutlist-sheet-backdrop absolute inset-0"
        data-closing={closing ? "true" : undefined}
      />
      <div
        role="dialog"
        aria-modal="true"
        data-phone-keep-box="true"
        data-closing={closing ? "true" : undefined}
        className="glass-modal-panel cutlist-sheet-panel relative flex w-full flex-col overflow-hidden"
        style={{
          maxWidth,
          height: tall ? "calc(100svh - 64px)" : undefined,
          maxHeight: "calc(100svh - 48px)",
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          borderBottomWidth: 0,
          color: textColor,
        }}
      >
        {/* (More solid than the app's other glass: the cutlist's colourful cards under it would show through.) */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundColor: "color-mix(in srgb, var(--panel-bg) 78%, transparent)" }} />
        {tint ? <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundColor: tint.panelBg }} /> : null}
        <div className="relative flex shrink-0 flex-col" style={{ backgroundColor: tint?.headerBg }}>
          <span aria-hidden="true" className="mx-auto mt-2 h-[5px] w-10 rounded-full" style={{ backgroundColor: "color-mix(in srgb, currentColor 22%, transparent)" }} />
          <div className={`flex min-h-[52px] items-center gap-3 px-4 pt-1 ${flushHeader ? "" : "pb-2"}`}>
            {icon ? <span className="inline-flex shrink-0 [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span> : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold" style={{ color: textColor }}>
                {title}
              </p>
              {subtitle ? (
                <p className="truncate text-[12px] font-medium" style={{ color: textColor, opacity: 0.75 }}>
                  {subtitle}
                </p>
              ) : null}
            </div>
            {headerActions ? <div className="flex shrink-0 items-center gap-2">{headerActions}</div> : null}
            <button type="button" onClick={onClose} className={modalCloseButtonClass} style={{ color: textColor }} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div
          data-keyboard-scroll-pad="true"
          className={`glass-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${bodyClassName}`}
          style={bodyStyle}
        >
          {children}
        </div>
        {footer ? (
          <div
            className="relative shrink-0 border-t px-4 pt-3"
            style={{ borderColor: "var(--glass-border)", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}
          >
            {footer}
          </div>
        ) : (
          <div className="shrink-0" style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
        )}
      </div>
    </div>,
    document.body,
  );
}
