"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";

// A setting's explanation, on tap (User Settings on a phone, instead of a line of small print under every row): a glass
// bubble under the row — over it if there isn't room below. Any press anywhere closes it, on the bubble too, and that
// press does nothing else (it doesn't toggle or open whatever it landed on). Scrolling closes it as well.

type Shown = { text: ReactNode; rect: DOMRect };

export function useHelpBubble() {
  const [shown, setShown] = useState<Shown | null>(null);
  const show = useCallback((text: ReactNode, from: HTMLElement) => setShown({ text, rect: from.getBoundingClientRect() }), []);
  const close = useCallback(() => setShown(null), []);
  const bubble = shown ? <HelpBubble text={shown.text} rect={shown.rect} onClose={close} /> : null;
  return { show, close, bubble };
}

function HelpBubble({ text, rect, onClose }: { text: ReactNode; rect: DOMRect; onClose: () => void }) {
  useEffect(() => {
    const onPress = () => {
      onClose();
      swallowNextClick();
    };
    const onScroll = () => onClose();
    // (Next press on: the tap that opened it has already gone by.)
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPress, true);
      window.addEventListener("scroll", onScroll, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);
  if (typeof document === "undefined") return null;
  const below = rect.bottom + 140 < window.innerHeight;
  return createPortal(
    <div
      role="tooltip"
      className="glass-menu-squeeze fixed left-4 right-4 z-[2147483000] mx-auto max-w-[420px] rounded-[16px] border px-4 py-3 text-[13.5px] font-medium leading-snug shadow-[0_12px_30px_rgba(15,23,42,0.16)]"
      style={{
        ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
        transformOrigin: below ? "50% 0%" : "50% 100%",
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-modal-bg)",
        backdropFilter: "blur(16px) saturate(200%)",
        WebkitBackdropFilter: "blur(16px) saturate(200%)",
        color: "var(--text-main)",
      }}
    >
      {text}
    </div>,
    document.body,
  );
}
