import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { isCompanyMemberUid, pushStoredNotification } from "@/lib/push-server";

// Sends a notification that was just added to someone's Notifications list (by addUserNotification in
// lib/firestore-data.ts) to their phone/desktop. Only the notification's id travels here — its text is
// read from the stored notification, it's only sent once, only while it's new, and only by the person
// themselves or someone in the same company as them.

const MAX_AGE_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const senderUid = await verifyBearerUid(request);
  if (!senderUid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { recipientUid?: unknown; notificationId?: unknown; companyId?: unknown };
  const recipientUid = String(body.recipientUid ?? "").trim();
  const notificationId = String(body.notificationId ?? "").trim();
  if (!recipientUid || !notificationId || recipientUid.includes("/") || notificationId.includes("/")) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }

  const snap = await adminDb.collection("users").doc(recipientUid).collection("notifications").doc(notificationId).get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: "notification-not-found" }, { status: 404 });
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  // "New version" notifications are only pushed by Publish, from the server (lib/app-version-server.ts) — one
  // an older copy of the app made itself (the old way of announcing a version) isn't.
  if (String(data.type ?? "") === "app_version") return NextResponse.json({ ok: true, skipped: "app-version" });
  const createdMs = Date.parse(String(data.createdAtIso ?? ""));
  if (!Number.isFinite(createdMs) || Date.now() - createdMs > MAX_AGE_MS) {
    return NextResponse.json({ ok: true, skipped: "too-old" });
  }

  if (senderUid !== recipientUid) {
    // The notification's own company, else the sender's current one — both must be in it.
    const companyId = String(data.companyId ?? "").trim() || String(body.companyId ?? "").trim();
    const allowed =
      Boolean(companyId) &&
      (await Promise.all([isCompanyMemberUid(companyId, senderUid), isCompanyMemberUid(companyId, recipientUid)])).every(Boolean);
    if (!allowed) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const result = await pushStoredNotification(recipientUid, notificationId, new URL(request.url).origin);
  return NextResponse.json({ ok: true, ...result });
}
