import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { requireCompanyMember } from "@/lib/api-company-access";
import { announceCurrentAppVersion } from "@/lib/app-version-server";

// An app that's opened a new version before the scheduled job has announced it: { companyId } as a
// signed-in member — adds it to the changelog and tells that company, if they haven't been told
// (lib/app-version-server.ts).
export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as { companyId?: unknown };
  const companyId = String(body.companyId ?? "").trim();
  if (!companyId) return NextResponse.json({ ok: false, error: "missing-company" }, { status: 400 });
  const access = await requireCompanyMember(request, companyId);
  if (!access) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const result = await announceCurrentAppVersion(new URL(request.url).origin, companyId);
  return NextResponse.json({ ok: true, ...result });
}
