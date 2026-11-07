import { NextResponse, type NextRequest } from "next/server";
import { verifyBearerUser } from "@/lib/api-auth";
import { createCompanyWithOwner } from "@/lib/company-create-server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";

// Creating a company — the last step of signing up (components/login/login-screen.tsx). The caller becomes its owner, whoever they
// say they are: their id and email come from their sign-in, not the request.
// POST { name, code, displayName? } — its name, the master code its staff will join with, and what to call the owner.

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
  try {
    const profile = ((await adminDb.collection("users").doc(caller.uid).get()).data() ?? {}) as Record<string, unknown>;
    const name = (toStr(body.displayName) || toStr(profile.displayName ?? profile.name)).slice(0, 120);
    const result = await createCompanyWithOwner(adminDb, { uid: caller.uid, email: caller.email, name }, body.name, body.code);
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[company/create] failed:", error);
    return NextResponse.json({ ok: false, error: "could-not-create" }, { status: 500 });
  }
}
