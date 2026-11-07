"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { evaluateDimensionMath } from "@/lib/dimension-math";

// A phone's number keypad has no + − × ÷, and a page can't add keys to it — so, while a box of a cutlist's numbers
// (inputMode decimal or numeric, not one marked data-no-math) is being typed in with the keyboard up, a bar of them sits
// just above the keyboard: each pressed, typed in where the cursor is (the box keeping the keyboard); = works the sum out
// there and then (as leaving the box does — lib/dimension-math.ts).
//
// Where it sits comes from the visible area itself, measured every frame while it's up. Set once from the browser's
// viewport events, it was left behind: those can arrive late, or only once a scroll has stopped, so it floated away from
// the keyboard whenever the page moved under it. And a phone that shrinks the whole page for the keyboard (rather than
// covering it) never counted as having a keyboard up, so it didn't show at all.

const KEYBOARD_OPEN_MIN_PX = 80;
const KEYS: Array<{ label: string; text: string; aria: string }> = [
  { label: "+", text: "+", aria: "Plus" },
  { label: "−", text: "-", aria: "Minus" },
  { label: "×", text: "x", aria: "Times" },
  { label: "÷", text: "/", aria: "Divided by" },
];

function mathField(el: Element | null): HTMLInputElement | null {
  return el instanceof HTMLInputElement && (el.inputMode === "decimal" || el.inputMode === "numeric") && !el.dataset.noMath && !el.readOnly && !el.disabled ? el : null;
}

// Its new value, as if typed (its onChange runs), the cursor put where it should be after.
function setFieldValue(field: HTMLInputElement, value: string, caret: number) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setValue) return;
  setValue.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  requestAnimationFrame(() => {
    try {
      const at = Math.min(caret, field.value.length);
      field.setSelectionRange(at, at);
    } catch {
      // (A box that doesn't take a cursor position: left where it is.)
    }
  });
}

export function DimensionMathBar() {
  const [field, setField] = useState<HTMLInputElement | null>(null);
  const [keyboardUp, setKeyboardUp] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  // Whether the visible area's shorter than the screen's been at this width (it was its full height before the keyboard
  // came up): true of a phone covering the page with the keyboard and of one shrinking the page for it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let width = 0;
    let tallest = 0;
    const measure = () => {
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        tallest = 0;
      }
      const visible = vv.height * vv.scale;
      tallest = Math.max(tallest, visible, window.innerHeight);
      setKeyboardUp(tallest - visible >= KEYBOARD_OPEN_MIN_PX);
    };
    measure();
    vv.addEventListener("resize", measure);
    window.addEventListener("resize", measure);
    return () => {
      vv.removeEventListener("resize", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);
  const showing = Boolean(field) && keyboardUp;
  // On the bottom edge of what's visible, every frame while it's showing (and the right size for it, should the page be
  // pinched in).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!showing || !vv) return;
    let frame = 0;
    const place = () => {
      const bar = barRef.current;
      if (bar) {
        const scale = vv.scale || 1;
        bar.style.width = `${vv.width * scale}px`;
        bar.style.transform = `translate(${vv.offsetLeft}px, ${vv.offsetTop + vv.height - bar.offsetHeight / scale}px) scale(${1 / scale})`;
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [showing]);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => setField(mathField(event.target as Element | null));
    // (Focus moving on to another box comes as focusout then focusin — checked once it's landed.)
    const onFocusOut = () => window.setTimeout(() => setField(mathField(document.activeElement)), 0);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  if (!field || !showing || typeof document === "undefined") return null;

  const type = (text: string) => {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    setFieldValue(field, `${field.value.slice(0, start)}${text}${field.value.slice(end)}`, start + text.length);
  };
  const equals = () => {
    const answer = evaluateDimensionMath(field.value);
    if (answer != null) setFieldValue(field, answer, answer.length);
  };
  const keyClass =
    "glass-shine glass-shine-neutral inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-[12px] border text-[22px] font-medium leading-none active:scale-95";

  return createPortal(
    <div
      ref={barRef}
      className="fixed left-0 top-0 z-[2147483000] flex origin-top-left gap-2 border-t px-3 py-2 will-change-transform"
      style={{
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-bg-strong)",
        backdropFilter: "blur(14px) saturate(220%)",
        WebkitBackdropFilter: "blur(14px) saturate(220%)",
      }}
      // (Pressing it never takes the cursor out of the box — the keyboard stays.)
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
    >
      {KEYS.map((key) => (
        <button
          key={key.text}
          type="button"
          tabIndex={-1}
          aria-label={key.aria}
          onPointerDown={(event) => {
            event.preventDefault();
            type(key.text);
          }}
          className={keyClass}
          style={{ borderColor: "var(--glass-border)", color: "var(--text-main)" }}
        >
          {key.label}
        </button>
      ))}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Work it out"
        onPointerDown={(event) => {
          event.preventDefault();
          equals();
        }}
        className="glass-shine inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-[12px] border text-[22px] font-medium leading-none text-white active:scale-95"
        style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
      >
        =
      </button>
    </div>,
    document.body,
  );
}
