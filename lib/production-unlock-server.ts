import { createHash, createHmac, timingSafeEqual } from "crypto";
import { FieldPath, FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { listCompanyMemberAccess } from "@/lib/api-company-access";

// Production unlock requests. Someone without production edit asks to unlock a project's production
// (app/api/production-unlock/request); the people who can let them in — the project's creator and
// assignee, anyone with edit access to the project, and the company's owners/admins (the same people the
// project page lets remove an unlock) — are notified, and approve or deny it from the notification
// (Android/computers: buttons on the notification, via a signed token — see actionToken below) or from
// the project page (app/api/production-unlock/respond). Approving grants the usual temporary production
// edit (projectSettings.productionTempEdit, for the company's productionUnlockDurationHours).
//
// A pending request is the project doc's top-level productionUnlockRequests.{uid} = { requestedAtIso,
// name } — top level, so the project page's own saves of projectSettings never wipe it.

const PROJECT_ASSIGNEE_FIELDS = ["assignedToUid", "assignedUid", "projectAssignedUid"];

function str(value: unknown): string {
  return String(value ?? "").trim();
}

export type UnlockRequest = { requestedAtIso: string; name: string };

export function pendingUnlockRequests(projectData: Record<string, unknown>): Record<string, UnlockRequest> {
  const raw = projectData.productionUnlockRequests;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, UnlockRequest> = {};
  for (const [uid, value] of Object.entries(raw as Record<string, unknown>)) {
    const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    if (str(uid) && str(row.requestedAtIso)) out[uid] = { requestedAtIso: str(row.requestedAtIso), name: str(row.name) };
  }
  return out;
}

// Who can approve: the project's creator, assignee and editors, and the company's owners/admins — those
// still in the company.
export async function productionUnlockApproverUids(companyId: string, projectData: Record<string, unknown>): Promise<string[]> {
  const members = await listCompanyMemberAccess(companyId);
  const memberUids = new Set(members.map((member) => member.access.uid));
  const settings = (projectData.projectSettings ?? {}) as Record<string, unknown>;
  const permissions = (settings.projectPermissionsByUid ?? settings.userAccessByUid ?? settings.memberAccessByUid ?? {}) as Record<string, unknown>;
  const uids = new Set<string>();
  const add = (uid: unknown) => {
    const clean = str(uid);
    if (clean && memberUids.has(clean)) uids.add(clean);
  };
  add(projectData.createdByUid);
  PROJECT_ASSIGNEE_FIELDS.forEach((field) => add(projectData[field]));
  Object.entries(permissions).forEach(([uid, level]) => {
    if (str(level).toLowerCase() === "edit") add(uid);
  });
  members.forEach((member) => {
    if (member.access.role === "owner" || member.access.role === "admin") add(member.access.uid);
  });
  return Array.from(uids);
}

export function displayNameIn(members: Awaited<ReturnType<typeof listCompanyMemberAccess>>, uid: string): string {
  return members.find((member) => member.access.uid === uid)?.displayName || "A teammate";
}

export async function unlockDurationHours(companyId: string): Promise<number> {
  if (!adminDb) return 6;
  const snap = await adminDb.collection("companies").doc(companyId).get();
  const hours = Number(snap.data()?.productionUnlockDurationHours);
  return Number.isFinite(hours) ? Math.max(1, Math.min(168, Math.round(hours))) : 6;
}

// Approve: the requester gets temporary production edit (same fields grantTempProductionAccess writes),
// and the request is cleared. Deny: just cleared.
export async function answerUnlockRequest(projectRef: DocumentReference, requesterUid: string, approve: boolean, hours: number): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const expiryIso = approve ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null;
  const requestPath = new FieldPath("productionUnlockRequests", requesterUid);
  if (expiryIso) {
    await projectRef.update(
      requestPath,
      FieldValue.delete(),
      new FieldPath("projectSettings", "productionTempEdit", requesterUid),
      expiryIso,
      new FieldPath("productionTempEdit", requesterUid),
      expiryIso,
      "updatedAtIso",
      nowIso,
    );
  } else {
    await projectRef.update(requestPath, FieldValue.delete(), "updatedAtIso", nowIso);
  }
  return expiryIso;
}

// ---- The notification's Approve/Deny buttons can't sign in (they run in the background, from the
// phone's notification), so each approver's notification carries its own token: signed by the server,
// naming the project, the request, and the approver it was sent to, and valid for 2 days.

const TOKEN_TTL_MS = 2 * 24 * 60 * 60 * 1000;

function signingKey(): Buffer | null {
  const secret = str(process.env.VAPID_PRIVATE_KEY) || str(process.env.FIREBASE_ADMIN_PRIVATE_KEY);
  return secret ? createHash("sha256").update(`cutsmart-unlock-actions:${secret}`).digest() : null;
}

export type UnlockActionClaims = { companyId: string; projectId: string; requesterUid: string; approverUid: string; requestedAtIso: string };

export function signUnlockActionToken(claims: UnlockActionClaims): string | null {
  const key = signingKey();
  if (!key) return null;
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Date.now() + TOKEN_TTL_MS })).toString("base64url");
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyUnlockActionToken(token: string): UnlockActionClaims | null {
  const key = signingKey();
  const [body, sig] = String(token || "").split(".");
  if (!key || !body || !sig) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UnlockActionClaims & { exp?: number };
    if (!claims.exp || Date.now() > claims.exp) return null;
    if (!claims.companyId || !claims.projectId || !claims.requesterUid || !claims.approverUid || !claims.requestedAtIso) return null;
    return claims;
  } catch {
    return null;
  }
}
