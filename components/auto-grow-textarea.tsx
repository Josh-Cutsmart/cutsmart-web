"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

// A text box as tall as what's typed in it: it grows line by line, and shrinks back as lines go. Never shorter than its `rows`.
export function AutoGrowTextarea({ value, className, style, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const lastLength = useRef(-1);

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    // Getting shorter means measuring it from nothing, which would pull up whatever it's in for a moment and lose the place it was
    // scrolled to: so that's kept. Getting longer it can just be measured.
    const shorter = value.length < lastLength.current || lastLength.current < 0;
    lastLength.current = value.length;
    if (shorter) {
      const kept: Array<[HTMLElement, number]> = [];
      for (let node = box.parentElement; node; node = node.parentElement) {
        if (node.scrollTop > 0) kept.push([node, node.scrollTop]);
      }
      box.style.height = "auto";
      box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
      kept.forEach(([node, top]) => {
        node.scrollTop = top;
      });
    } else if (box.scrollHeight > box.clientHeight) {
      box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
    }
  }, [value]);

  return <textarea {...rest} ref={ref} value={value} className={className} style={{ resize: "none", overflow: "hidden", ...style }} />;
}
