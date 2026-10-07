import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { sendPushToUser } from "@/lib/push-server";

// User Settings > Phone & Desktop Notifications > "Send a test": a notification to the signed-in user's
// own devices, whatever kinds they've switched off.
export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const uid = await verifyBearerUid(request);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const result = await sendPushToUser(
    uid,
    { title: "CutSmart", body: "Notifications are working on this device.", url: "/user-settings", tag: "cutsmart-test" },
    { type: "test", siteOrigin: new URL(request.url).origin, skipChoices: true, skipQuiet: true },
  );
  return NextResponse.json({ ok: result.sent > 0, ...result });
}
