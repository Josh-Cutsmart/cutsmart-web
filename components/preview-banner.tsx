"use client";

import { useSyncExternalStore } from "react";
import { LogOut, Sparkles } from "lucide-react";
import { exitPreview, isPreviewMode } from "@/lib/preview-mode";

// Shown over the app while in CutSmart Preview: what this is, and the way out (which also resets it).
export function PreviewBanner() {
  const inPreview = useSyncExternalStore(
    () => () => undefined,
    isPreviewMode,
    () => false,
  );
  if (!inPreview) return null;
  return (
    <div
      className="fixed left-1/2 z-[2147483000] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-full border py-1 pl-1 pr-1 shadow-[0_10px_28px_rgba(15,23,42,0.18)] backdrop-blur-[14px]"
      style={{
        bottom: "calc(14px + env(safe-area-inset-bottom))",
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-bg-strong)",
        color: "var(--text-main)",
      }}
      role="status"
    >
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white"
        style={{ backgroundImage: "var(--brand-gradient)" }}
        aria-hidden="true"
      >
        <Sparkles size={14} />
      </span>
      <span className="min-w-0 truncate text-[12px] font-medium">
        CutSmart Preview <span style={{ color: "var(--text-muted)" }}>· changes aren&apos;t saved</span>
      </span>
      <button
        type="button"
        onClick={exitPreview}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-semibold text-white transition hover:brightness-105"
        style={{ backgroundImage: "var(--brand-gradient)" }}
      >
        <LogOut size={13} />
        Exit
      </button>
    </div>
  );
}
