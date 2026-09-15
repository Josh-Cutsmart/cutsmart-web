import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { getProjectDocRefAdmin, getSpecsShareGridTarget, type SpecsShareLinkDoc } from "@/lib/specs-share";
import { normalizeSpecsGrid } from "@/lib/specs-grid-types";
import { projectNotifySubscriberUids } from "@/lib/project-notify";

// No access code — the link itself (this shareId) is the only secret, per the user's explicit
// call. See lib/specs-share.ts's buildSpecsConfirmationEmailText comment for the reasoning.
export async function POST(request: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const { shareId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();

  const shareRef = adminDb.collection("specsShareLinks").doc(shareId);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) {
    return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  const shareDoc = shareSnap.data() as SpecsShareLinkDoc;

  // Idempotent — a returning visit that's already submitted just confirms the existing state
  // rather than erroring, since the client page may call this again if its own local state was
  // lost (e.g. a reload mid-flow).
  if (shareDoc.submittedAt) {
    return NextResponse.json({ ok: true, confirmationSubmittedAt: shareDoc.submittedAt });
  }

  const projectRef = await getProjectDocRefAdmin(adminDb, shareDoc.projectId, shareDoc.companyId);
  if (!projectRef) {
    return NextResponse.json({ ok: false, error: "project-not-found" }, { status: 404 });
  }
  // The share link is bound to a specific specificationsVersions snapshot — see
  // SpecsShareLinkDoc.versionId's own comment. A link created before this field existed falls back
  // to the old live-project-doc behavior.
  const target = getSpecsShareGridTarget(projectRef, shareDoc);
  const targetSnap = await target.ref.get();
  const targetData = (targetSnap.data() ?? {}) as Record<string, unknown>;
  const grid =
    target.kind === "version"
      ? normalizeSpecsGrid(targetData.grid)
      : normalizeSpecsGrid(((targetData.sales ?? {}) as Record<string, unknown>).specificationsGrid);
  if (!grid) {
    return NextResponse.json({ ok: false, error: "no-specifications-sheet" }, { status: 404 });
  }

  // The submission lock lives on this small, separate specsShareLinks doc — never on the project
  // doc itself, which can already sit right at Firestore's 1MB per-document limit (a large specs
  // sheet, big quote history, etc.) where even a couple of extra small fields can tip an unrelated
  // save over the edge. See lib/specs-share.ts's SpecsShareLinkDoc comment.
  const nowIso = new Date().toISOString();
  try {
    await shareRef.set(
      {
        submittedAt: nowIso,
        ...(name ? { submittedByName: name } : {}),
      },
      { merge: true },
    );
    // Permanent record on the version document itself, mirroring Quote's own accept route — the
    // specsShareLinks doc can be revoked, but this frozen specificationsVersions doc
    // (and its submission) stays forever, and the staff sidebar's own bubble reads THIS field, not
    // the hub doc's, to color itself green. Only when actually version-bound (target.kind ===
    // "version") — a legacy link predating that field has no version doc to write onto.
    if (target.kind === "version") {
      await target.ref.set(
        {
          submittedAtIso: nowIso,
          ...(name ? { submittedByName: name } : {}),
        },
        { merge: true },
      );
    }
  } catch (err) {
    console.error("[specs-share/submit] write failed:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "write-failed" }, { status: 500 });
  }

  // Best-effort changelog entry — never lets a logging failure surface as (or block) the real
  // submission above, which has already succeeded by this point.
  try {
    await adminDb.collection("changelog").add({
      projectId: shareDoc.projectId,
      actor: name || "Client",
      action: "Submitted Specifications",
      at: nowIso,
    });
  } catch (err) {
    console.error("[specs-share/submit] changelog write failed:", err);
  }

  // Best-effort notification fan-out to whichever staff are subscribed to this project (defaults
  // to the assigned user — see lib/project-notify.ts). Never lets a failure here block the
  // already-succeeded submission above.
  try {
    const projectSnap = await projectRef.get();
    const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
    const subscriberUids = projectNotifySubscriberUids({
      assignedToUid: String(projectData.assignedToUid ?? ""),
      notifySubscriptionOverrides: (projectData.notifySubscriptionOverrides ?? {}) as Record<string, boolean>,
    });
    const projectName = String(projectData.name ?? "a project");
    const db = adminDb;
    await Promise.all(
      subscriberUids.map((uid) =>
        db.collection("users").doc(uid).collection("notifications").add({
          title: "Client submitted Specifications",
          message: `${name || "The client"} submitted Specifications for "${projectName}".`,
          type: "specs_submitted",
          projectId: shareDoc.projectId,
          read: false,
          createdAt: new Date(nowIso),
          createdAtIso: nowIso,
        }),
      ),
    );
  } catch (err) {
    console.error("[specs-share/submit] notification fan-out failed:", err);
  }

  return NextResponse.json({ ok: true, confirmationSubmittedAt: nowIso });
}
