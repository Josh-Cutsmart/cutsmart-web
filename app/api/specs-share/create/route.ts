import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import {
  SPECS_SHARE_DEFAULT_LINK_DAYS,
  buildSpecsConfirmationEmailText,
  buildSpecsShareUrl,
  getProjectDocRefAdmin,
  type SpecsShareLinkDoc,
} from "@/lib/specs-share";

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
  // The specificationsVersions doc snapshotted at the moment "Send to Client" was clicked (see
  // sendSpecsToClient in app/(app)/projects/[projectId]/page.tsx, which saves that version BEFORE
  // calling this route) — this is what the public routes actually read/write from now on, never
  // the live project doc, so the live sheet stays freely editable after sending.
  const versionId = String(body.versionId ?? "").trim();
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

  const companySnap = await adminDb.collection("companies").doc(companyId).get();
  const rawDays = Number((companySnap.data() as Record<string, unknown> | undefined)?.clientConfirmationLinkDays ?? SPECS_SHARE_DEFAULT_LINK_DAYS);
  const linkValidityDays = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : SPECS_SHARE_DEFAULT_LINK_DAYS;

  const sentByName = String((membershipSnap.data() as Record<string, unknown> | undefined)?.displayName ?? "").trim();
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + linkValidityDays * 24 * 60 * 60 * 1000).toISOString();
  const link = buildSpecsShareUrl(new URL(request.url).origin, projectId);

  // Not sent via Resend for now — the user doesn't want the client's email to come from an
  // address tied to a different domain than their own business, so the link is handed back here
  // for the "Send to Client" modal to display as copy-paste-ready text instead, which staff send
  // from their own inbox. See lib/specs-share.ts's buildSpecsConfirmationEmailText and
  // lib/email.ts's sendSpecsConfirmationEmail (kept in place, just unused for now, for whenever
  // real sending is switched back on).
  const { subject, body: emailBody } = buildSpecsConfirmationEmailText({ projectName, link, expiresInDays: linkValidityDays });

  const doc: SpecsShareLinkDoc = {
    projectId,
    companyId,
    createdAt: nowIso,
    lastSentAt: nowIso,
    expiresAt,
    clientEmail,
    sentByUid: uid,
    sentByName,
    versionId,
  };
  await adminDb.collection("specsShareLinks").doc(projectId).set(doc);

  return NextResponse.json({ ok: true, expiresAt, clientEmail, link, subject, body: emailBody, versionId });
}
