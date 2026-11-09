"use client";

import { useEffect } from "react";
import { layOutNzMobile, phoneParts } from "@/lib/phone-format";

// Every phone number box in the app (type="tel", or the phone keypad — inputmode="tel"): a New Zealand mobile laid out as
// it's typed or pasted — 021 066 4812, or 6421 066 4812 with the country code, extra digits always on the end group
// (lib/phone-format.ts). Anything that isn't a mobile (a landline, 0800) is left as it's typed. The cursor stays with the
// digit it was by; deleting a space deletes the digit beside it (the space would only come straight back). Done before
// the page sees the typing (capture), so the page's own value is the laid-out one. Not a box marked data-no-phone-format.

function isPhoneBox(el: EventTarget | null): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.disabled || el.readOnly || el.closest("[data-no-phone-format]")) return false;
  return el.type === "tel" || el.getAttribute("inputmode") === "tel";
}

const digitCount = (text: string) => text.replace(/\D/g, "").length;

// Where the cursor goes in `text`: just after its `digits`-th digit (or after the + with none before it).
function caretAfterDigits(text: string, digits: number): number {
  if (digits <= 0) return text.startsWith("+") ? 1 : 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (/\d/.test(text[index])) {
      seen += 1;
      if (seen === digits) return index + 1;
    }
  }
  return text.length;
}

export function PhoneNumberFormat() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    // Each box's value as it last stood (to tell a deleted space from a deleted digit).
    const lastValue = new WeakMap<HTMLInputElement, string>();

    const onFocus = (event: Event) => {
      if (isPhoneBox(event.target)) lastValue.set(event.target, event.target.value);
    };
    const onInput = (event: Event) => {
      const input = event.target;
      if (!isPhoneBox(input)) return;
      const value = input.value;
      const before = lastValue.get(input) ?? value;
      lastValue.set(input, value);
      const parts = phoneParts(value);
      if (!parts) return;
      let { digits } = parts;
      const caret = input.selectionStart ?? value.length;
      let digitsBeforeCaret = digitCount(value.slice(0, caret));
      // Only a space went (deleting backwards or forwards over it): the digit beside it goes too.
      const inputType = (event as InputEvent).inputType || "";
      const beforeParts = phoneParts(before);
      if (beforeParts && beforeParts.digits === digits && before.length > value.length) {
        if (inputType === "deleteContentBackward" && digitsBeforeCaret > 0) {
          digits = digits.slice(0, digitsBeforeCaret - 1) + digits.slice(digitsBeforeCaret);
          digitsBeforeCaret -= 1;
        } else if (inputType === "deleteContentForward" && digitsBeforeCaret < digits.length) {
          digits = digits.slice(0, digitsBeforeCaret) + digits.slice(digitsBeforeCaret + 1);
        }
      }
      const laidOut = layOutNzMobile(digits, parts.plus);
      if (laidOut === null || laidOut === value) return;
      // (The page's onChange, after this, sees the laid-out value — React's own value tracking included.)
      valueSetter?.call(input, laidOut);
      lastValue.set(input, laidOut);
      const at = caretAfterDigits(laidOut, digitsBeforeCaret);
      try {
        input.setSelectionRange(at, at);
      } catch {
        // (A box that doesn't take a cursor position.)
      }
    };
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("input", onInput, true);
    return () => {
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("input", onInput, true);
    };
  }, []);
  return null;
}
