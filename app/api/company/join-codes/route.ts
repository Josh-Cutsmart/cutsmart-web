import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import {
  canManageJoinCodes,
  changeMasterCode,
  checkCodeRole,
  createTemporaryCode,
  deleteRevokedCode,
  linkCodeToInvite,
  listJoinCodes,
  renameTemporaryCode,
  revokeCodesForInvite,
  revokeTemporaryCode,
} from "@/lib/company-join-codes-server";

// A company's join codes — the master code and temporary one-person codes
// (lib/company-join-codes-server.ts). Owners and anyone who can add staff or change company settings.
//
// GET ?companyId= — the master code and every code's record.
// POST { companyId, action }:
// - "create-temporary" { label, inviteId?, invitedEmail?, roleId? } → a new one-person code (for an invite, linked to
//   it), with the role its person starts in if one's given
// - "link-invite" { key, inviteId, invitedEmail, roleId? } → one of the company's waiting codes linked to an invite
//   instead (not used, revoked or already an invite's), with that role if one's given
//   A role is checked before either (checkCodeRole): one of the company's, never Owner, Admin only from an owner or
//   admin, and anything but Staff only from someone who can change staff roles.
// - "change-master" { code } → a new master code (nobody already in the company is affected)
// - "rename" { key, label } → a temporary code's name (its label); the code itself stays
// - "revoke" { key } → stops a temporary code; one already used needs its person removed first
// - "revoke-for-invite" { inviteId } → a cancelled invite's code, if unused
// - "delete" { key } → removes a revoked code from the list

function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

async function authorize(request: NextRequest, companyId: string) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return { error: NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 }) };
  }
  const uid = await verifyBearerUid(request);
  if (!uid) return { error: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  if (!companyId) return { error: NextResponse.json({ ok: false, error: "missing-company" }, { status: 400 }) };
  const access = await canManageJoinCodes(companyId, uid);
  if (!access.ok) return { error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) };
  return { uid, name: access.name, setter: access.setter, db: adminDb };
}

export async function GET(request: NextRequest) {
  const companyId = toStr(new URL(request.url).searchParams.get("companyId"));
  const caller = await authorize(request, companyId);
  if ("error" in caller) return caller.error;
  const result = await listJoinCodes(caller.db, companyId);
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = toStr(body.companyId);
  const caller = await authorize(request, companyId);
  if ("error" in caller) return caller.error;
  const action = toStr(body.action);
  const by = { uid: caller.uid, name: caller.name };

  if (action === "create-temporary") {
    const role = await checkCodeRole(caller.db, companyId, caller.setter, body.roleId);
    if (!role.ok) return NextResponse.json(role, { status: 403 });
    const inviteId = toStr(body.inviteId);
    // Inviting the same person again: the code from their earlier invite stops, so there's only one.
    if (inviteId) await revokeCodesForInvite(caller.db, companyId, inviteId);
    const result = await createTemporaryCode(
      caller.db,
      companyId,
      by,
      toStr(body.label),
      inviteId ? { inviteId, invitedEmail: toStr(body.invitedEmail) } : undefined,
      role.roleId,
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }
  if (action === "link-invite") {
    const role = await checkCodeRole(caller.db, companyId, caller.setter, body.roleId);
    if (!role.ok) return NextResponse.json(role, { status: 403 });
    const inviteId = toStr(body.inviteId);
    const key = toStr(body.key);
    const result = await linkCodeToInvite(caller.db, companyId, key, { inviteId, invitedEmail: toStr(body.invitedEmail) }, role.roleId);
    // Inviting the same person again: the code from their earlier invite stops (not this one), so there's only one.
    if (result.ok) await revokeCodesForInvite(caller.db, companyId, inviteId, key);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }
  if (action === "change-master") {
    const result = await changeMasterCode(caller.db, companyId, by, toStr(body.code));
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }
  if (action === "rename") {
    const result = await renameTemporaryCode(caller.db, companyId, toStr(body.key), toStr(body.label));
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }
  if (action === "revoke") {
    const result = await revokeTemporaryCode(caller.db, companyId, toStr(body.key));
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }
  if (action === "revoke-for-invite") {
    const result = await revokeCodesForInvite(caller.db, companyId, toStr(body.inviteId));
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }
  if (action === "delete") {
    const result = await deleteRevokedCode(caller.db, companyId, toStr(body.key));
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }
  return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 });
}
