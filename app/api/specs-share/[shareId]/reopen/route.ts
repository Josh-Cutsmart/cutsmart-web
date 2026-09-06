import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { verifyCompanyMembershipAdmin, type SpecsShareLinkDoc } from "@/lib/specs-share";

// Internal-authenticated staff-side safety valve for a sheet the client already submitted (see
// app/api/specs-share/[shareId]/submit) — clears the lock so the client can answer again on their
// next visit. Deliberately not exposed on the public routes: only someone with real company
// membership can reopen a submitted sheet.
export async function POST(request: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const uid = await verifyBearerUid(request);
  if (!uid) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { shareId } = await params;
  const shareRef = adminDb.collection("specsShareLinks").doc(shareId);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) {
    return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  const shareDoc = shareSnap.data() as SpecsShareLinkDoc;

  const isMember = await verifyCompanyMembershipAdmin(adminDb, shareDoc.companyId, uid);
  if (!isMember) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  await shareRef.update({
    submittedAt: FieldValue.delete(),
    submittedByName: FieldValue.delete(),
  });

  return NextResponse.json({ ok: true });
}
