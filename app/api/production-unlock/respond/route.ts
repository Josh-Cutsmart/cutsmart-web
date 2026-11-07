import { notificationText } from "@/lib/notification-messages";
import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { listCompanyMemberAccess, requireCompanyMember } from "@/lib/api-company-access";
import { getProjectDocRefAdmin } from "@/lib/specs-share";
import {
  answerUnlockRequest,
  displayNameIn,
  markUnlockNotificationsAnswered,
  pendingUnlockRequests,
  productionUnlockApproverUids,
  unlockDurationHours,
  verifyUnlockActionToken,
} from "@/lib/production-unlock-server";
import { addNotificationAndPush } from "@/lib/push-server";

// Accept or decline a production unlock request (lib/production-unlock-server.ts). Two ways in:
// - the phone or desktop notification's buttons (public/sw.js): { token, decision } — the signed token names
//   the approver, project and request, since the button can't sign in;
// - in the app (the project page, or the notification in the top bar): { companyId, projectId, requesterUid, decision } as
//   the signed-in approver, with requestedAtIso if it's answering one particular request (a notification).
// Either way the approver must (still) be allowed to approve, and the request must still be pending.
export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = String(body.decision ?? "").trim();
  if (decision !== "approve" && decision !== "deny") return NextResponse.json({ ok: false, error: "bad-decision" }, { status: 400 });

  let companyId = "";
  let projectId = "";
  let requesterUid = "";
  let approverUid = "";
  let tokenRequestedAtIso = "";
  if (body.token) {
    const claims = verifyUnlockActionToken(String(body.token));
    if (!claims) return NextResponse.json({ ok: false, error: "invalid-token" }, { status: 401 });
    ({ companyId, projectId, requesterUid, approverUid } = claims);
    tokenRequestedAtIso = claims.requestedAtIso;
  } else {
    companyId = String(body.companyId ?? "").trim();
    projectId = String(body.projectId ?? "").trim();
    requesterUid = String(body.requesterUid ?? "").trim();
    tokenRequestedAtIso = String(body.requestedAtIso ?? "").trim();
    if (!companyId || !projectId || !requesterUid) return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
    const access = await requireCompanyMember(request, companyId);
    if (!access) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    approverUid = access.uid;
  }

  const projectRef = await getProjectDocRefAdmin(adminDb, projectId, companyId);
  const projectSnap = projectRef ? await projectRef.get() : null;
  if (!projectRef || !projectSnap?.exists) return NextResponse.json({ ok: false, error: "project-not-found" }, { status: 404 });
  const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
  const pending = pendingUnlockRequests(projectData)[requesterUid];
  // Already answered (by someone else, or from another device) — or a newer request than the one being answered.
  if (!pending || (tokenRequestedAtIso && pending.requestedAtIso !== tokenRequestedAtIso)) {
    const tap = notificationText("production_unlock_tap.already_answered");
    return NextResponse.json({ ok: true, alreadyAnswered: true, tapTitle: tap.title, tapMessage: tap.message });
  }
  const approverUids = await productionUnlockApproverUids(companyId, projectData);
  if (approverUid === requesterUid || !approverUids.includes(approverUid)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const approve = decision === "approve";
  const hours = await unlockDurationHours(companyId);
  const expiryIso = await answerUnlockRequest(projectRef, requesterUid, approve, hours);

  const members = await listCompanyMemberAccess(companyId);
  const approverName = displayNameIn(members, approverUid);
  const projectName = String(projectData.name || "a project").trim() || "a project";
  await addNotificationAndPush(
    requesterUid,
    {
      ...notificationText(approve ? "production_unlock_response.accepted" : "production_unlock_response.declined", {
        person: approverName,
        project: projectName,
        hours: `${hours} hour${hours === 1 ? "" : "s"}`,
      }),
      type: "production_unlock_response",
      projectId,
      companyId,
    },
    new URL(request.url).origin,
  );
  await markUnlockNotificationsAnswered(approverUids, { projectId, requesterUid, requestedAtIso: pending.requestedAtIso }, { decision, byName: approverName });
  // (What shows after tapping Accept or Decline on the notification itself: public/sw.js.)
  const tap = notificationText(approve ? "production_unlock_tap.accepted" : "production_unlock_tap.declined", {
    person: pending.name || "They",
    hours: `${hours} hour${hours === 1 ? "" : "s"}`,
  });
  return NextResponse.json({ ok: true, decision, expiryIso, requesterName: pending.name || "They", hours, tapTitle: tap.title, tapMessage: tap.message });
}
