import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { NOTIFICATION_REMINDERS_COLLECTION } from "@/lib/push-server";

// "Remind me in…" on one of your own notifications (the top bar's Notifications menu): the scheduled job
// sends it to your phone/desktop again at that time (flushDueNotificationReminders in lib/push-server.ts).
// The notification itself is hidden until then by the app (snoozeUserNotification in lib/firestore-data.ts).
// Asking again for the same notification moves its reminder.

const MIN_AHEAD_MS = 60 * 1000;
const MAX_AHEAD_MS = 60 * 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const uid = await verifyBearerUid(request);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { notificationId?: unknown; dueAtMs?: unknown };
  const notificationId = String(body.notificationId ?? "").trim();
  const dueAtMs = Number(body.dueAtMs);
  if (!notificationId || notificationId.includes("/") || !Number.isFinite(dueAtMs)) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }
  const ahead = dueAtMs - Date.now();
  if (ahead < MIN_AHEAD_MS || ahead > MAX_AHEAD_MS) {
    return NextResponse.json({ ok: false, error: "out-of-range" }, { status: 400 });
  }

  // Only your own notifications.
  const snap = await adminDb.collection("users").doc(uid).collection("notifications").doc(notificationId).get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: "notification-not-found" }, { status: 404 });

  await adminDb
    .collection(NOTIFICATION_REMINDERS_COLLECTION)
    .doc(`${uid}_${notificationId}`)
    .set({ uid, notificationId, dueAtMs, createdAtIso: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
