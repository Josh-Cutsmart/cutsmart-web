import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { listCompanyMemberAccess, requireCompanyMember } from "@/lib/api-company-access";
import { getProjectDocRefAdmin } from "@/lib/specs-share";
import {
  answerUnlockRequest,
  displayNameIn,
  pendingUnlockRequests,
  productionUnlockApproverUids,
  unlockDurationHours,
  verifyUnlockActionToken,
} from "@/lib/production-unlock-server";
import { addNotificationAndPush } from "@/lib/push-server";

// Approve or deny a production unlock request (lib/production-unlock-server.ts). Two ways in:
// - the notification's Approve/Deny buttons (public/sw.js): { token, decision } — the signed token names
//   the approver, project and request, since the button can't sign in;
// - the project page: { companyId, projectId, requesterUid, decision } as the signed-in approver.
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
  // Already answered (by someone else, or from another device) — or a newer request than this token's.
  if (!pending || (tokenRequestedAtIso && pending.requestedAtIso !== tokenRequestedAtIso)) {
    return NextResponse.json({ ok: true, alreadyAnswered: true });
  }
  if (approverUid === requesterUid || !(await productionUnlockApproverUids(companyId, projectData)).includes(approverUid)) {
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
      title: approve ? "Production unlocked" : "Unlock request denied",
      message: approve
        ? `${approverName} approved your request — you can edit production on "${projectName}" for ${hours} hour${hours === 1 ? "" : "s"}.`
        : `${approverName} denied your request to unlock production on "${projectName}".`,
      type: "production_unlock_response",
      projectId,
      companyId,
    },
    new URL(request.url).origin,
  );
  return NextResponse.json({ ok: true, decision, expiryIso, requesterName: pending.name || "They", hours });
}
