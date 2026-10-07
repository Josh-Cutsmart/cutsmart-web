"use client";

import { useSyncExternalStore } from "react";
import { authorizedFetch } from "@/lib/api-fetch";

// Dev mode, for the Dev users in public/dev-emails.txt only (components/dev-mode.tsx checks the signed-in
// user and turns it on/off — 5 taps within a second, or the tiny "dev" button on a computer). On or off is
// remembered on this device. While on, User Settings' notification rows get "test" buttons.

const STORAGE_KEY = "cutsmart-dev-mode";

let devUser = false;
let on: boolean | null = null;
const listeners = new Set<() => void>();

function isOn(): boolean {
  if (on === null) {
    try {
      on = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      on = false;
    }
  }
  return on;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDevUser(yes: boolean) {
  if (devUser === yes) return;
  devUser = yes;
  notify();
}

export function toggleDevMode() {
  on = !isOn();
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembered — still on/off until the page reloads.
  }
  notify();
}

// Whether the signed-in user is a Dev user.
export function useIsDevUser(): boolean {
  return useSyncExternalStore(subscribe, () => devUser, () => false);
}

// Whether dev mode is on (and they're a Dev user).
export function useDevModeOn(): boolean {
  return useSyncExternalStore(subscribe, () => devUser && isOn(), () => false);
}

// The dev controls' look: small and faint, darker on hover (or always, when `active`).
export function devButtonClass(active = false): string {
  return `rounded-[6px] border px-1.5 py-px text-[10px] font-semibold leading-[14px] transition ${active ? "opacity-100" : "opacity-60 hover:opacity-100"}`;
}

const SEND_ERRORS: Record<string, string> = {
  "no-devices": "no devices",
  "not-configured": "not set up",
  "not-dev": "not a dev",
};

// Sends one test notification (a kind from lib/push-notification-types.ts, or a grouped one from
// lib/push-dev-test.ts) to the user's own devices, now or after `delaySeconds` — app/api/push/dev-test.
export async function sendDevTest(sample: string, delaySeconds = 0): Promise<{ ok: boolean; text: string }> {
  try {
    const response = await authorizedFetch("/api/push/dev-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sample, delaySeconds }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; reason?: string; error?: string };
    if (result.ok) return { ok: true, text: "sent" };
    return { ok: false, text: SEND_ERRORS[result.reason || result.error || ""] ?? "failed" };
  } catch {
    return { ok: false, text: "failed" };
  }
}
