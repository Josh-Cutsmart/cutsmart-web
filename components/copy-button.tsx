"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Copy } from "lucide-react";
import { haptic } from "@/lib/haptics";

// Text onto the clipboard — the Clipboard API, or (an older browser, or a page not on https) a hidden text box and the
// old copy command. Whether it worked.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Not allowed here — the fallback below.
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    Object.assign(box.style, { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none" });
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  } catch {
    return false;
  }
}

// A small, quiet copy button for beside a phone number, email or address: a faint copy icon that turns into a green tick
// for a moment once it's copied (and a light tap on a phone). Nothing to copy — not shown.
export function CopyButton({
  value,
  label,
  size = 13,
  className = "",
  style,
}: {
  value: string;
  // What it copies, for its tooltip and screen readers: "phone number", "email", "address".
  label: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );
  const text = value.trim();
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={async (e) => {
        // (Often inside a link or a clickable card — the copy's all it does.)
        e.preventDefault();
        e.stopPropagation();
        if (!(await copyToClipboard(text))) return;
        haptic("tap");
        setCopied(true);
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 1400);
      }}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)] ${className}`}
      style={{ color: copied ? "#16A34A" : "var(--text-muted)", ...style }}
      aria-label={copied ? `${label[0].toUpperCase()}${label.slice(1)} copied` : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
    >
      {copied ? <Check size={size} strokeWidth={2.6} /> : <Copy size={size} />}
    </button>
  );
}
