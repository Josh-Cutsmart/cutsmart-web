import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { requireCompanyMember } from "@/lib/api-company-access";
import { sendStaffEmail } from "@/lib/email";

// A project's copy, emailed to the company's own staff as it's deleted for good (the Archive's "Delete permanently"
// pop-up — lib/project-email-copy.ts builds it):
// - Only a member of the company can send one, and only to the company's own staff — picked by uid; their addresses are
//   looked up here, never taken from the request.
// - The subject is "Deleted: <project name>"; the client details (if sent) are in the body.
// - Its files (PDFs and images) were uploaded by the sender into the project's own Storage folder (…/email-copy/), and are
//   read from there
//   with the sender's own sign-in (so Storage's rules apply as for them) — files that size don't fit in a request.
export const maxDuration = 60;

const toStr = (value: unknown) => String(value ?? "").trim();
// Resend takes up to 40MB an email, attachments included (and base64 makes them a third bigger).
const MAX_ATTACHMENT_BYTES = 28 * 1024 * 1024;

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = toStr(body.companyId);
  const projectId = toStr(body.projectId);
  const projectName = toStr(body.projectName).slice(0, 200) || "Project";
  if (!companyId || !projectId || /[/\\]/.test(projectId)) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }
  const access = await requireCompanyMember(request, companyId);
  if (!access) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const company = adminDb.collection("companies").doc(companyId);

  // The recipients: the company's own staff only.
  const recipientUids = Array.from(new Set((Array.isArray(body.recipientUids) ? body.recipientUids : []).map(toStr).filter(Boolean))).slice(0, 50);
  const recipients = (
    await Promise.all(
      recipientUids.map(async (uid) => {
        const [membershipSnap, userSnap] = await Promise.all([company.collection("memberships").doc(uid).get(), adminDb!.collection("users").doc(uid).get()]);
        if (!membershipSnap.exists) return "";
        return toStr(membershipSnap.data()?.email) || toStr(userSnap.data()?.email);
      }),
    )
  ).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (!recipients.length) {
    return NextResponse.json({ ok: false, error: "no-recipients" }, { status: 400 });
  }

  // Who's sending it — for the email's first line.
  const [senderMembership, senderUser] = await Promise.all([company.collection("memberships").doc(access.uid).get(), adminDb.collection("users").doc(access.uid).get()]);
  const senderName =
    toStr(senderMembership.data()?.displayName) || toStr(senderUser.data()?.displayName) || toStr(senderUser.data()?.name) || toStr(senderUser.data()?.email) || "Someone";

  // Its PDFs, from the project's own email-copy folder, read as the sender.
  const bucket = toStr(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  const idToken = toStr(request.headers.get("authorization")).replace(/^Bearer\s+/i, "");
  const folder = `companies/${companyId}/jobs/${projectId}/email-copy/`;
  const wanted = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 20) as Array<Record<string, unknown>>;
  const ATTACHABLE = /\.(pdf|jpe?g|png|webp|gif|heic|heif)$/i;
  const attachments: Array<{ filename: string; content: Buffer }> = [];
  let totalBytes = 0;
  for (const item of wanted) {
    const path = toStr(item.path);
    const filename = toStr(item.filename).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120) || "Attachment.pdf";
    if (!bucket || !idToken || !path.startsWith(folder) || path.includes("..") || !ATTACHABLE.test(path)) {
      return NextResponse.json({ ok: false, error: "bad-attachment" }, { status: 400 });
    }
    const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media`, {
      headers: { Authorization: `Firebase ${idToken}` },
    }).catch(() => null);
    if (!response?.ok) {
      return NextResponse.json({ ok: false, error: "attachment-unreadable" }, { status: 502 });
    }
    const content = Buffer.from(await response.arrayBuffer());
    totalBytes += content.length;
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ ok: false, error: "attachments-too-large" }, { status: 413 });
    }
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    attachments.push({ filename: filename.toLowerCase().endsWith(ext) ? filename : `${filename}${ext}`, content });
  }

  // The body: who deleted it and when, its client details (if sent), and what's attached — or wasn't there to attach.
  const clientDetails = (Array.isArray(body.clientDetails) ? body.clientDetails : [])
    .slice(0, 30)
    .map((row) => ({ label: toStr((row as Record<string, unknown>)?.label).slice(0, 60), value: toStr((row as Record<string, unknown>)?.value).slice(0, 1000) }))
    .filter((row) => row.label && row.value);
  const missing = (Array.isArray(body.missing) ? body.missing : []).map(toStr).filter(Boolean).slice(0, 10);
  const deletedOn = toStr(body.deletedOnLabel).slice(0, 80) || new Date().toUTCString();
  const intro = `${senderName} deleted "${projectName}" permanently on ${deletedOn}. This is a copy of it.`;
  const attachedLine = attachments.length ? `Attached: ${attachments.map((file) => file.filename).join(", ")}.` : "";
  const missingLine = missing.length ? `Not on this project, so not attached: ${missing.join(", ")}.` : "";

  const text = [
    intro,
    clientDetails.length ? ["", "Client details", ...clientDetails.map((row) => `${row.label}: ${row.value}`)].join("\n") : "",
    attachedLine ? `\n${attachedLine}` : "",
    missingLine ? `\n${missingLine}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#111827;line-height:1.5">
<p style="margin:0 0 16px">${escapeHtml(intro)}</p>
${
  clientDetails.length
    ? `<p style="margin:0 0 6px;font-weight:600">Client details</p>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px">${clientDetails
        .map(
          (row) =>
            `<tr><td style="padding:3px 16px 3px 0;color:#6B7280;vertical-align:top;white-space:nowrap">${escapeHtml(row.label)}</td><td style="padding:3px 0;white-space:pre-line">${escapeHtml(row.value)}</td></tr>`,
        )
        .join("")}</table>`
    : ""
}${attachedLine ? `<p style="margin:0 0 6px">${escapeHtml(attachedLine)}</p>` : ""}${missingLine ? `<p style="margin:0;color:#6B7280">${escapeHtml(missingLine)}</p>` : ""}
</div>`;

  const sent = await sendStaffEmail({ to: recipients, subject: `Deleted: ${projectName}`, text, html, attachments });
  if (!sent.ok) {
    console.error("[email-copy] couldn't send:", sent.error);
    return NextResponse.json({ ok: false, error: sent.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sentTo: recipients.length });
}
