"use client";

import { useEffect, useRef } from "react";
import { dimensionSumSteps } from "@/lib/dimension-math";

// Pointing at a cutlist box or cell whose number came from a sum ("720-18"): a small pop-up under it, in every dropdown's
// glass, showing how it was worked out — its box's name in the middle at the top, then each step of the sum in a box of
// its own ("720 − 18 = 702", the next from there), and what it came to. All in the text's own colour. `resolve`
// says, for an element under the pointer (or one of the few round it), which box it is and its sum — null for none.
// Drawn straight onto the page (no re-render), gone as the pointer leaves, on a click, a key, or a scroll. Not on touch.

export type SumTipInfo = { label: string; sum: string };

const SHOW_AFTER_MS = 220;
const GAP_PX = 6;
const EDGE_PX = 8;

export function useSumHoverTip(resolve: (el: HTMLElement) => SumTipInfo | null) {
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  useEffect(() => {
    let tip: HTMLDivElement | null = null;
    let host: HTMLElement | null = null;
    let timer = 0;
    const hide = () => {
      window.clearTimeout(timer);
      host = null;
      if (tip) {
        tip.remove();
        tip = null;
      }
    };
    const show = (el: HTMLElement, info: SumTipInfo) => {
      const worked = dimensionSumSteps(info.sum);
      if (!worked || !el.isConnected) return;
      if (tip) tip.remove();
      tip = document.createElement("div");
      tip.setAttribute("role", "tooltip");
      Object.assign(tip.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        minWidth: "140px",
        maxWidth: "260px",
        padding: "8px 10px",
        borderRadius: "12px",
        border: "1px solid var(--glass-border)",
        backgroundColor: "var(--glass-modal-bg)",
        backdropFilter: "blur(12px) saturate(220%)",
        webkitBackdropFilter: "blur(12px) saturate(220%)",
        boxShadow: "inset 0 0 0 999px color-mix(in srgb, var(--panel-bg) 22%, transparent), var(--shadow-glass)",
        color: "var(--text-main)",
        fontSize: "13px",
        fontWeight: "500",
        lineHeight: "1.35",
        opacity: "0",
        transform: "translateY(-2px)",
        transition: "opacity 120ms ease, transform 160ms ease",
      } as Partial<CSSStyleDeclaration>);
      const line = (into: HTMLElement, text: string, style: Partial<CSSStyleDeclaration>) => {
        const p = document.createElement("p");
        p.textContent = text;
        Object.assign(p.style, { margin: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-main)", ...style });
        into.appendChild(p);
      };
      line(tip, info.label, { fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.6px", textAlign: "center", marginBottom: "6px" });
      // (The working out: each step, in a box.)
      const box = document.createElement("div");
      Object.assign(box.style, {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        padding: "6px 8px",
        borderRadius: "8px",
        border: "1px solid var(--glass-border)",
        backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)",
      } as Partial<CSSStyleDeclaration>);
      for (const step of worked.steps) line(box, step, { fontVariantNumeric: "tabular-nums" });
      tip.appendChild(box);
      line(tip, `= ${worked.answer}`, { fontWeight: "600", textAlign: "center", marginTop: "6px" });
      document.body.appendChild(tip);
      const rect = el.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const left = Math.max(EDGE_PX, Math.min(rect.left + rect.width / 2 - w / 2, window.innerWidth - w - EDGE_PX));
      const below = rect.bottom + GAP_PX;
      const top = below + h <= window.innerHeight - EDGE_PX ? below : Math.max(EDGE_PX, rect.top - GAP_PX - h);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      requestAnimationFrame(() => {
        if (!tip) return;
        tip.style.opacity = "1";
        tip.style.transform = "translateY(0)";
      });
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      let el = e.target as HTMLElement | null;
      let found: SumTipInfo | null = null;
      let at: HTMLElement | null = null;
      for (let i = 0; el && i < 5; i += 1, el = el.parentElement) {
        found = resolveRef.current(el);
        if (found) {
          at = el;
          break;
        }
      }
      if (!found || !at) {
        if (host) hide();
        return;
      }
      if (at === host) return;
      hide();
      host = at;
      const info = found;
      const target = at;
      timer = window.setTimeout(() => show(target, info), SHOW_AFTER_MS);
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);
}
