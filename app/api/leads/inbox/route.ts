import { NextRequest, NextResponse } from "next/server";
import { hasFirebaseAdminConfig, adminDb } from "@/lib/firebase-admin";
import { requireCompanyMember } from "@/lib/api-company-access";
import { ensureLeadInbox } from "@/lib/lead-inbox-server";
import { leadInboxAddress } from "@/lib/lead-inbox";

// The company's leads email inbox address (Company Settings → Leads) — handed out the first time it's asked for
// (lib/lead-inbox-server.ts), the same one every time after. Any member of the company may ask.
export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const body = (await request.json().catch(() => null)) as { companyId?: unknown } | null;
  const companyId = String(body?.companyId ?? "").trim();
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "missing-company-id" }, { status: 400 });
  }
  if (!(await requireCompanyMember(request, companyId))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const inbox = await ensureLeadInbox(companyId);
    return NextResponse.json({ ok: true, address: leadInboxAddress(inbox.localPart) });
  } catch (error) {
    console.error("[leads] inbox address failed:", error);
    return NextResponse.json({ ok: false, error: "lead-inbox-failed" }, { status: 500 });
  }
}
