import { notificationText } from "@/lib/notification-messages";
import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUser } from "@/lib/api-auth";
import { joinWithCode, joinWithInvite } from "@/lib/company-join-codes-server";
import { addNotificationAndPush } from "@/lib/push-server";

// Joining a company — the last step of signing up (components/login/login-screen.tsx), done here so
// a temporary code can be used up as it's used (lib/company-join-codes-server.ts).
// POST { code } — with a join code (master or temporary).
// POST { inviteCompanyId, inviteId } — accepting an invite sent to this account's email.
// An access code used up by either: whoever made it is told who joined with it (if they're still in the company, and it
// wasn't them).

function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const caller = await verifyBearerUser(request);
  if (!caller) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const profile = ((await adminDb.collection("users").doc(caller.uid).get()).data() ?? {}) as Record<string, unknown>;
  const user = { uid: caller.uid, email: caller.email, name: toStr(profile.displayName ?? profile.name) };

  const result = toStr(body.inviteId)
    ? await joinWithInvite(adminDb, user, toStr(body.inviteCompanyId), toStr(body.inviteId))
    : await joinWithCode(adminDb, user, toStr(body.code));
  if (!result.ok) return NextResponse.json(result, { status: 404 });
  const { usedCode, companyId } = result;
  if (usedCode && usedCode.createdByUid !== user.uid) {
    const company = adminDb.collection("companies").doc(companyId);
    const creatorStillHere = (await company.collection("memberships").doc(usedCode.createdByUid).get().catch(() => null))?.exists;
    if (creatorStillHere) {
      const who = user.name || user.email || "Someone";
      await addNotificationAndPush(
        usedCode.createdByUid,
        {
          ...notificationText(usedCode.label ? "access_code_used.with_label" : "access_code_used", { person: who, code: usedCode.code, label: usedCode.label ?? "" }),
          type: "access_code_used",
          companyId,
        },
        new URL(request.url).origin,
      );
    }
  }
  return NextResponse.json({ ok: true, companyId });
}
