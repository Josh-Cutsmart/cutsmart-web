import { createHash } from "crypto";
import webpush from "web-push";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  isPushNotificationTypeEnabled,
  normalizePushQuietMinutes,
  pushGroupPhrase,
  pushNotificationBody,
  pushNotificationUrl,
} from "@/lib/push-notification-types";

// Server side of phone/desktop notifications (web push — see lib/push-client.ts for the device side).
// Each device that turned notifications on is a doc in the top-level `pushSubscriptions` collection
// (server-only: no client rules, so nobody can read another person's devices), keyed by a hash of its
// push address, so one device only ever belongs to one user — whoever turned them on there last.

export const PUSH_SUBSCRIPTIONS_COLLECTION = "pushSubscriptions";

export function pushSubscriptionDocId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 40);
}

let configuredSubject = "";
// The keys come from the environment (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). VAPID_SUBJECT is
// a contact for the push services (mailto: or https:) — without one, the site's own address is used, or
// on a local dev server (plain http://localhost, which the push services don't accept) a stand-in.
function configureWebPush(siteOrigin: string): boolean {
  const publicKey = String(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  if (!publicKey || !privateKey) return false;
  const envSubject = String(process.env.VAPID_SUBJECT || "").trim();
  const subject = /^(mailto:|https:\/\/)/i.test(envSubject)
    ? envSubject
    : /^https:\/\//i.test(siteOrigin)
      ? siteOrigin
      : "mailto:notifications@cutsmart.local";
  if (configuredSubject !== subject) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configuredSubject = subject;
  }
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  icon?: string;
  badgeCount?: number;
  // Buttons on the notification (Android and computers — iPhones don't show them): tapping one makes
  // the service worker (public/sw.js) POST { token: actionToken, decision: action } to actionUrl.
  actions?: Array<{ action: string; title: string }>;
  actionUrl?: string;
  actionToken?: string;
};
export type PushSendResult = { sent: number; removed: number; failed: number; reason?: string };

// ---- Time between notifications (User Settings — users/{uid}.pushQuietMinutes): after a notification
// reaches someone's devices, any more within that time are held in pushThrottle/{uid} (server-only) and
// go out together as one when it's up ("10 new leads") — from the next notification after it, or the
// scheduled job (flushDuePushDigests, app/api/cron/notifications). Ones with buttons (unlock requests)
// aren't held, so their buttons still work.

const PUSH_THROTTLE_COLLECTION = "pushThrottle";
// How many held notifications are kept word for word (the count keeps going past it).
const MAX_HELD = 50;

type HeldPush = { type: string; title: string; body: string; url: string; atMs: number };

// One notification standing for several: "10 new leads" (with the latest few), or for a mix,
// "5 new notifications" / "3 new leads · 2 quotes accepted".
function groupedPayload(held: HeldPush[], total: number): PushPayload {
  if (held.length === 1 && total === 1) {
    return { title: held[0].title, body: held[0].body, url: held[0].url, tag: "cutsmart-group" };
  }
  const types = Array.from(new Set(held.map((item) => item.type)));
  const urls = Array.from(new Set(held.map((item) => item.url)));
  const clip = (text: string) => (text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text);
  if (types.length === 1) {
    const phrase = pushGroupPhrase(types[0], total);
    const latest = held.slice(-3).reverse().map((item) => item.body || item.title).filter(Boolean);
    const more = total - latest.length;
    return {
      title: phrase.charAt(0).toUpperCase() + phrase.slice(1),
      body: clip(`${latest.join(" · ")}${more > 0 ? ` · and ${more} more` : ""}`),
      url: urls.length === 1 ? urls[0] : types[0].startsWith("lead_") ? "/leads" : "/dashboard",
      tag: "cutsmart-group",
    };
  }
  const counts = types
    .map((type) => ({ type, count: held.filter((item) => item.type === type).length }))
    .sort((a, b) => b.count - a.count);
  return {
    title: `${total} new notifications`,
    body: clip(counts.map(({ type, count }) => pushGroupPhrase(type, count)).join(" · ")),
    url: urls.length === 1 ? urls[0] : "/dashboard",
    tag: "cutsmart-group",
  };
}

// Sends to every device the user turned notifications on for, unless they've switched this kind of
// notification off (skipChoices: the settings page's test), or it's within their time between
// notifications (then it's held — skipQuiet: send now regardless). Devices the push service says no
// longer exist (the app was removed, notifications were turned off in the phone's settings, …) are deleted.
export async function sendPushToUser(
  uid: string,
  payload: PushPayload,
  options: { type: string; siteOrigin: string; skipChoices?: boolean; skipQuiet?: boolean },
): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, removed: 0, failed: 0 };
  const userId = String(uid || "").trim();
  if (!adminDb || !userId) return { ...result, reason: "no-database" };
  if (!configureWebPush(options.siteOrigin)) return { ...result, reason: "not-configured" };
  const db = adminDb;
  const [userSnap, subsSnap] = await Promise.all([
    db.collection("users").doc(userId).get(),
    db.collection(PUSH_SUBSCRIPTIONS_COLLECTION).where("uid", "==", userId).get(),
  ]);
  if (subsSnap.empty) return { ...result, reason: "no-devices" };
  if (!options.skipChoices && !isPushNotificationTypeEnabled(userSnap.data()?.pushNotificationTypes, options.type)) {
    return { ...result, reason: "type-off" };
  }

  let toSend = payload;
  const quietMs = options.skipQuiet || payload.actions?.length ? 0 : normalizePushQuietMinutes(userSnap.data()?.pushQuietMinutes) * 60_000;
  if (quietMs > 0) {
    const throttleRef = db.collection(PUSH_THROTTLE_COLLECTION).doc(userId);
    const item: HeldPush = { type: options.type, title: payload.title, body: payload.body, url: payload.url, atMs: Date.now() };
    const decision = await db.runTransaction(async (tx) => {
      const snap = await tx.get(throttleRef);
      const state = (snap.data() ?? {}) as Record<string, unknown>;
      const lastSentMs = Number(state.lastSentMs) || 0;
      const held = Array.isArray(state.held) ? (state.held as HeldPush[]) : [];
      const heldCount = Number(state.heldCount) || held.length;
      const now = Date.now();
      if (now < lastSentMs + quietMs) {
        // Still within the time since the last one: hold it, to go out when that time's up.
        tx.set(throttleRef, {
          lastSentMs,
          held: [...held, item].slice(-MAX_HELD),
          heldCount: heldCount + 1,
          flushAtMs: lastSentMs + quietMs,
        });
        return { hold: true as const };
      }
      tx.set(throttleRef, { lastSentMs: now, held: [], heldCount: 0, flushAtMs: FieldValue.delete() }, { merge: true });
      return { hold: false as const, held, heldCount };
    });
    if (decision.hold) return { ...result, reason: "held" };
    // Anything still held from before goes out together with this one.
    if (decision.heldCount > 0) toSend = groupedPayload([...decision.held, item], decision.heldCount + 1);
  }

  // The app icon's badge: how many notifications they haven't read yet.
  let badgeCount = toSend.badgeCount;
  if (badgeCount === undefined) {
    try {
      const unread = await db.collection("users").doc(userId).collection("notifications").where("read", "==", false).count().get();
      badgeCount = unread.data().count;
    } catch {
      badgeCount = undefined;
    }
  }
  const body = JSON.stringify({ icon: "/icon-192.png", ...toSend, ...(badgeCount !== undefined ? { badgeCount } : {}) });
  await Promise.all(
    subsSnap.docs.map(async (docSnap) => {
      const data = docSnap.data() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!data.endpoint || !data.keys?.p256dh || !data.keys?.auth) {
        await docSnap.ref.delete().catch(() => undefined);
        result.removed += 1;
        return;
      }
      try {
        await webpush.sendNotification(
          { endpoint: data.endpoint, keys: { p256dh: data.keys.p256dh, auth: data.keys.auth } },
          body,
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
        result.sent += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await docSnap.ref.delete().catch(() => undefined);
          result.removed += 1;
        } else {
          result.failed += 1;
        }
      }
    }),
  );
  return result;
}

// Sends what's been held for everyone whose time between notifications is up (when nothing new came in
// to carry it out) — called by the scheduled job and, as a backup, by any open app.
export async function flushDuePushDigests(siteOrigin: string): Promise<number> {
  if (!adminDb) return 0;
  const db = adminDb;
  const now = Date.now();
  const due = await db.collection(PUSH_THROTTLE_COLLECTION).where("flushAtMs", "<=", now).limit(200).get();
  let flushed = 0;
  for (const docSnap of due.docs) {
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(docSnap.ref);
      const state = (fresh.data() ?? {}) as Record<string, unknown>;
      const held = Array.isArray(state.held) ? (state.held as HeldPush[]) : [];
      const heldCount = Number(state.heldCount) || held.length;
      if (!(Number(state.flushAtMs) <= now) || !held.length) return null;
      // Counts as a send: the next one waits the full time again.
      tx.set(docSnap.ref, { lastSentMs: now, held: [], heldCount: 0, flushAtMs: FieldValue.delete() }, { merge: true });
      return { held, heldCount };
    });
    if (!claimed) continue;
    await sendPushToUser(docSnap.id, groupedPayload(claimed.held, claimed.heldCount), {
      type: "group",
      siteOrigin,
      skipChoices: true,
      skipQuiet: true,
    }).catch(() => undefined);
    flushed += 1;
  }
  return flushed;
}

// Sends a notification that's already in someone's Notifications list (users/{uid}/notifications) to
// their devices — once: it's stamped pushedAtIso, so asking again does nothing.
export async function pushStoredNotification(
  uid: string,
  notificationId: string,
  siteOrigin: string,
): Promise<PushSendResult & { skipped?: string }> {
  const empty = { sent: 0, removed: 0, failed: 0 };
  if (!adminDb) return { ...empty, reason: "no-database" };
  const ref = adminDb.collection("users").doc(uid).collection("notifications").doc(notificationId);
  const claimed = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    if (data.pushedAtIso) return null;
    tx.update(ref, { pushedAtIso: new Date().toISOString() });
    return data;
  });
  if (!claimed) return { ...empty, skipped: "missing-or-already-sent" };
  return sendPushToUser(
    uid,
    {
      title: String(claimed.title || "CutSmart").trim() || "CutSmart",
      body: pushNotificationBody(claimed),
      url: pushNotificationUrl(claimed),
      tag: notificationId,
    },
    { type: String(claimed.type || ""), siteOrigin },
  );
}

// Whether `uid` belongs to `companyId` (a membership doc, or an older account's own user doc naming it).
export async function isCompanyMemberUid(companyId: string, uid: string): Promise<boolean> {
  if (!adminDb || !companyId || !uid) return false;
  const [membershipSnap, userSnap] = await Promise.all([
    adminDb.collection("companies").doc(companyId).collection("memberships").doc(uid).get(),
    adminDb.collection("users").doc(uid).get(),
  ]);
  return membershipSnap.exists || String(userSnap.data()?.companyId ?? "").trim() === companyId;
}

// Adds a notification to someone's Notifications list from the server (what addUserNotification does in
// the app) and sends it to their devices. Never throws — a notification is always a side-effect.
export async function addNotificationAndPush(
  uid: string,
  fields: { title: string; message: string; type: string; projectId?: string; leadId?: string; companyId?: string },
  siteOrigin: string,
): Promise<void> {
  if (!adminDb || !uid) return;
  try {
    const nowIso = new Date().toISOString();
    const ref = await adminDb.collection("users").doc(uid).collection("notifications").add({
      title: fields.title,
      message: fields.message,
      type: fields.type,
      projectId: fields.projectId || null,
      leadId: fields.leadId || null,
      companyId: fields.companyId || null,
      read: false,
      createdAt: new Date(nowIso),
      createdAtIso: nowIso,
    });
    await pushStoredNotification(uid, ref.id, siteOrigin);
  } catch (error) {
    console.error("[addNotificationAndPush] failed:", error);
  }
}
