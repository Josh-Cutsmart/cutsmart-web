import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { getProjectDocRefAdmin, verifyCompanyMembershipAdmin, type SpecsShareLinkDoc } from "@/lib/specs-share";

// Internal-authenticated staff-side safety valve — fully retracts the sent document for either
// kind. Once reopened, the live sheet/quote is freely editable again (Specs' own live sheet was
// already always freely editable regardless of send status, unlike Quote's, which this also
// unlocks — see SpecsGridEditor's isSentToClient prop), the version is no longer marked sent (so
// it becomes deletable again), and it disappears from the client's hub link entirely until staff
// send a fresh version.
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

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = body.kind === "quote" ? "quote" : "specs";

  // The version doc's own sentToClient/acceptedAtIso/acceptedByName (or submittedAtIso/
  // submittedByName for Specs) were originally meant as permanent records that survive even the
  // hub link expiring — but reopening for editing RETRACTS the send itself (versionId/
  // quoteVersionId is cleared below), so this version is no longer the sent one at all, not just
  // no-longer-accepted/submitted. Leaving any of them up would be actively misleading (the
  // toolbar's own chip, the Version History sidebar's badge) once it's reopened. Clear them here,
  // on the version doc itself, not just the hub doc's own fields below.
  if (kind === "quote" && shareDoc.quoteVersionId) {
    const projectRef = await getProjectDocRefAdmin(adminDb, shareDoc.projectId, shareDoc.companyId);
    if (projectRef) {
      await projectRef
        .collection("quoteGridVersions")
        .doc(shareDoc.quoteVersionId)
        .update({ sentToClient: FieldValue.delete(), acceptedAtIso: FieldValue.delete(), acceptedByName: FieldValue.delete() })
        .catch(() => {});
    }
  } else if (kind === "specs" && shareDoc.versionId) {
    // Same full retraction as Quote's own branch above — clears sentToClient too (not just the
    // submission), so the Version History sidebar's bubble stops showing "Sent to Client"/
    // "Submitted by X" and goes back to plain, and becomes deletable again.
    const projectRef = await getProjectDocRefAdmin(adminDb, shareDoc.projectId, shareDoc.companyId);
    if (projectRef) {
      await projectRef
        .collection("specificationsVersions")
        .doc(shareDoc.versionId)
        .update({ sentToClient: FieldValue.delete(), submittedAtIso: FieldValue.delete(), submittedByName: FieldValue.delete() })
        .catch(() => {});
    }
  }

  await shareRef.update(
    kind === "quote"
      ? {
          quoteVersionId: FieldValue.delete(),
          quoteAcceptedAt: FieldValue.delete(),
          quoteAcceptedByName: FieldValue.delete(),
          quoteSentFromLive: FieldValue.delete(),
        }
      : {
          versionId: FieldValue.delete(),
          submittedAt: FieldValue.delete(),
          submittedByName: FieldValue.delete(),
          specsSentFromLive: FieldValue.delete(),
        },
  );

  // Hands back the version id THIS request actually reopened (read from Firestore, not whatever
  // the caller's own local state happened to hold) — the caller's specsShareStatus can lag behind
  // the server (e.g. right after an outdated-quote "Update"), and trusting a stale client-side id
  // to know which Version History bubble to clear locally was leaving its "Accepted"/"Submitted"
  // badge stuck showing even though this route had already cleared the real record underneath.
  return NextResponse.json({
    ok: true,
    reopenedVersionId: kind === "quote" ? shareDoc.quoteVersionId || null : shareDoc.versionId || null,
  });
}
