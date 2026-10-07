"use client";

import { useEffect } from "react";
import { isIosDevice } from "@/lib/pwa-install";

// Safari reads a page's web app manifest only when the document first loads. Arriving at one of the pages
// with its own home-screen app (Calendar, Leads, Contacts — see lib/home-screen-app.ts) from inside the
// app (a client-side navigation) leaves Safari holding the main manifest, so "Add to Home Screen" there
// would save start_url "/" (the dashboard) instead of that page's app. In iOS Safari (not an installed
// app, which has no Add to Home Screen) reload once so the page's own manifest is the one Safari has.
export function HomeScreenManifestReload() {
  useEffect(() => {
    if (!isIosDevice()) return;
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (nav.standalone || window.matchMedia?.("(display-mode: standalone)").matches) return;
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    let loadedPath = "";
    try {
      loadedPath = entry ? new URL(entry.name).pathname : "";
    } catch {
      return;
    }
    if (!loadedPath || loadedPath === window.location.pathname) return;
    window.location.reload();
  }, []);
  return null;
}
