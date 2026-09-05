"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const PRESET_SWATCHES = [
  "#000000",
  "#2F6BFF",
  "#7C3AED",
  "#DB2777",
  "#DC2626",
  "#EA580C",
  "#D97706",
  "#65A30D",
  "#059669",
  "#0891B2",
  "#334155",
];

export type ColorPickerAnchorRect = { left: number; top: number; width: number; height: number };

export function SidebarColorPickerPopover({
  isOpen,
  anchorRect,
  currentColor,
  onSelect,
  onUseCompanyDefault,
  onClose,
}: {
  isOpen: boolean;
  anchorRect: ColorPickerAnchorRect | null;
  currentColor: string;
  onSelect: (hex: string) => void;
  onUseCompanyDefault: () => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const [hexDraft, setHexDraft] = useState(currentColor);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHexDraft(currentColor);
  }, [currentColor, isOpen]);

  // React's `onChange` on an <input> is really wired to the native `input` event, which a native
  // color picker fires continuously while its OS-level wheel is being dragged — see
  // specs-cell-color-popover.tsx's identical fix for the full explanation (that copy of this same
  // pattern was tripping React's "Maximum update depth exceeded" once its onSelect started doing
  // heavier work). Fixed here too, preemptively, since it's the exact same latent issue. The native
  // `change` event fires exactly once, when the picker is closed/the color is finalized.
  useEffect(() => {
    const el = colorInputRef.current;
    if (!el) return;
    const handleNativeChange = (e: Event) => onSelect((e.target as HTMLInputElement).value);
    el.addEventListener("change", handleNativeChange);
    return () => el.removeEventListener("change", handleNativeChange);
  }, [onSelect]);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const onPointerDown = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      if (popoverRef.current?.contains(targetNode)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOpen, onClose]);

  if (!isOpen || !anchorRect || typeof document === "undefined") return null;

  const width = 232;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.min(Math.max(8, anchorRect.left), Math.max(8, viewportWidth - width - 8));
  const estimatedHeight = 220;
  const openUp = anchorRect.top + anchorRect.height + estimatedHeight + 8 > viewportHeight;
  const top = openUp ? Math.max(8, anchorRect.top - estimatedHeight - 8) : anchorRect.top + anchorRect.height + 8;

  const commitHex = (value: string) => {
    const clean = value.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(clean)) {
      onSelect(clean);
    }
  };

  return createPortal(
    <div
      ref={popoverRef}
      data-sidebar-color-popover="true"
      className="fixed z-[220] overflow-hidden rounded-[12px] border p-3"
      style={{
        left,
        top,
        width,
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-bg-strong)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        boxShadow: "var(--shadow-glass)",
      }}
    >
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>
        Emblem Color
      </p>
      <div className="grid grid-cols-5 gap-2">
        {PRESET_SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => onSelect(hex)}
            aria-label={`Use color ${hex}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border transition hover:scale-105"
            style={{
              backgroundColor: hex,
              borderColor: hex.toLowerCase() === currentColor.toLowerCase() ? "var(--text-main)" : "var(--glass-border)",
            }}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          ref={colorInputRef}
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/.test(currentColor) ? currentColor : "#2F6BFF"}
          // Deliberately not calling onSelect here — see the native "change" listener above.
          onChange={() => {}}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-[8px] border p-1"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}
          aria-label="Advanced color picker"
        />
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
          className="h-9 w-full min-w-0 rounded-[8px] border px-2 text-[12px] outline-none"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
        />
      </div>

      <button
        type="button"
        onClick={onUseCompanyDefault}
        className="mt-3 h-9 w-full rounded-[8px] border text-[12px] font-bold transition hover:brightness-95"
        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
      >
        Use Company Default
      </button>
    </div>,
    document.body,
  );
}
