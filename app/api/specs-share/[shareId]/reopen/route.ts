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

  // The steps that don't need each other run at the same time, so it's a few trips to the database one after
  // another rather than one per step. Nothing is written until they're known to be in the company.
  const { shareId } = await params;
  const shareRef = adminDb.collection("specsShareLinks").doc(shareId);
  // Who's asking, the link, and what to reopen.
  const [uid, shareSnap, rawBody] = await Promise.all([verifyBearerUid(request), shareRef.get(), request.json().catch(() => ({}))]);
  if (!uid) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!shareSnap.exists) {
    return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  const shareDoc = shareSnap.data() as SpecsShareLinkDoc;
  const body = rawBody as Record<string, unknown>;
  const kind = body.kind === "quote" ? "quote" : "specs";

  // Whether they're in the company, and where the project is — both from the link alone.
  const db = adminDb;
  const [isMember, projectRef] = await Promise.all([
    verifyCompanyMembershipAdmin(db, shareDoc.companyId, uid),
    getProjectDocRefAdmin(db, shareDoc.projectId, shareDoc.companyId),
  ]);
  if (!isMember) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // A quote the client has accepted is final — it can't be reopened for editing.
  if (kind === "quote" && shareDoc.quoteAcceptedAt) {
    return NextResponse.json({ ok: false, error: "quote-accepted" }, { status: 409 });
  }

  // The version doc's own sentToClient/acceptedAtIso/acceptedByName (or submittedAtIso/
  // submittedByName for Specs) were originally meant as permanent records that survive even the
  // hub link expiring — but reopening for editing RETRACTS the send itself (versionId/
  // quoteVersionId is cleared below), so this version is no longer the sent one at all, not just
  // no-longer-accepted/submitted. Leaving any of them up would be actively misleading (the
  // toolbar's own chip, the Version History sidebar's badge) once it's reopened. Clear them here,
  // on the version doc itself, not just the hub doc's own fields below.
  //
  // Every version of this kind still marked sent is cleared, not only the one the link points at — "Reopen for
  // Editing" unsends it all, and a version can be left marked sent without being the link's (e.g. a send that
  // failed part-way, before that was undone). The same full retraction for Specs (sentToClient and the
  // submission), so each Version History bubble goes back to plain, and becomes deletable again.
  const boundVersionId = kind === "quote" ? shareDoc.quoteVersionId : shareDoc.versionId;
  const reopenedVersionIds: string[] = [];
  const versionWrites: Promise<void>[] = [];
  if (projectRef) {
    const versions = projectRef.collection(kind === "quote" ? "quoteGridVersions" : "specificationsVersions");
    const markedSent = await versions.where("sentToClient", "==", true).get().catch(() => null);
    const ids = new Set<string>([...(markedSent?.docs.map((d) => d.id) ?? []), ...(boundVersionId ? [boundVersionId] : [])]);
    const cleared =
      kind === "quote"
        ? {
            sentToClient: FieldValue.delete(),
            acceptedAtIso: FieldValue.delete(),
            acceptedByName: FieldValue.delete(),
            declinedAtIso: FieldValue.delete(),
            declinedByName: FieldValue.delete(),
          }
        : { sentToClient: FieldValue.delete(), submittedAtIso: FieldValue.delete(), submittedByName: FieldValue.delete() };
    for (const id of ids) {
      versionWrites.push(
        versions
          .doc(id)
          .update(cleared)
          .then(() => {
            reopenedVersionIds.push(id);
          })
          .catch(() => {}),
      );
    }
  }

  // The versions and the link itself are cleared together.
  const linkWrite = shareRef.update(
    kind === "quote"
      ? {
          quoteVersionId: FieldValue.delete(),
          quoteAcceptedAt: FieldValue.delete(),
          quoteAcceptedByName: FieldValue.delete(),
          quoteDeclinedAt: FieldValue.delete(),
          quoteDeclinedByName: FieldValue.delete(),
          quoteDeclineReason: FieldValue.delete(),
          quoteSentFromLive: FieldValue.delete(),
        }
      : {
          versionId: FieldValue.delete(),
          submittedAt: FieldValue.delete(),
          submittedByName: FieldValue.delete(),
          specsSentFromLive: FieldValue.delete(),
        },
  );
  await Promise.all([linkWrite, ...versionWrites]);

  // Hands back the version id THIS request actually reopened (read from Firestore, not whatever
  // the caller's own local state happened to hold) — the caller's specsShareStatus can lag behind
  // the server (e.g. right after an outdated-quote "Update"), and trusting a stale client-side id
  // to know which Version History bubble to clear locally was leaving its "Accepted"/"Submitted"
  // badge stuck showing even though this route had already cleared the real record underneath.
  return NextResponse.json({
    ok: true,
    reopenedVersionId: boundVersionId || null,
    // Every version this cleared (the one above and any other still marked sent).
    reopenedVersionIds,
  });
}
