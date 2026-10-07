import { after, NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUser } from "@/lib/api-auth";
import { isDevEmailOnServer, readPublicTextFile } from "@/lib/dev-emails-server";
import {
  DEV_TEST_ACTION_TOKEN,
  DEV_TEST_DELAYS,
  DEV_TEST_GROUPS,
  DEV_TEST_REQUESTER,
  DEV_TEST_UNLOCK_HOURS,
  devTestSample,
} from "@/lib/push-dev-test";
import { pushNotificationBody } from "@/lib/push-notification-types";
import { groupedPayload, PUSH_SUBSCRIPTIONS_COLLECTION, sendPushToUser, type PushPayload } from "@/lib/push-server";

// Up to a minute's wait before sending, plus the send.
export const maxDuration = 90;

// Dev mode's test notifications (the "test" buttons in User Settings — components/dev-mode.tsx):
// { sample, delaySeconds } as a signed-in Dev user (public/dev-emails.txt, checked here — the app's own check is just for showing dev mode) sends
// that test to their own devices only, with made-up details (lib/push-dev-test.ts). It skips their
// notification choices and time between notifications, and nothing is stored.
//
// Also the test unlock request's Approve / Deny buttons: public/sw.js posts { token, decision } here,
// signed out. There's nothing to approve — it answers as the real route does, so the "Approved — …"
// notification that follows can be seen too.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.token !== undefined) {
    const decision = String(body.decision ?? "");
    if (body.token !== DEV_TEST_ACTION_TOKEN || (decision !== "approve" && decision !== "deny")) {
      return NextResponse.json({ ok: false, error: "bad-request" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, decision, requesterName: DEV_TEST_REQUESTER, hours: DEV_TEST_UNLOCK_HOURS });
  }

  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const user = await verifyBearerUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const siteOrigin = new URL(request.url).origin;
  if (!(await isDevEmailOnServer(user.email, siteOrigin))) {
    return NextResponse.json({ ok: false, error: "not-dev" }, { status: 403 });
  }

  const sample = String(body.sample ?? "").trim();
  const delaySeconds = DEV_TEST_DELAYS.some((option) => option.seconds === Number(body.delaySeconds)) ? Number(body.delaySeconds) : 0;
  const test = await buildTest(sample, siteOrigin);
  if (!test) return NextResponse.json({ ok: false, error: "unknown-sample" }, { status: 400 });
  const send = () => sendPushToUser(user.uid, test.payload, { type: test.type, siteOrigin, skipChoices: true, skipQuiet: true });

  if (!delaySeconds) {
    const result = await send();
    return NextResponse.json({ ok: result.sent > 0, ...result });
  }
  // Later: answered straight away (so it still arrives if the phone is locked meanwhile), then sent once
  // the wait is up.
  const devices = await adminDb.collection(PUSH_SUBSCRIPTIONS_COLLECTION).where("uid", "==", user.uid).limit(1).get();
  if (devices.empty) return NextResponse.json({ ok: false, sent: 0, removed: 0, failed: 0, reason: "no-devices" });
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    await send();
  });
  return NextResponse.json({ ok: true, scheduled: true, delaySeconds });
}

// The notification for a test: a kind (as in lib/push-notification-types.ts) or a grouped one. Each has
// its own tag, so every test shows rather than replacing the last.
async function buildTest(sample: string, siteOrigin: string): Promise<{ type: string; payload: PushPayload } | null> {
  const tag = `dev-test-${sample}-${Date.now()}`;
  const group = DEV_TEST_GROUPS.find((item) => item.id === sample);
  if (group) {
    const now = Date.now();
    const held = group.held.map((item) => ({
      type: item.type,
      title: item.title,
      body: pushNotificationBody(item),
      url: item.type.startsWith("lead_") ? "/leads" : "/dashboard",
      atMs: now,
    }));
    return { type: group.held[0].type, payload: { ...groupedPayload(held, group.total), tag } };
  }
  const appVersion =
    sample === "app_version" ? (/^\s*Version:\s*(\S+)/im.exec(await readPublicTextFile("update-notes.txt", siteOrigin))?.[1] ?? "") : "";
  const single = devTestSample(sample, appVersion);
  if (!single) return null;
  return {
    type: sample,
    payload: {
      ...single,
      tag,
      ...(sample === "production_unlock_request"
        ? {
            actions: [
              { action: "approve", title: "Approve" },
              { action: "deny", title: "Deny" },
            ],
            actionUrl: "/api/push/dev-test",
            actionToken: DEV_TEST_ACTION_TOKEN,
          }
        : {}),
    },
  };
}
