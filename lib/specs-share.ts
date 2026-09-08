import type { Firestore, DocumentReference } from "firebase-admin/firestore";

export const SPECS_SHARE_DEFAULT_LINK_DAYS = 30;

// One small doc doubles as a "client hub": a single link a client can be sent, that independently
// grows a Specs tab and/or a Quote tab as staff sends each one (see sendSpecsToClient/
// sendQuoteToClient in app/(app)/projects/[projectId]/page.tsx). The two tabs share only the
// envelope fields below (who/when/expiry/recipient) — everything else is a fully separate,
// symmetric pair of fields per tab, so sending one can never disturb the other's state (the
// create route merges rather than overwrites — see app/api/specs-share/create/route.ts).
export type SpecsShareLinkDoc = {
  projectId: string;
  companyId: string;
  createdAt: string;
  lastSentAt: string;
  expiresAt: string;
  clientEmail: string;
  sentByUid: string;
  sentByName: string;
  // Specs tab — which specificationsVersions subcollection document the client actually
  // sees/answers — the exact snapshot captured by "Send to Client" at the moment it was clicked
  // (see app/(app)/projects/[projectId]/page.tsx's sendSpecsToClient), never the live project
  // doc's sales.specificationsGrid. This is what makes the live sheet safe to keep editing after
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
  // Specs' own version of quoteSentFromLive below — true only when versionId was snapshotted from
  // the LIVE sheet at the exact moment it was sent, false/absent when an ALREADY-SAVED historical
  // version was marked sent directly from the sidebar instead. Specs' live sheet stays editable
  // after sending regardless (unlike Quote, it's never locked) — this only affects whether the
  // staff page's own "Pending"/"Submitted" banners are allowed to show while viewing live, so they
  // never claim live is the sent one when it has since diverged. See isViewingSentSpecsVersion's
  // own comment in app/(app)/projects/[projectId]/page.tsx.
  specsSentFromLive?: boolean;
  // Quote tab — same shape as the Specs tab above, one-to-one: which quoteGridVersions document
  // was frozen when "Send Quote to Client" was clicked (see sendQuoteToClient), and the
  // acceptance lock once the client accepts it (see app/api/specs-share/[shareId]/accept). Quote
  // has no legacy fallback — it's a brand-new flow, always version-bound — see
  // getQuoteShareGridTarget.
  quoteVersionId?: string;
  quoteAcceptedAt?: string;
  quoteAcceptedByName?: string;
  // True only when quoteVersionId was created by snapshotting the LIVE grid at the exact moment it
  // was sent (staff sending straight from the live editor) — false/absent when an ALREADY-SAVED
  // historical version was marked sent directly from the Version History sidebar instead. The live
  // grid is only actually the sent/locked one in the first case: sending a past version leaves the
  // live draft fully independent and still freely editable, so the staff page's own
  // isViewingSentQuoteVersion must never treat "viewing live" as "viewing the sent version" unless
  // this is true — see that const's own comment in app/(app)/projects/[projectId]/page.tsx.
  quoteSentFromLive?: boolean;
};

export function buildSpecsShareUrl(origin: string, projectId: string): string {
  return `${origin}/client/hub/${projectId}`;
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

// Quote's own version of buildSpecsConfirmationEmailText above — kept as a separate function
// rather than a shared "kind" parameter since Specs and Quote are sent as two independent staff
// actions at two independent times, so each email should describe only the one document that was
// just sent, never a "hub" the client hasn't necessarily seen anything else on yet.
export function buildQuoteAcceptanceEmailText({
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
    subject: `Please review your quote for ${cleanProjectName}`,
    body: `Please review and accept the quote for ${cleanProjectName}:\n\n${link}\n\nThis link is valid for ${expiresInDays} day${expiresInDays === 1 ? "" : "s"}. If you weren't expecting this, you can ignore it.`,
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

export type AssignedContact = { name: string; email: string; mobile: string };

// Resolves the project's assigned staff member's own name/email/mobile for the public "Your point
// of contact" bubble (app/client/hub/[shareId]/page.tsx) — never the raw project doc, which may
// hold unrelated sensitive data. `assignedToUid` is the one true single-assignee field on a project
// (see Project type in lib/types.ts; `assignedToName`/`assignedTo` are just display-name snapshots
// kept alongside it). Mirrors fetchCompanyMembers' own membership-doc-first, users/{uid}-fallback
// order (lib/firestore-data.ts) exactly, so a name/email/mobile shown here always matches what
// staff see of themselves in Staff & Permissions.
export async function resolveAssignedContactAdmin(
  adminDb: Firestore,
  companyId: string,
  projectData: Record<string, unknown>,
): Promise<AssignedContact | null> {
  const assignedUid = String(projectData.assignedToUid ?? "").trim();
  const fallbackName = String(projectData.assignedToName ?? projectData.assignedTo ?? "").trim();
  if (!assignedUid) {
    return fallbackName ? { name: fallbackName, email: "", mobile: "" } : null;
  }
  try {
    const membershipSnap = await adminDb.collection("companies").doc(companyId).collection("memberships").doc(assignedUid).get();
    const membershipData = (membershipSnap.data() ?? {}) as Record<string, unknown>;
    let name = String(membershipData.displayName ?? "").trim();
    let email = String(membershipData.email ?? "").trim();
    let mobile = String(membershipData.mobile ?? membershipData.phone ?? "").trim();
    if (!name || !email || !mobile) {
      const userSnap = await adminDb.collection("users").doc(assignedUid).get();
      const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
      if (!name) name = String(userData.displayName ?? "").trim();
      if (!email) email = String(userData.email ?? "").trim();
      if (!mobile) mobile = String(userData.mobile ?? userData.phone ?? "").trim();
    }
    name = name || fallbackName;
    if (!name && !email && !mobile) return null;
    return { name: name || "Your contact", email, mobile };
  } catch {
    return fallbackName ? { name: fallbackName, email: "", mobile: "" } : null;
  }
}

// Quote's own version of getSpecsShareGridTarget — deliberately has no legacy-project fallback.
// Unlike Specs (which predates the versionId field and once bound directly to the live project
// doc), Quote sharing is brand new and always version-bound, so a missing quoteVersionId always
// means "the Quote was never sent to this hub link" — callers should hide/404 the Quote tab
// rather than fall back to reading anything live.
export function getQuoteShareGridTarget(
  projectRef: DocumentReference,
  shareDoc: Pick<SpecsShareLinkDoc, "quoteVersionId">,
): { kind: "version"; ref: DocumentReference } | null {
  const versionId = String(shareDoc.quoteVersionId ?? "").trim();
  if (!versionId) return null;
  return { kind: "version", ref: projectRef.collection("quoteGridVersions").doc(versionId) };
}
