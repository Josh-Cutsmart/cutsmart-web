import type { Firestore, DocumentReference } from "firebase-admin/firestore";

export const SPECS_SHARE_DEFAULT_LINK_DAYS = 30;

export type SpecsShareLinkDoc = {
  projectId: string;
  companyId: string;
  createdAt: string;
  lastSentAt: string;
  expiresAt: string;
  clientEmail: string;
  sentByUid: string;
  sentByName: string;
  // Which specificationsVersions subcollection document the client actually sees/answers — the
  // exact snapshot captured by "Send to Client" at the moment it was clicked (see
  // app/(app)/projects/[projectId]/page.tsx's sendSpecsToClient), never the live project doc's
  // sales.specificationsGrid. This is what makes the live sheet safe to keep editing after
  // sending: the public routes below only ever read/write this one version document, so further
  // staff edits to the live draft can never reach an already-shared link. Optional only for
  // backward compatibility with a link created before this field existed — see getSpecsShareGridTarget.
  versionId?: string;
  // The sheet-wide client-confirmation lock (see app/api/specs-share/[shareId]/submit) — kept on
  // this small, separate document rather than on the project doc itself, since a large project
  // (an oversized specs sheet, big quote history, etc.) can already sit right at Firestore's 1MB
  // per-document limit, and every byte added to it risks tipping an unrelated future save over
  // that edge. Absent = not submitted.
  submittedAt?: string;
  submittedByName?: string;
};

export function buildSpecsShareUrl(origin: string, projectId: string): string {
  return `${origin}/client/specs/${projectId}`;
}

// Shared by lib/email.ts's sendSpecsConfirmationEmail (if/when real sending is switched back on)
// and the "Send to Client" modal's copy-to-clipboard fallback — one place for the actual wording
// so the two never drift apart. Not sending via Resend for now: the user doesn't want the client
// to receive an email whose "from" address is tied to a different domain than their own business,
// so staff copy this text into their own email client instead — see
// app/api/specs-share/create/route.ts.
//
// No access code — the link itself (its shareId is the project's own id, a long, non-sequential
// string) is treated as the only secret, per the user's explicit call that a separate code isn't
// worth the friction for how unlikely the URL is to be guessed. This is a deliberate trade-off
// for a low-security-sensitivity feature, not an oversight — see this file's own header comment.
export function buildSpecsConfirmationEmailText({
  projectName,
  link,
  expiresInDays,
}: {
  projectName: string;
  link: string;
  expiresInDays: number;
}): { subject: string; body: string } {
  const cleanProjectName = String(projectName || "").trim() || "your project";
  return {
    subject: `Please confirm specifications for ${cleanProjectName}`,
    body: `Please review and confirm the specifications for ${cleanProjectName}:\n\n${link}\n\nThis link is valid for ${expiresInDays} day${expiresInDays === 1 ? "" : "s"}. If you weren't expecting this, you can ignore it.`,
  };
}

export function isSpecsShareLinkExpired(doc: Pick<SpecsShareLinkDoc, "expiresAt">): boolean {
  const expiry = Date.parse(doc.expiresAt);
  return !Number.isFinite(expiry) || Date.now() > expiry;
}

// The caller's own Firebase Auth session only proves who they are, not that they belong to a
// given company — used by every internal-authenticated specs-share route (create/status/reopen)
// before trusting a companyId for anything. Any role qualifies (not just owner/admin): any staff
// member with access to open a project's Specifications tab should be able to manage its share
// link.
export async function verifyCompanyMembershipAdmin(adminDb: Firestore, companyId: string, uid: string): Promise<boolean> {
  if (!companyId || !uid) return false;
  const snap = await adminDb.collection("companies").doc(companyId).collection("memberships").doc(uid).get();
  return snap.exists;
}

// Mirrors lib/firestore-data.ts's updateProjectPatch fallback order (projects/{id}, then
// companies/{companyId}/jobs/{id}) but via the admin SDK for a caller with no Firebase Auth
// session (the public client-confirmation routes) or one that shouldn't be trusted with the
// client Firestore SDK's own rules (the internal create-share-link route, which needs to read a
// project it doesn't necessarily have direct rule-based read access to check membership on).
export async function getProjectDocRefAdmin(
  adminDb: Firestore,
  projectId: string,
  companyId: string,
): Promise<DocumentReference | null> {
  const topLevel = adminDb.collection("projects").doc(projectId);
  if ((await topLevel.get()).exists) return topLevel;
  if (!companyId) return null;
  const jobsSnap = await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .where("id", "==", projectId)
    .limit(1)
    .get();
  return jobsSnap.empty ? null : jobsSnap.docs[0].ref;
}

// Where a share link's grid actually lives — the version subcollection document it was created
// against (see SpecsShareLinkDoc.versionId's own comment), or, only for a link created before that
// field existed, the live project doc's sales.specificationsGrid exactly like before. Every public
// route (grid/answer/submit) shares this one resolution so the two field shapes never drift.
export type SpecsShareGridTarget =
  | { kind: "version"; ref: DocumentReference }
  | { kind: "legacy-project"; ref: DocumentReference };

export function getSpecsShareGridTarget(projectRef: DocumentReference, shareDoc: Pick<SpecsShareLinkDoc, "versionId">): SpecsShareGridTarget {
  const versionId = String(shareDoc.versionId ?? "").trim();
  if (versionId) {
    return { kind: "version", ref: projectRef.collection("specificationsVersions").doc(versionId) };
  }
  return { kind: "legacy-project", ref: projectRef };
}
