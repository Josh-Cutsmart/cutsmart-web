import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { getProjectDocRefAdmin, getQuoteShareGridTarget, type SpecsShareLinkDoc } from "@/lib/specs-share";
import { normalizeSpecsGrid } from "@/lib/specs-grid-types";
import { projectNotifySubscriberUids } from "@/lib/project-notify";

// Quote's own version of .../submit/route.ts. Two differences from Specs' submit: `name` is
// REQUIRED here (rejected as missing-name if blank) since "Accepted by X" is a materially more
// consequential record than a specs confirmation, and the acceptance is written BOTH onto this
// small specsShareLinks doc (for the staff status chip) AND directly onto the bound
// quoteGridVersions/{id} document itself, so the permanent record survives even if this share link
// is later revoked.
export async function POST(request: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const { shareId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "missing-name" }, { status: 400 });
  }

  const shareRef = adminDb.collection("specsShareLinks").doc(shareId);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) {
    return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  const shareDoc = shareSnap.data() as SpecsShareLinkDoc;

  // Idempotent — a returning visit that's already accepted just confirms the existing state
  // rather than erroring, since the client page may call this again if its own local state was
  // lost (e.g. a reload mid-flow).
  if (shareDoc.quoteAcceptedAt) {
    return NextResponse.json({ ok: true, quoteAcceptedAt: shareDoc.quoteAcceptedAt, quoteAcceptedByName: shareDoc.quoteAcceptedByName || null });
  }

  const projectRef = await getProjectDocRefAdmin(adminDb, shareDoc.projectId, shareDoc.companyId);
  if (!projectRef) {
    return NextResponse.json({ ok: false, error: "project-not-found" }, { status: 404 });
  }
  const target = getQuoteShareGridTarget(projectRef, shareDoc);
  if (!target) {
    return NextResponse.json({ ok: false, error: "quote-not-sent" }, { status: 404 });
  }
  const targetSnap = await target.ref.get();
  const grid = normalizeSpecsGrid((targetSnap.data() ?? {}).grid);
  if (!grid) {
    return NextResponse.json({ ok: false, error: "no-quote" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  try {
    await shareRef.set({ quoteAcceptedAt: nowIso, quoteAcceptedByName: name }, { merge: true });
    // Permanent record on the version document itself — the specsShareLinks doc can be revoked,
    // but this frozen quoteGridVersions doc (and its acceptance) stays forever.
    await target.ref.set({ acceptedAtIso: nowIso, acceptedByName: name }, { merge: true });
  } catch (err) {
    console.error("[specs-share/accept] write failed:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "write-failed" }, { status: 500 });
  }

  // Best-effort changelog entry — never lets a logging failure surface as (or block) the real
  // acceptance above, which has already succeeded by this point.
  try {
    await adminDb.collection("changelog").add({
      projectId: shareDoc.projectId,
      actor: name || "Client",
      action: "Accepted Quote",
      at: nowIso,
    });
  } catch (err) {
    console.error("[specs-share/accept] changelog write failed:", err);
  }

  // Best-effort notification fan-out to whichever staff are subscribed to this project (defaults
  // to the assigned user — see lib/project-notify.ts). Never lets a failure here block the
  // already-succeeded acceptance above.
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
          title: "Client accepted the Quote",
          message: `${name || "The client"} accepted the Quote for "${projectName}".`,
          type: "quote_accepted",
          projectId: shareDoc.projectId,
          companyId: String(projectData.companyId ?? "") || null,
          read: false,
          createdAt: new Date(nowIso),
          createdAtIso: nowIso,
        }),
      ),
    );
  } catch (err) {
    console.error("[specs-share/accept] notification fan-out failed:", err);
  }

  return NextResponse.json({ ok: true, quoteAcceptedAt: nowIso, quoteAcceptedByName: name });
}
