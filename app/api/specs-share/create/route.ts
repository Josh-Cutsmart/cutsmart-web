import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import {
  buildQuoteAcceptanceEmailText,
  buildSpecsConfirmationEmailText,
  buildSpecsShareUrl,
  getProjectDocRefAdmin,
  type SpecsShareLinkDoc,
} from "@/lib/specs-share";

// Creates the hub link on its first-ever send (either kind), or adds/refreshes ONE tab on an
// already-existing hub doc on every send after that — never overwrites the whole document, so
// sending the Quote to a project that already has an active Specs link (or vice versa) can never
// wipe the other tab's state. See SpecsShareLinkDoc's own header comment in lib/specs-share.ts.
export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const uid = await verifyBearerUid(request);
  if (!uid) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = String(body.companyId ?? "").trim();
  const projectId = String(body.projectId ?? "").trim();
  const projectName = String(body.projectName ?? "").trim();
  const clientEmail = String(body.clientEmail ?? "").trim();
  const kind = body.kind === "quote" ? "quote" : "specs";
  // The specificationsVersions/quoteGridVersions doc snapshotted at the moment "Send to Client"
  // was clicked (see sendSpecsToClient/sendQuoteToClient in
  // app/(app)/projects/[projectId]/page.tsx, which saves that version BEFORE calling this route)
  // — this is what the public routes actually read/write from now on, never the live project doc,
  // so the live sheet/quote stays freely editable after sending.
  const versionId = String(body.versionId ?? "").trim();
  // Whether versionId was just snapshotted from the live sheet/grid (the normal send flow) or is
  // an already-existing historical version marked sent directly from the sidebar instead — see
  // quoteSentFromLive/specsSentFromLive's own comments in lib/specs-share.ts.
  const sentFromLive = body.sentFromLive === true;
  if (!companyId || !projectId || !clientEmail || !versionId) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }

  // The caller's own Firebase Auth session only proves who they are, not that they belong to
  // this company — never trust companyId from the request body alone for authorization.
  const membershipSnap = await adminDb.collection("companies").doc(companyId).collection("memberships").doc(uid).get();
  if (!membershipSnap.exists) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const projectRef = await getProjectDocRefAdmin(adminDb, projectId, companyId);
  if (!projectRef) {
    return NextResponse.json({ ok: false, error: "project-not-found" }, { status: 404 });
  }

  const sentByName = String((membershipSnap.data() as Record<string, unknown> | undefined)?.displayName ?? "").trim();
  const nowIso = new Date().toISOString();
  const link = buildSpecsShareUrl(new URL(request.url).origin, projectId);

  // Not sent via Resend for now — the user doesn't want the client's email to come from an
  // address tied to a different domain than their own business, so the link is handed back here
  // for the "Send to Client" modal to display as copy-paste-ready text instead, which staff send
  // from their own inbox. See lib/specs-share.ts's buildSpecsConfirmationEmailText/
  // buildQuoteAcceptanceEmailText and lib/email.ts's sendSpecsConfirmationEmail (kept in place,
  // just unused for now, for whenever real sending is switched back on).
  const { subject, body: emailBody } =
    kind === "quote"
      ? buildQuoteAcceptanceEmailText({ projectName, link })
      : buildSpecsConfirmationEmailText({ projectName, link });

  const shareRef = adminDb.collection("specsShareLinks").doc(projectId);
  const existingSnap = await shareRef.get();
  const existing = existingSnap.exists ? (existingSnap.data() as SpecsShareLinkDoc) : null;

  // Only one version of a given kind may be sent at a time — the staff page's own Send button is
  // already disabled whenever one is (see sendSpecsToClient/sendQuoteToClient), but this is the
  // authoritative check: a stale/reloaded page could still fire this request after another tab (or
  // staff member) already sent a different version. Re-sending the SAME version id that's already
  // bound is a harmless no-op, allowed through.
  const alreadySentVersionId = kind === "quote" ? existing?.quoteVersionId : existing?.versionId;
  if (alreadySentVersionId && alreadySentVersionId !== versionId) {
    return NextResponse.json({ ok: false, error: "already-sent" }, { status: 409 });
  }

  const envelope = {
    projectId,
    companyId,
    createdAt: existing?.createdAt || nowIso,
    lastSentAt: nowIso,
    clientEmail,
    sentByUid: uid,
    sentByName,
  };
  // A fresh send of a kind always resets THAT kind's own confirmation/acceptance lock — a
  // re-sent Specs sheet or Quote should start unanswered/unaccepted again — but must never touch
  // the OTHER kind's fields, which is why this is FieldValue.delete() on exactly two keys per
  // branch, merged onto the doc rather than replacing it wholesale.
  const patch: Record<string, unknown> =
    kind === "quote"
      ? { ...envelope, quoteVersionId: versionId, quoteSentFromLive: sentFromLive, quoteAcceptedAt: FieldValue.delete(), quoteAcceptedByName: FieldValue.delete() }
      : { ...envelope, versionId, specsSentFromLive: sentFromLive, submittedAt: FieldValue.delete(), submittedByName: FieldValue.delete() };

  await shareRef.set(patch, { merge: true });

  return NextResponse.json({ ok: true, kind, clientEmail, link, subject, body: emailBody, versionId });
}
