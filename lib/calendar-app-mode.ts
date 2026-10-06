"use client";

import { useSyncExternalStore } from "react";

// The Calendar has its own home-screen icon (public/manifest-calendar.json, start_url /calendar). Opened
// from that icon, the app shows just the calendar — no sidebars, tab bar or pull-down menu — while the main
// CutSmart icon (and the Calendar tab inside it) keeps the normal app around it.
//
// Both icons open the same site in standalone mode, so which one was used is read from where this
// session's page first loaded: standalone and first loaded at /calendar = the Calendar icon. It's decided
// once and remembered for the session (sessionStorage survives a reload but not relaunching the app), so
// reloading while on the Calendar tab in the main app doesn't turn it into the calendar app.
const STORAGE_KEY = "cutsmart_calendar_app_mode";
let decided: boolean | null = null;

function decide(): boolean {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored === "calendar" || stored === "app") return stored === "calendar";
  } catch {
    // storage unavailable — decide from this load
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const standalone = nav.standalone === true || Boolean(window.matchMedia?.("(display-mode: standalone)").matches);
  // Where the document itself loaded (not where client-side navigation has got to since). Without
  // that, there's no telling the two icons apart, so it stays the normal app.
  const entries = typeof performance !== "undefined" && performance.getEntriesByType ? performance.getEntriesByType("navigation") : [];
  const entry = entries[0] as PerformanceNavigationTiming | undefined;
  let loadedPath = "";
  try {
    loadedPath = entry?.name ? new URL(entry.name).pathname : "";
  } catch {
    loadedPath = "";
  }
  const calendarApp = standalone && loadedPath.replace(/\/+$/, "") === "/calendar";
  try {
    window.sessionStorage.setItem(STORAGE_KEY, calendarApp ? "calendar" : "app");
  } catch {
    // ignore
  }
  return calendarApp;
}

export function isCalendarAppMode(): boolean {
  if (typeof window === "undefined") return false;
  if (decided === null) decided = decide();
  return decided;
}

// Never changes within a page's life, so there's nothing to listen for.
const subscribe = () => () => {};

// Whether this session is the Calendar home-screen app. False on the server and while hydrating (so the
// server and client renders match), then the real answer.
export function useCalendarAppMode(): boolean {
  return useSyncExternalStore(subscribe, isCalendarAppMode, () => false);
}
