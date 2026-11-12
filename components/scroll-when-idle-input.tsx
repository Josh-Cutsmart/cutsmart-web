"use client";

import { forwardRef, useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";

// A text box whose words, when they're longer than it and it isn't being typed in, scroll along it — as a long part name
// does in the phone's lists (.marquee-track in globals.css: the words twice, one after the other, sliding by one). Clicked
// into, it's the box as usual, its words where they were. (The scrolling words are laid over the box in its own font and
// colour, its own words hidden under them meanwhile; clicks go straight through to the box.)

type Props = InputHTMLAttributes<HTMLInputElement> & { containerClassName?: string; containerStyle?: CSSProperties };

type Overlay = { left: number; top: number; width: number; height: number; font: CSSProperties; color: string };

export const ScrollWhenIdleInput = forwardRef<HTMLInputElement, Props>(function ScrollWhenIdleInput(
  { containerClassName, containerStyle, onFocus, onBlur, style, value, ...props },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const setRefs = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const text = String(value ?? "");

  // Does it fit? Measured with its words showing (not while they're scrolling over it), again as it changes size.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || focused || !text) {
      setOverlay(null);
      return;
    }
    const measure = () => {
      const box = inputRef.current;
      if (!box) return;
      const cs = getComputedStyle(box);
      const padLeft = Number.parseFloat(cs.paddingLeft) || 0;
      const padRight = Number.parseFloat(cs.paddingRight) || 0;
      const borderLeft = Number.parseFloat(cs.borderLeftWidth) || 0;
      const room = box.clientWidth - padLeft - padRight;
      // (Its words' own width: measured off-screen in its font, as its own scroll width counts its padding too.)
      const probe = document.createElement("span");
      Object.assign(probe.style, {
        position: "absolute",
        visibility: "hidden",
        whiteSpace: "pre",
        font: cs.font,
        letterSpacing: cs.letterSpacing,
      } as Partial<CSSStyleDeclaration>);
      probe.textContent = text;
      document.body.appendChild(probe);
      const wordsWidth = probe.getBoundingClientRect().width;
      probe.remove();
      if (wordsWidth <= room + 0.5) {
        setOverlay(null);
        return;
      }
      setOverlay({
        left: box.offsetLeft + borderLeft + padLeft,
        top: box.offsetTop,
        width: room,
        height: box.offsetHeight,
        font: { font: cs.font, letterSpacing: cs.letterSpacing },
        color: String(style?.color ?? "") || cs.color,
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, focused, style?.color]);

  return (
    <span className={`relative block w-full min-w-0 ${containerClassName ?? ""}`} style={containerStyle}>
      <input
        ref={setRefs}
        value={value}
        {...props}
        style={overlay ? { ...style, color: "transparent", WebkitTextFillColor: "transparent" } : style}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
      />
      {overlay ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute flex items-center overflow-hidden"
          style={{ left: overlay.left, top: overlay.top, width: overlay.width, height: overlay.height, color: overlay.color, ...overlay.font }}
        >
          <span className="marquee-track">
            <span className="whitespace-pre pr-6">{text}</span>
            <span className="whitespace-pre pr-6">{text}</span>
          </span>
        </span>
      ) : null}
    </span>
  );
});
