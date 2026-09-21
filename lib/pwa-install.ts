"use client";

import { useSyncExternalStore } from "react";

// Chrome/Edge-only event — not in TS's built-in DOM lib, so it's declared by hand here rather than
// pulled from `lib.dom.d.ts`.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

// Module-level (not React state) so the `beforeinstallprompt` listener below can be registered the
// moment this module is first imported — anywhere in the app, not just from the one page that ends
// up rendering the install button — since the event can fire at any point during the session and
// is only ever delivered once. `components/app-shell.tsx` imports this file purely for that
// side effect; `usePwaInstall` (below) is how a page actually reads/reacts to the captured state.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let isInstalled = false;
let snapshot = { canInstall: false, isInstalled: false };
const listeners = new Set<() => void>();

function refreshSnapshot() {
  const next = { canInstall: deferredPrompt !== null, isInstalled };
  if (next.canInstall === snapshot.canInstall && next.isInstalled === snapshot.isInstalled) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

if (typeof window !== "undefined") {
  isInstalled = detectStandalone();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    refreshSnapshot();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    isInstalled = true;
    refreshSnapshot();
  });
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return { canInstall: false, isInstalled: false };
}

export function usePwaInstall(): { canInstall: boolean; isInstalled: boolean } {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Single-use: the captured event can only be prompted once, so it's cleared immediately regardless
// of outcome — a second click with nothing captured falls through to "unavailable".
export async function promptPwaInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const prompt = deferredPrompt;
  if (!prompt) return "unavailable";
  deferredPrompt = null;
  refreshSnapshot();
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}

// iOS Safari never fires `beforeinstallprompt` — there is no programmatic install API there, only
// the manual Share -> Add to Home Screen flow, so callers use this to show instructions instead of
// a button that would otherwise silently do nothing.
export function isIosDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent || "";
  const isIosUa = /iPad|iPhone|iPod/.test(ua);
  const isIpadOsDesktopMode = window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  return isIosUa || isIpadOsDesktopMode;
}
