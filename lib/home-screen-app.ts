"use client";

import { useSyncExternalStore } from "react";

// The Calendar, Leads and Contacts pages each have their own home-screen icon (their own web app
// manifests: public/manifest-calendar.json, manifest-leads.json, manifest-contacts.json — linked from the
// page's layout, so "Add to Home Screen" on that page saves that app). Opened from one of those icons, the
// app shows just that page — no sidebars, tab bar or pull-down menu — while the main CutSmart icon (and the
// same pages inside it) keeps the normal app around them.
//
// Every icon opens the same site in standalone mode, so which one was used is read from where this
// session's page first loaded: standalone and first loaded at /calendar = the Calendar icon, and so on.
// It's decided once and remembered for the session (sessionStorage survives a reload but not relaunching
// the app), so reloading while on one of those pages in the main app doesn't turn it into that app.

export type HomeScreenApp = "calendar" | "leads" | "contacts";

const APP_BY_PATH: Record<string, HomeScreenApp> = {
  "/calendar": "calendar",
  "/leads": "leads",
  "/clients": "contacts",
};

const STORAGE_KEY = "cutsmart_home_screen_app";
let decided: HomeScreenApp | "app" | null = null;

function decide(): HomeScreenApp | "app" {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored === "app" || stored === "calendar" || stored === "leads" || stored === "contacts") return stored;
  } catch {
    // storage unavailable — decide from this load
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const standalone = nav.standalone === true || Boolean(window.matchMedia?.("(display-mode: standalone)").matches);
  // Where the document itself loaded (not where client-side navigation has got to since). Without that,
  // there's no telling the icons apart, so it stays the normal app.
  const entries = typeof performance !== "undefined" && performance.getEntriesByType ? performance.getEntriesByType("navigation") : [];
  const entry = entries[0] as PerformanceNavigationTiming | undefined;
  let loadedPath = "";
  try {
    loadedPath = entry?.name ? new URL(entry.name).pathname : "";
  } catch {
    loadedPath = "";
  }
  const app = (standalone && APP_BY_PATH[loadedPath.replace(/\/+$/, "")]) || "app";
  try {
    window.sessionStorage.setItem(STORAGE_KEY, app);
  } catch {
    // ignore
  }
  return app;
}

// Which home-screen app this session is (null: the main CutSmart app, or a browser tab).
export function homeScreenApp(): HomeScreenApp | null {
  if (typeof window === "undefined") return null;
  if (decided === null) decided = decide();
  return decided === "app" ? null : decided;
}

// Never changes within a page's life, so there's nothing to listen for.
const subscribe = () => () => {};

// The same, for rendering: null on the server and while hydrating (so the server and client renders
// match), then the real answer.
export function useHomeScreenApp(): HomeScreenApp | null {
  return useSyncExternalStore(subscribe, homeScreenApp, () => null);
}
