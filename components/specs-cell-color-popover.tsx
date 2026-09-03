"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PRESET_SWATCHES } from "@/components/sidebar-color-picker-popover";

export type SpecsColorPopoverAnchorRect = { left: number; top: number; width: number; height: number };

// Modeled directly on components/sidebar-color-picker-popover.tsx (swatch grid + native color input
// + hex text field, outside-click closes it) — that component's "Use Company Default" button is
// specific to its own use case, so this is a separate, smaller component rather than a modification
// of it. Used for both the cell background-color and border-color toolbar buttons.
export function SpecsCellColorPopover({
  isOpen,
  anchorRect,
  currentColor,
  companyColor,
  onSelect,
  onClose,
}: {
  isOpen: boolean;
  anchorRect: SpecsColorPopoverAnchorRect | null;
  currentColor: string;
  companyColor?: string;
  onSelect: (hex: string) => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [hexDraft, setHexDraft] = useState(currentColor);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHexDraft(currentColor);
  }, [currentColor, isOpen]);

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

  const width = 220;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.min(Math.max(8, anchorRect.left), Math.max(8, viewportWidth - width - 8));
  const estimatedHeight = 190;
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
      data-specs-color-popover="true"
      // Also tagged as part of the specs layout modal even though it's portaled to document.body
      // (outside that modal's DOM subtree) — the host page's autosave-exclusion check on
      // company-settings uses DOM `closest()`, which only sees the real DOM tree, not React's
      // portal-aware tree, so this popover's own hex-color <input> needs the same marker directly.
      data-specs-layout-modal="true"
      className="fixed z-[2000] overflow-hidden rounded-[12px] border p-3"
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
      <div className="grid grid-cols-5 gap-2">
        {companyColor && /^#[0-9A-Fa-f]{6}$/.test(companyColor) ? (
          <button
            type="button"
            onClick={() => onSelect(companyColor)}
            aria-label="Use company color"
            title="Company color"
            className="relative inline-flex h-7 w-7 items-center justify-center rounded-full border transition hover:scale-105"
            style={{
              backgroundColor: companyColor,
              borderColor: companyColor.toLowerCase() === currentColor.toLowerCase() ? "var(--text-main)" : "var(--glass-border)",
            }}
          >
            <span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border"
              style={{ backgroundColor: "var(--brand-strong)", borderColor: "var(--glass-bg-strong)" }}
            />
          </button>
        ) : null}
        {PRESET_SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => onSelect(hex)}
            aria-label={`Use color ${hex}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border transition hover:scale-105"
            style={{
              backgroundColor: hex,
              borderColor: hex.toLowerCase() === currentColor.toLowerCase() ? "var(--text-main)" : "var(--glass-border)",
            }}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/.test(currentColor) ? currentColor : "#FFFFFF"}
          onChange={(e) => onSelect(e.target.value)}
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
          placeholder="#FFFFFF"
          className="h-9 w-full min-w-0 rounded-[8px] border px-2 text-[12px] outline-none"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
        />
      </div>
    </div>,
    document.body,
  );
}
