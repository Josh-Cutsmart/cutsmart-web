import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { verifyCompanyMembershipAdmin, type SpecsShareLinkDoc } from "@/lib/specs-share";

// Internal-authenticated — lets the project page show "Link created for X" / "Submitted by X on
// Y" without the client Firestore SDK ever reading specsShareLinks directly (that collection is
// admin-SDK-only by design, see lib/specs-share.ts).
export async function GET(request: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const uid = await verifyBearerUid(request);
  if (!uid) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { shareId } = await params;
  const shareSnap = await adminDb.collection("specsShareLinks").doc(shareId).get();
  if (!shareSnap.exists) {
    // Not an error — most projects simply haven't had a link created yet.
    return NextResponse.json({ ok: true, exists: false });
  }
  const shareDoc = shareSnap.data() as SpecsShareLinkDoc;

  const isMember = await verifyCompanyMembershipAdmin(adminDb, shareDoc.companyId, uid);
  if (!isMember) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    exists: true,
    clientEmail: shareDoc.clientEmail,
    submittedAt: shareDoc.submittedAt || null,
    submittedByName: shareDoc.submittedByName || null,
    versionId: shareDoc.versionId || null,
    specsSentFromLive: shareDoc.specsSentFromLive ?? null,
    quoteVersionId: shareDoc.quoteVersionId || null,
    quoteAcceptedAt: shareDoc.quoteAcceptedAt || null,
    quoteAcceptedByName: shareDoc.quoteAcceptedByName || null,
    quoteSentFromLive: shareDoc.quoteSentFromLive ?? null,
  });
}
