import type { CSSProperties } from "react";

// A pop-up themed by a colour — its category's, its column's (the calendar's event pop-up, a board column's Automate):
// the glass shine's look (lib/glass-shine.ts), well coloured. The whole pop-up a wash of it (lighter top left, deeper
// bottom right), a glow of it in each of those corners, a fine edge of it and the white top highlight. Put on a layer
// behind everything in the pop-up:
//   <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={popupTintStyle(color)} />
// (the pop-up's panel its own stacking context). Its colour fades when it changes — once registerPopupTint has run.

export const POPUP_TINT_VAR = "--popup-tint";

let popupTintRegistered = false;
// Lets the wash fade between colours (a registered colour property animates; a plain one jumps).
export function registerPopupTint() {
  if (popupTintRegistered || typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") return;
  popupTintRegistered = true;
  try {
    CSS.registerProperty({ name: POPUP_TINT_VAR, syntax: "<color>", inherits: false, initialValue: "transparent" });
  } catch {
    // already registered (e.g. after a hot reload)
  }
}

// color "" = none (no category yet): no wash.
export function popupTintStyle(color: string): CSSProperties {
  const tint = `var(${POPUP_TINT_VAR})`;
  return {
    [POPUP_TINT_VAR]: color || "transparent",
    transition: `${POPUP_TINT_VAR} 360ms ease`,
    borderRadius: "inherit",
    backgroundImage: [
      `radial-gradient(120% 70% at 0% 0%, color-mix(in srgb, ${tint} 34%, transparent), transparent 70%)`,
      `radial-gradient(90% 60% at 100% 100%, color-mix(in srgb, ${tint} 24%, transparent), transparent 70%)`,
      `linear-gradient(145deg, color-mix(in srgb, ${tint} 14%, transparent), color-mix(in srgb, ${tint} 28%, transparent))`,
    ].join(", "),
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tint} 30%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.6)`,
  } as CSSProperties;
}
