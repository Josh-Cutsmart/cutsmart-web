"use client";

// CutSmart Preview: the whole app running on a made-up company, with no account. Nothing in it reaches
// the real database — see lib/firebase.ts — and it all disappears when the tab is closed or the
// preview is left. Kept per tab (sessionStorage), so leaving or closing it resets it.

const PREVIEW_FLAG_KEY = "cutsmart_preview";

export function isPreviewMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(PREVIEW_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

// Starts the preview. A full page load, so the app starts up on the preview's own data.
export function enterPreview() {
  try {
    window.sessionStorage.setItem(PREVIEW_FLAG_KEY, "1");
  } catch {
    return;
  }
  window.location.assign("/dashboard");
}

export function exitPreview() {
  try {
    window.sessionStorage.removeItem(PREVIEW_FLAG_KEY);
  } catch {
    // nothing to clear
  }
  window.location.assign("/");
}
