import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUser } from "@/lib/api-auth";
import { joinWithCode, joinWithInvite } from "@/lib/company-join-codes-server";

// Joining a company — the last step of signing up (components/login/login-screen.tsx), done here so
// a temporary code can be used up as it's used (lib/company-join-codes-server.ts).
// POST { code } — with a join code (master or temporary).
// POST { inviteCompanyId, inviteId } — accepting an invite sent to this account's email.

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
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
