import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { PUSH_SUBSCRIPTIONS_COLLECTION, pushSubscriptionDocId } from "@/lib/push-server";

// This device's phone/desktop notifications (lib/push-client.ts):
// POST { subscription, mode: "enable" } — turn them on here for the signed-in user (the device moves to
//   them if someone else had it before);
// POST { subscription, mode: "refresh" } — keep this device's details current, only if it's already
//   theirs (answers { active } — whether notifications are on here for them);
// DELETE { endpoint } — turn them off here.

type SubscriptionInput = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

function readSubscription(value: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  const sub = (value && typeof value === "object" ? value : {}) as SubscriptionInput;
  const endpoint = String(sub.endpoint ?? "").trim();
  const p256dh = String(sub.keys?.p256dh ?? "").trim();
  const auth = String(sub.keys?.auth ?? "").trim();
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 2000 || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const uid = await verifyBearerUid(request);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { subscription?: unknown; mode?: unknown; deviceLabel?: unknown };
  const subscription = readSubscription(body.subscription);
  if (!subscription) return NextResponse.json({ ok: false, error: "invalid-subscription" }, { status: 400 });
  const ref = adminDb.collection(PUSH_SUBSCRIPTIONS_COLLECTION).doc(pushSubscriptionDocId(subscription.endpoint));
  const nowIso = new Date().toISOString();
  const existing = await ref.get();
  if (String(body.mode) !== "enable") {
    // A refresh never turns them on for someone who didn't turn them on here.
    if (!existing.exists || existing.data()?.uid !== uid) return NextResponse.json({ ok: true, active: false });
  }
  await ref.set(
    {
      uid,
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      deviceLabel: String(body.deviceLabel ?? "").trim().slice(0, 80),
      userAgent: String(request.headers.get("user-agent") || "").slice(0, 300),
      createdAtIso: existing.exists && existing.data()?.uid === uid ? String(existing.data()?.createdAtIso || nowIso) : nowIso,
      updatedAtIso: nowIso,
    },
    { merge: false },
  );
  return NextResponse.json({ ok: true, active: true });
}

export async function DELETE(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const uid = await verifyBearerUid(request);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { endpoint?: unknown };
  const endpoint = String(body.endpoint ?? "").trim();
  if (!endpoint) return NextResponse.json({ ok: false, error: "missing-endpoint" }, { status: 400 });
  const ref = adminDb.collection(PUSH_SUBSCRIPTIONS_COLLECTION).doc(pushSubscriptionDocId(endpoint));
  const existing = await ref.get();
  if (existing.exists && existing.data()?.uid === uid) await ref.delete();
  return NextResponse.json({ ok: true });
}
