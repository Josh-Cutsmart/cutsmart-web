import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import {
  getProjectDocRefAdmin,
  getQuoteShareGridTarget,
  isShareLinkInactiveAdmin,
  SHARE_LINK_INACTIVE_ERROR,
  type SpecsShareLinkDoc,
} from "@/lib/specs-share";
import { normalizeSpecsGrid } from "@/lib/specs-grid-types";
import { projectNotifySubscriberUids } from "@/lib/project-notify";
import { pushStoredNotification } from "@/lib/push-server";

// The client declines the quote — accept/route.ts's twin: `name` is required, an optional `reason` is
// kept, and the decline is written both onto the specsShareLinks doc (for the staff page) and onto the
// sent quoteGridVersions/{id} doc as the permanent record. It locks the quote like accepting does,
// until staff reopen it (reopen/route.ts clears it). The project's staff are notified (quote_declined).
export async function POST(request: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const { shareId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  const reason = String(body.reason ?? "").trim().slice(0, 1000);
  if (!name) {
    return NextResponse.json({ ok: false, error: "missing-name" }, { status: 400 });
  }

  const shareRef = adminDb.collection("specsShareLinks").doc(shareId);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) {
    return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  const shareDoc = shareSnap.data() as SpecsShareLinkDoc;

  // A finished project's link stops working (archived, or past the company's archive delay).
  if (await isShareLinkInactiveAdmin(adminDb, shareDoc)) {
    return NextResponse.json({ ok: false, error: SHARE_LINK_INACTIVE_ERROR }, { status: 410 });
  }

  // Idempotent — already declined just confirms it; already accepted can't be declined.
  if (shareDoc.quoteDeclinedAt) {
    return NextResponse.json({ ok: true, quoteDeclinedAt: shareDoc.quoteDeclinedAt, quoteDeclinedByName: shareDoc.quoteDeclinedByName || null });
  }
  if (shareDoc.quoteAcceptedAt) {
    return NextResponse.json({ ok: false, error: "quote-accepted" }, { status: 409 });
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
    await shareRef.set({ quoteDeclinedAt: nowIso, quoteDeclinedByName: name, quoteDeclineReason: reason }, { merge: true });
    // Permanent record on the version document itself, like an acceptance.
    await target.ref.set({ declinedAtIso: nowIso, declinedByName: name }, { merge: true });
  } catch (err) {
    console.error("[specs-share/decline] write failed:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "write-failed" }, { status: 500 });
  }

  // Best-effort changelog entry — never lets a logging failure surface as (or block) the real
  // acceptance above, which has already succeeded by this point.
  try {
    await adminDb.collection("changelog").add({
      projectId: shareDoc.projectId,
      actor: name || "Client",
      action: reason ? `Declined Quote — "${reason}"` : "Declined Quote",
      at: nowIso,
    });
  } catch (err) {
    console.error("[specs-share/decline] changelog write failed:", err);
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
          title: "Quote declined",
          message: reason
            ? `${name || "The client"} declined quote for ${projectName}: "${reason}"`
            : `${name || "The client"} declined quote for ${projectName}`,
          type: "quote_declined",
          projectId: shareDoc.projectId,
          companyId: String(projectData.companyId ?? "") || null,
          read: false,
          createdAt: new Date(nowIso),
          createdAtIso: nowIso,
        })
        // And to their phone/desktop (lib/push-server.ts) — never holding up the response if it can't.
        .then((ref) => pushStoredNotification(uid, ref.id, new URL(request.url).origin).catch(() => undefined)),
      ),
    );
  } catch (err) {
    console.error("[specs-share/decline] notification fan-out failed:", err);
  }

  return NextResponse.json({ ok: true, quoteDeclinedAt: nowIso, quoteDeclinedByName: name });
}
