import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { verifyCompanyMembershipAdmin, type SpecsShareLinkDoc } from "@/lib/specs-share";

// Fully revokes a project's client-confirmation link. Not currently wired to any button — the
// live sheet no longer needs this as a lock-bypass escape hatch (see SpecsGridEditor's
// isSentToClient prop no longer being tied to specsShareStatus in
// app/(app)/projects/[projectId]/page.tsx: the live sheet stays editable regardless of send
// status, and staff edits never reach an already-shared link since that link is bound to its own
// specificationsVersions snapshot). Kept as a building block for a future manual "revoke link"
// action. Deleting the specsShareLinks doc outright (rather than just clearing submittedAt like
// the sibling "reopen" route does) is what actually makes the OLD link stop working.
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
    // Idempotent — nothing to revoke, but the end state (no active link) is already true.
    return NextResponse.json({ ok: true });
  }
  const shareDoc = shareSnap.data() as SpecsShareLinkDoc;

  const isMember = await verifyCompanyMembershipAdmin(adminDb, shareDoc.companyId, uid);
  if (!isMember) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  await shareRef.delete();

  return NextResponse.json({ ok: true });
}
