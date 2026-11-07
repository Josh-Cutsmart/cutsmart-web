import { FieldValue } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";
import { verifyBearerUid } from "@/lib/api-auth";
import { hasPermissionKey, normalizeRoleId, resolveMemberAccess } from "@/lib/company-access-server";
import { companyRoleIdsOf } from "@/lib/company-join-code-role";
import { checkMemberRoleChange } from "@/lib/company-role-change";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";

// Changing a staff member's role (Company Settings > Staff). firestore.rules doesn't let the app do this itself: it's here, checked
// against who's really asking (lib/company-role-change.ts), or anyone could make themselves owner.
// POST { companyId, uid, roleId }

function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const callerUid = await verifyBearerUid(request);
  if (!callerUid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = toStr(body.companyId);
  const targetUid = toStr(body.uid);
  if (!companyId || !targetUid) return NextResponse.json({ ok: false, error: "missing-company-or-user" }, { status: 400 });

  try {
    const caller = await resolveMemberAccess(companyId, callerUid);
    if (!caller.exists) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    const target = await resolveMemberAccess(companyId, targetUid);
    if (!target.exists) return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });

    const companyRef = adminDb.collection("companies").doc(companyId);
    const [companySnap, memberships] = await Promise.all([companyRef.get(), companyRef.collection("memberships").limit(500).get()]);
    const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
    const overrides = (companyData.staffRoleIdsByUid ?? {}) as Record<string, unknown>;
    const ownerCount = memberships.docs.filter((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return (normalizeRoleId(overrides[doc.id]) || normalizeRoleId(data.roleId ?? data.role)) === "owner";
    }).length;

    const result = checkMemberRoleChange({
      caller: { uid: callerUid, roleId: caller.roleId, canChangeRoles: hasPermissionKey(caller.permissionKeys, "staff.change.role") },
      targetUid,
      targetRoleId: target.roleId,
      nextRoleIdRaw: body.roleId,
      companyRoleIds: companyRoleIdsOf(companyData),
      ownerCount,
    });
    if (!result.ok) {
      const status = result.error === "forbidden" || result.error === "own-role" || result.error === "role-not-allowed" ? 403 : 400;
      return NextResponse.json(result, { status });
    }
    if (result.changed) {
      await companyRef.update({
        [`staffRoleIdsByUid.${targetUid}`]: result.roleId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      });
    }
    return NextResponse.json({ ok: true, roleId: result.roleId });
  } catch (error) {
    console.error("[company/member-role] failed:", error);
    return NextResponse.json({ ok: false, error: "could-not-change-role" }, { status: 500 });
  }
}
