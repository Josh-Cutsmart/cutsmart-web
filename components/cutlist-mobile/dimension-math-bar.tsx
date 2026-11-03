"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useKeyboardInsetPx } from "@/lib/use-keyboard-inset";
import { evaluateDimensionMath } from "@/lib/dimension-math";

// A phone's number keypad has no + − × ÷, and a page can't add keys to it — so, while a Height / Width / Depth box (a
// cutlist's decimal box — inputMode="decimal") is being typed in with the keyboard up, a bar of them sits just above the
// keyboard: each pressed, typed in where the cursor is (the box keeping the keyboard); = works the sum out there and then
// (as leaving the box does — lib/dimension-math.ts).

const KEYBOARD_OPEN_MIN_PX = 80;
const KEYS: Array<{ label: string; text: string; aria: string }> = [
  { label: "+", text: "+", aria: "Plus" },
  { label: "−", text: "-", aria: "Minus" },
  { label: "×", text: "x", aria: "Times" },
  { label: "÷", text: "/", aria: "Divided by" },
];

function mathField(el: Element | null): HTMLInputElement | null {
  return el instanceof HTMLInputElement && el.inputMode === "decimal" && !el.readOnly && !el.disabled ? el : null;
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
  const { insetPx } = useKeyboardInsetPx();
  const [field, setField] = useState<HTMLInputElement | null>(null);
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
  if (!field || insetPx < KEYBOARD_OPEN_MIN_PX || typeof document === "undefined") return null;

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
      className="fixed inset-x-0 z-[2147483000] flex gap-2 border-t px-3 py-2"
      // Right on top of the keyboard (the space it leaves at the bottom of the screen).
      style={{
        bottom: insetPx,
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
