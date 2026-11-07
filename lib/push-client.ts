"use client";

import { useEffect } from "react";
import { authorizedFetch } from "@/lib/api-fetch";
import { auth } from "@/lib/firebase";
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

// Whether this person wants notifications on this device: remembered here, by person, from when they turn them on until they
// turn them off themselves. A device takes one person's notifications at a time, so signing out, or someone else turning them
// on here, takes them off it. Without this they stayed off when that person came back, which looked like the switch turning
// itself off. Now they come back on as the app opens (refreshPushOnAppOpen). Someone else signing in here is unaffected: it's
// theirs that's looked at.
const pushWantedKey = (uid: string) => `cutsmart_push_wanted:${uid}`;
function isPushWanted(uid: string): boolean {
  try {
    return Boolean(uid) && window.localStorage.getItem(pushWantedKey(uid)) === "1";
  } catch {
    return false;
  }
}
function rememberPushWanted(uid: string, wanted: boolean): void {
  if (!uid) return;
  try {
    if (wanted) window.localStorage.setItem(pushWantedKey(uid), "1");
    else window.localStorage.removeItem(pushWantedKey(uid));
  } catch {
    // (Not remembered: they stay as they are, and can be turned on again by hand.)
  }
}
const signedInUid = () => String(auth?.currentUser?.uid || "");
// The check as the app opens, while it's running: what's shown waits for it.
let refreshRunning: Promise<void> | null = null;

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

// The server's answer this session for this device's push address — whether notifications are on here for
// the signed-in user (from the refresh when the app opens, or turning them on) — so it isn't asked again.
let serverAnswer: { endpoint: string; active: boolean } | null = null;

// Stores this device's push address for the signed-in user: true/false = whether notifications are now on
// here for them, null = the server couldn't be reached.
async function saveSubscription(subscription: PushSubscription, mode: "enable" | "refresh"): Promise<boolean | null> {
  const response = await authorizedFetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), mode, deviceLabel: deviceLabel() }),
  }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as { ok?: boolean; active?: boolean } | null;
  if (!response?.ok || !json?.ok) return null;
  const active = Boolean(json.active);
  serverAnswer = { endpoint: subscription.endpoint, active };
  return active;
}

// Whether this device gets notifications for the signed-in user (and if not, why not) — straight from the
// device, no waiting on the server: one with a push address counts as on, unless the server has said
// otherwise this session. confirmPushDeviceStatus then checks with the server.
export async function readPushDeviceStatus(): Promise<PushDeviceStatus> {
  if (typeof window === "undefined") return "unsupported";
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (isIosDevice() && !isStandalone()) return "needs-install";
  if (!isPushSupported()) return "unsupported";
  await refreshRunning?.catch(() => undefined);
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  const subscription = await currentSubscription();
  if (!subscription) return "off";
  if (serverAnswer?.endpoint === subscription.endpoint) return serverAnswer.active ? "on" : "off";
  return "on";
}

// The server's word on it (and this device's details kept current there) — asked once a session, usually
// already by the time anyone opens User Settings (refreshPushOnAppOpen). null if it can't be asked or
// reached, so whatever's shown stays.
export async function confirmPushDeviceStatus(): Promise<PushDeviceStatus | null> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY || Notification.permission !== "granted") return null;
  const subscription = await currentSubscription();
  if (!subscription) return null;
  if (serverAnswer?.endpoint === subscription.endpoint) return serverAnswer.active ? "on" : "off";
  const active = await saveSubscription(subscription, "refresh");
  return active === null ? null : active ? "on" : "off";
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
  const on = (await saveSubscription(subscription, "enable")) === true;
  if (on) rememberPushWanted(signedInUid(), true);
  return on ? "on" : "off";
}

// Turns them off here (also on sign-out, so the next person to sign in on this device doesn't get them). byUser: they turned
// the switch off themselves, so they stay off; signing out, they come back on when this person next signs in here.
export async function disablePushOnThisDevice(options?: { byUser?: boolean }): Promise<void> {
  serverAnswer = null;
  if (options?.byUser) rememberPushWanted(signedInUid(), false);
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
export function refreshPushOnAppOpen(uid: string): Promise<void> {
  refreshRunning = refreshPushNow(uid).finally(() => {
    refreshRunning = null;
  });
  return refreshRunning;
}

async function refreshPushNow(uid: string): Promise<void> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) return;
  const registration = await registerPushServiceWorker();
  clearAppIconBadge();
  if (Notification.permission !== "granted") return;
  const subscription = await currentSubscription();
  if (subscription) {
    const active = await saveSubscription(subscription, "refresh");
    // On for them here: remembered (someone who turned them on before this was kept).
    if (active === true) rememberPushWanted(uid, true);
    // Off for them here, but they want them: someone else had this device meanwhile, or the record's gone.
    else if (active === false && isPushWanted(uid)) await saveSubscription(subscription, "enable");
    return;
  }
  // No push address here but they want them: taken off as they signed out, or the phone dropped it. Permission's already
  // given, so no asking. (A phone that won't allow this without a tap: they stay off, and the switch still works.)
  if (!registration || !isPushWanted(uid)) return;
  try {
    const fresh = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    await saveSubscription(fresh, "enable");
  } catch {
    // (As above.)
  }
}

export function clearAppIconBadge(): void {
  const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
  nav.clearAppBadge?.().catch(() => undefined);
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

// "Remind me in…" on one of their own notifications: the scheduled job sends it to their phone/desktop again
// at that time (app/api/push/remind, flushDueNotificationReminders in lib/push-server.ts).
export function requestNotificationReminderPush(notificationId: string, dueAtMs: number): void {
  void authorizedFetch("/api/push/remind", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notificationId, dueAtMs }),
    keepalive: true,
  }).catch(() => null);
}

// For the app shell: once someone's signed in, keep this device's notifications current, and clear the
// app icon's unread badge whenever the app is opened or brought back up.
export function usePushNotificationsOnAppOpen(uid: string | undefined): void {
  useEffect(() => {
    if (!uid) return;
    void refreshPushOnAppOpen(uid);
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
