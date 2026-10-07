import { NextResponse, type NextRequest } from "next/server";
import { FieldPath } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { listCompanyMemberAccess, requireCompanyMember } from "@/lib/api-company-access";
import { getProjectDocRefAdmin } from "@/lib/specs-share";
import { displayNameIn, productionUnlockApproverUids, signUnlockActionToken } from "@/lib/production-unlock-server";
import { sendPushToUser } from "@/lib/push-server";

// "Request unlock" (the project page's Unlock Edit pop-up): records the signed-in user's request on the
// project and notifies everyone who can approve it — in their Notifications list, and on their devices
// with Approve/Deny buttons (lib/production-unlock-server.ts).
export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as { companyId?: unknown; projectId?: unknown };
  const companyId = String(body.companyId ?? "").trim();
  const projectId = String(body.projectId ?? "").trim();
  if (!companyId || !projectId) return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  const access = await requireCompanyMember(request, companyId);
  if (!access) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const projectRef = await getProjectDocRefAdmin(adminDb, projectId, companyId);
  const projectSnap = projectRef ? await projectRef.get() : null;
  if (!projectRef || !projectSnap?.exists) return NextResponse.json({ ok: false, error: "project-not-found" }, { status: 404 });
  const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
  if (projectData.isArchived === true || projectData.isDeleted === true) {
    return NextResponse.json({ ok: false, error: "project-archived" }, { status: 409 });
  }

  const members = await listCompanyMemberAccess(companyId);
  const requesterName = displayNameIn(members, access.uid);
  const requestedAtIso = new Date().toISOString();
  await projectRef.update(new FieldPath("productionUnlockRequests", access.uid), { requestedAtIso, name: requesterName });

  const approvers = (await productionUnlockApproverUids(companyId, projectData)).filter((uid) => uid !== access.uid);
  const projectName = String(projectData.name || "a project").trim() || "a project";
  const siteOrigin = new URL(request.url).origin;
  await Promise.all(
    approvers.map(async (approverUid) => {
      try {
        const ref = await adminDb!.collection("users").doc(approverUid).collection("notifications").add({
          title: "Production unlock request",
          message: `${requesterName} asked to unlock production on "${projectName}".`,
          type: "production_unlock_request",
          projectId,
          companyId,
          read: false,
          createdAt: new Date(requestedAtIso),
          createdAtIso: requestedAtIso,
          // Sent below, with its buttons — never again by the generic sender.
          pushedAtIso: requestedAtIso,
        });
        const token = signUnlockActionToken({ companyId, projectId, requesterUid: access.uid, approverUid, requestedAtIso });
        await sendPushToUser(
          approverUid,
          {
            title: "Production unlock request",
            body: `${requesterName} asked to unlock production on "${projectName}".`,
            url: `/projects/${encodeURIComponent(projectId)}?tab=production`,
            tag: `unlock_${projectId}_${access.uid}_${ref.id}`,
            ...(token
              ? {
                  actions: [
                    { action: "approve", title: "Approve" },
                    { action: "deny", title: "Deny" },
                  ],
                  actionUrl: "/api/production-unlock/respond",
                  actionToken: token,
                }
              : {}),
          },
          { type: "production_unlock_request", siteOrigin },
        );
      } catch (error) {
        console.error("[production-unlock/request] notify failed:", error);
      }
    }),
  );
  return NextResponse.json({ ok: true, requestedAtIso, approvers: approvers.length });
}
