import { FieldValue } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";
import { verifyBearerUid } from "@/lib/api-auth";
import { hasPermissionKey, resolveMemberAccess } from "@/lib/company-access-server";
import { integrationsAfterSave, rolesAfterSave } from "@/lib/company-protected-settings";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";

// Saving what each role can do and the integrations (lib/company-protected-settings.ts). firestore.rules doesn't let the app do this
// itself: it's here, for owners, admins and anyone with company.settings. Company Settings sends these with every save, so what hasn't
// changed is fine from anyone, and isn't written.
// POST { companyId, roles?, integrations? }

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
  if (!companyId) return NextResponse.json({ ok: false, error: "missing-company" }, { status: 400 });

  try {
    const caller = await resolveMemberAccess(companyId, callerUid);
    if (!caller.exists) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    const companyRef = adminDb.collection("companies").doc(companyId);
    const companyData = ((await companyRef.get()).data() ?? {}) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (body.roles !== undefined) {
      const roles = rolesAfterSave(body.roles, companyData.roles, caller.roleId === "owner");
      if (!roles.ok) return NextResponse.json(roles, { status: 400 });
      if (roles.changed) patch.roles = roles.roles;
    }
    if (body.integrations !== undefined) {
      const integrations = integrationsAfterSave(body.integrations, companyData.integrations);
      if (!integrations.ok) return NextResponse.json(integrations, { status: 400 });
      if (integrations.changed) patch.integrations = integrations.integrations;
    }
    if (!Object.keys(patch).length) return NextResponse.json({ ok: true });

    const allowed = caller.roleId === "owner" || caller.roleId === "admin" || hasPermissionKey(caller.permissionKeys, "company.settings");
    if (!allowed) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    await companyRef.set({ ...patch, updatedAt: FieldValue.serverTimestamp(), updatedAtIso: new Date().toISOString() }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[company/protected-settings] failed:", error);
    return NextResponse.json({ ok: false, error: "could-not-save" }, { status: 500 });
  }
}
