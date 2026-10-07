"use client";

import { useEffect } from "react";
import { authorizedFetch } from "@/lib/api-fetch";
import { isIosDevice } from "@/lib/pwa-install";

// Phone/desktop notifications, device side (web push — the server side is lib/push-server.ts). They're
// turned on per device (User Settings > Phone & Desktop Notifications): the browser asks permission,
// the device gets a push address from its push service, and that address is stored for the signed-in
// user. Every notification added to someone's Notifications list (addUserNotification) is then also
// sent to their devices — the kinds they haven't switched off.
//
// iPhone/iPad: only for CutSmart added to the Home Screen (Safari > Share > Add to Home Screen) and
// opened from there, on iOS 16.4 or later; permission can only be asked from a tap inside it.

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const VAPID_PUBLIC_KEY = String(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();

// "on"/"off": whether this device gets them; "blocked": turned off for CutSmart in the browser's or
// phone's own settings; "needs-install": an iPhone/iPad not using the Home Screen app; "unsupported": a
// browser without notifications; "unconfigured": the app's push keys aren't set up.
export type PushDeviceStatus = "on" | "off" | "blocked" | "needs-install" | "unsupported" | "unconfigured";

function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

// A name for the device in the user's list ("iPhone", "Android phone", "Windows PC", …).
function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux PC";
  return "Device";
}

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
// The service worker (public/sw.js) that shows notifications and opens the app when one is tapped.
export function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return Promise.resolve(null);
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        registrationPromise = null;
        return null;
      });
  }
  return registrationPromise;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await registerPushServiceWorker();
  return registration ? registration.pushManager.getSubscription().catch(() => null) : null;
}

async function saveSubscription(subscription: PushSubscription, mode: "enable" | "refresh"): Promise<boolean> {
  const response = await authorizedFetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), mode, deviceLabel: deviceLabel() }),
  }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as { ok?: boolean; active?: boolean } | null;
  return Boolean(response?.ok && json?.ok && json.active);
}

// Whether this device gets notifications for the signed-in user (and if not, why not).
export async function readPushDeviceStatus(): Promise<PushDeviceStatus> {
  if (typeof window === "undefined") return "unsupported";
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (isIosDevice() && !isStandalone()) return "needs-install";
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  const subscription = await currentSubscription();
  if (!subscription) return "off";
  return (await saveSubscription(subscription, "refresh")) ? "on" : "off";
}

// Turns them on here. Call it straight from a tap — iPhones only let a web app ask then.
export async function enablePushOnThisDevice(): Promise<PushDeviceStatus> {
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (isIosDevice() && !isStandalone()) return "needs-install";
  if (!isPushSupported()) return "unsupported";
  // Asked first, before anything else is awaited, so it still counts as coming from the tap.
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";
  const registration = await registerPushServiceWorker();
  if (!registration) return "unsupported";
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch {
      return "off";
    }
  }
  return (await saveSubscription(subscription, "enable")) ? "on" : "off";
}

// Turns them off here (also on sign-out, so the next person to sign in on this device doesn't get them).
export async function disablePushOnThisDevice(): Promise<void> {
  if (!isPushSupported()) return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  await authorizedFetch("/api/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => null);
  await subscription.unsubscribe().catch(() => false);
}

// When the app opens: keeps this device's push address current (they can change) — only if it's
// already this user's — and clears the unread badge on the app icon.
export async function refreshPushOnAppOpen(): Promise<void> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) return;
  await registerPushServiceWorker();
  clearAppIconBadge();
  if (Notification.permission !== "granted") return;
  const subscription = await currentSubscription();
  if (subscription) await saveSubscription(subscription, "refresh");
}

export function clearAppIconBadge(): void {
  const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
  nav.clearAppBadge?.().catch(() => undefined);
}

// "Send a test" — to this user's own devices: "" when a device got it, else why not.
export async function sendTestPush(): Promise<"" | "not-configured" | "no-devices" | "failed"> {
  const response = await authorizedFetch("/api/push/test", { method: "POST" }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as { ok?: boolean; reason?: string; sent?: number } | null;
  if (json?.ok) return "";
  if (json?.reason === "not-configured" || json?.reason === "no-database") return "not-configured";
  if (json?.reason === "no-devices") return "no-devices";
  return "failed";
}

// After addUserNotification stores a notification in someone's list: send it to their devices too
// (fire and forget — the server checks it's real, new, and theirs to get).
export function requestPushForNotification(recipientUid: string, notificationId: string, companyId?: string): void {
  if (!VAPID_PUBLIC_KEY) return;
  let activeCompanyId = String(companyId || "").trim();
  if (!activeCompanyId) {
    try {
      activeCompanyId = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
    } catch {
      activeCompanyId = "";
    }
  }
  void authorizedFetch("/api/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipientUid, notificationId, companyId: activeCompanyId }),
    keepalive: true,
  }).catch(() => null);
}

// For the app shell: once someone's signed in, keep this device's notifications current, and clear the
// app icon's unread badge whenever the app is opened or brought back up.
export function usePushNotificationsOnAppOpen(uid: string | undefined): void {
  useEffect(() => {
    if (!uid) return;
    void refreshPushOnAppOpen();
    checkCalendarRemindersNow();
    const reminderTimer = window.setInterval(checkCalendarRemindersNow, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearAppIconBadge();
      checkCalendarRemindersNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(reminderTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [uid]);
}

// Calendar reminders are sent by a scheduled job (app/api/cron/calendar-reminders); as a backup, an open
// app asks for its company to be checked too (the server does it at most every 5 minutes per company).
function checkCalendarRemindersNow(): void {
  if (document.visibilityState === "hidden") return;
  let companyId = "";
  try {
    companyId = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
  } catch {
    companyId = "";
  }
  if (!companyId) return;
  void authorizedFetch("/api/push/reminders-tick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId }),
  }).catch(() => null);
}
