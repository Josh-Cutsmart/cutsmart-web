// A small vibration on phones that can (Android; iPhones' browsers don't let a page vibrate, so nothing happens there):
// "tap" — something done (copied, a pick); "hold" — a press held down long enough to pick something up; "land" — a
// dragged card or event dropped in its new place. Nothing on a computer, or for someone who's asked for reduced motion.
export type HapticKind = "tap" | "hold" | "land";

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  hold: 12,
  land: [10, 40, 16],
};

export function haptic(kind: HapticKind = "tap") {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  // Only for a touch screen — a mouse drop on a laptop that happens to have a vibrator shouldn't buzz.
  if (typeof window !== "undefined" && !window.matchMedia?.("(pointer: coarse)").matches) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Some browsers throw without a recent tap on the page — nothing to do.
  }
}
