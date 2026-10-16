import type { CSSProperties } from "react";

// The glass shine (app/globals.css .glass-shine) — the app's shared finish for a coloured button, pill or container.
// Use with className "glass-shine", and style from here:
//   glassShineStyle("#E8721C")                 — just its colour (for a container, a button with no colour of its own…)
//   glassShineStyle("#E8721C", { padding: 8 }) — its colour, plus other style
//   glassShineStyle(pillStyle)                 — an existing style: the colour is its backgroundColor (fallback: grey)
// For a container with text on it (a card, a panel), add "glass-shine-soft" too: just a light wash of the colour.
// For no colour at all, add "glass-shine-neutral" instead: the white edge, highlight and shadow on the plain panel.
export function glassShineStyle(colorOrStyle: string | CSSProperties, extra?: CSSProperties): CSSProperties {
  if (typeof colorOrStyle === "string") {
    return { ...extra, "--shine-color": colorOrStyle } as CSSProperties;
  }
  return { ...colorOrStyle, ...extra, "--shine-color": String(colorOrStyle.backgroundColor || "#64748B") } as CSSProperties;
}
