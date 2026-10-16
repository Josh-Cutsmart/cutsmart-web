import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { Resend, type GetReceivingEmailResponseSuccess } from "resend";
import { adminDb, adminStorageBucket, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { leadInboxCodeFromAddress } from "@/lib/lead-inbox";
import { LEAD_INBOX_CODES_COLLECTION } from "@/lib/lead-inbox-server";
import { automatedEmailReason, buildEmailLead, gmailForwardingConfirmation, parseEmailAddress, type InboundEmail } from "@/lib/lead-email-parse";
import { takeLeadFormSubmissionSlot } from "@/lib/lead-form-public-server";
import { notifyNewLead } from "@/lib/lead-notify-server";

// Resend's "email received" webhook: an email to a company's leads inbox (<name>_<code>@leads.cutsmart.nz —
// lib/lead-inbox.ts) becomes a New lead for that company (lib/lead-email-parse.ts reads it), with its photos.
//
// - Only Resend can call it: each call is signed with the webhook's secret (RESEND_WEBHOOK_SECRET).
// - Which company: the address's code, looked up in the registry of every code handed out (leadInboxCodes) — the
//   whole address has to match, so a mistyped one goes nowhere.
// - Resend tries again if this fails, so the same email never makes two leads (its lead's id is the email's).
// - Not leads: auto-replies, newsletters, bounces. Gmail's "confirm forwarding" email is kept for Company Settings →
//   Leads to show instead. Nobody is emailed back.

export const maxDuration = 60;

const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/pjpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
// A photo sent as a plain file (e.g. "application/octet-stream") is known by its name instead.
const PHOTO_EXTENSIONS: Record<string, string> = { jpg: "jpg", jpeg: "jpg", jfif: "jpg", png: "png", webp: "webp", gif: "gif" };
const SAVED_CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
// A picture inside the email's text that's smaller than this is a logo or signature, not a photo of the job.
const MIN_INLINE_PHOTO_BYTES = 30 * 1024;

function toStr(value: unknown) {
  return String(value ?? "").trim();
}

function readEnvValue(value: string | undefined) {
  return String(value || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

// One of the email's files: its name and type, whether it sits in the email's text (inline), its size when Resend
// says (it doesn't always), and the link to download it when there is one.
type EmailFile = { id: string; filename: string; contentType: string; inline: boolean; size: number | null; downloadUrl: string };

function baseContentType(value: unknown) {
  return toStr(value).split(";")[0].trim().toLowerCase();
}

function fileSize(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

// The email's files — Resend's list of them (complete details, with download links), else the email's own list.
async function emailFiles(resend: Resend, email: GetReceivingEmailResponseSuccess): Promise<EmailFile[]> {
  try {
    const { data, error } = await resend.emails.receiving.attachments.list({ emailId: email.id });
    if (!error && data?.data) {
      return data.data.map((file) => ({
        id: toStr(file.id),
        filename: toStr(file.filename),
        contentType: baseContentType(file.content_type),
        inline: toStr(file.content_disposition).toLowerCase() === "inline",
        size: fileSize(file.size),
        downloadUrl: toStr(file.download_url),
      }));
    }
    if (error) console.error("[leads] couldn't list the email's attachments:", error);
  } catch (error) {
    console.error("[leads] couldn't list the email's attachments:", error);
  }
  return (email.attachments ?? []).map((file) => ({
    id: toStr(file.id),
    filename: toStr(file.filename),
    contentType: baseContentType(file.content_type),
    inline: toStr(file.content_disposition).toLowerCase() === "inline",
    size: fileSize(file.size),
    downloadUrl: "",
  }));
}

// "jpg", "png", … for a photo the Leads page can show; "" for anything else.
function photoExtension(file: EmailFile) {
  return PHOTO_TYPES[file.contentType] || PHOTO_EXTENSIONS[(file.filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase()] || "";
}

// An iPhone photo in its own format (HEIC), which most browsers can't show.
function isIphonePhoto(file: EmailFile) {
  return /hei[cf]/.test(file.contentType) || /\.hei[cf]$/i.test(file.filename);
}

function fileLabel(file: EmailFile, index: number) {
  return file.filename || `File ${index + 1}`;
}

// The email's photos, saved with the lead (where the Leads page keeps a lead's photos), one by one — notSaved names
// any that couldn't be, and reasons says why (for the webhook's log in Resend).
async function saveEmailPhotos(resend: Resend, emailId: string, companyId: string, leadId: string, files: EmailFile[]) {
  const saved: Array<{ url: string; name: string }> = [];
  const notSaved: string[] = [];
  const reasons: string[] = [];
  const photos = files
    .filter((file) => photoExtension(file))
    .filter((file) => !(file.inline && file.size != null && file.size < MIN_INLINE_PHOTO_BYTES))
    .slice(0, MAX_PHOTOS);
  if (!photos.length) return { saved, notSaved, reasons, tried: 0 };
  const bucket = adminStorageBucket;
  if (!bucket) {
    return { saved, notSaved: photos.map(fileLabel), reasons: ["no Firebase Storage bucket set up on the server"], tried: photos.length };
  }
  for (const [index, photo] of photos.entries()) {
    try {
      let downloadUrl = photo.downloadUrl;
      if (!downloadUrl) {
        const { data, error } = await resend.emails.receiving.attachments.get({ emailId, id: photo.id });
        if (error) throw new Error(`attachment: ${error.name || error.message}`);
        downloadUrl = toStr(data?.download_url);
      }
      if (!downloadUrl) throw new Error("no download link");
      const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`download: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      // A logo or signature after all.
      if (photo.inline && bytes.length < MIN_INLINE_PHOTO_BYTES) continue;
      if (bytes.length > MAX_PHOTO_BYTES) {
        notSaved.push(`${fileLabel(photo, index)} (over 10 MB)`);
        continue;
      }
      const extension = photoExtension(photo);
      const path = `companies/${companyId}/leads/${leadId}/images/${Date.now()}_${index + 1}.${extension}`;
      const token = randomUUID();
      await bucket.file(path).save(bytes, {
        resumable: false,
        contentType: SAVED_CONTENT_TYPES[extension],
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
      saved.push({
        url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
        name: photo.filename.replace(/\.[^.]+$/, "") || `Photo ${saved.length + 1}`,
      });
    } catch (error) {
      console.error("[leads] email photo not saved:", error);
      notSaved.push(fileLabel(photo, index));
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { saved, notSaved, reasons, tried: photos.length };
}

// What happened to the email for one company: "lead", or why there's no lead.
async function fileEmailForCompany(
  companyId: string,
  email: GetReceivingEmailResponseSuccess,
  inbound: InboundEmail,
  resend: Resend,
  siteOrigin: string,
): Promise<string> {
  const db = adminDb!;
  const companyRef = db.collection("companies").doc(companyId);
  const nowIso = new Date().toISOString();

  const gmail = gmailForwardingConfirmation(inbound);
  if (gmail) {
    await companyRef.set({ leadInbox: { gmailConfirmation: { ...gmail, receivedAtIso: nowIso } } }, { merge: true });
    return "gmail-confirmation";
  }
  const automated = automatedEmailReason(inbound);
  if (automated) return automated;

  const leadRef = companyRef.collection("leads").doc(`email_${email.id.replace(/[^A-Za-z0-9_-]/g, "")}`);
  if ((await leadRef.get()).exists) return "duplicate";
  const draft = buildEmailLead(inbound);
  if (!draft.email && !draft.phone && !draft.message) return "empty";
  const senderKey = draft.email || parseEmailAddress(inbound.from).email || "unknown";
  if (!(await takeLeadFormSubmissionSlot(companyId, `email:${senderKey}`))) return "rate-limited";

  const companyData = ((await companyRef.get()).data() ?? {}) as Record<string, unknown>;
  const firstStatus = (Array.isArray(companyData.leadStatuses) ? companyData.leadStatuses : [])
    .map((row) => toStr((row as Record<string, unknown> | null)?.name))
    .find(Boolean);
  // Files that aren't photos the Leads page can show (plans, PDFs, iPhone HEIC photos) are only named — they're in
  // the original email.
  const files = await emailFiles(resend, email);
  const otherFiles = files
    .filter((file) => !photoExtension(file) && (!file.inline || isIphonePhoto(file)))
    .map((file, index) => (isIphonePhoto(file) ? `${fileLabel(file, index)} (iPhone photo format)` : fileLabel(file, index)));
  const otherFilesNote = otherFiles.length ? `${otherFiles.join(", ")} (in the original email)` : "";
  const rawFields = { ...draft.rawFields, ...(otherFilesNote ? { Attachments: otherFilesNote } : {}) };
  const receivedIso = (() => {
    const ms = Date.parse(toStr(email.created_at));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso;
  })();

  const lead = {
    id: leadRef.id,
    companyId,
    name: draft.name,
    email: draft.email,
    phone: draft.phone,
    message: draft.message,
    formName: "Email",
    source: "email",
    sourceDetail: draft.forwarded ? "Forwarded email" : "Email",
    status: firstStatus || "New",
    rawFields,
    emailId: email.id,
    emailMessageId: toStr(email.message_id),
    emailFrom: toStr(email.from),
    emailSubject: toStr(email.subject).slice(0, 300),
    submittedAtIso: receivedIso,
    submittedAt: receivedIso,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };
  try {
    await leadRef.create({ ...lead, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    // Made by a call that's already running for this email.
    if ((error as { code?: number }).code === 6) return "duplicate";
    throw error;
  }
  // Emails are arriving — so any Gmail forwarding confirmation is done with.
  await companyRef.set({ leadInbox: { lastReceivedAtIso: nowIso, gmailConfirmation: FieldValue.delete() } }, { merge: true });

  const photos = await saveEmailPhotos(resend, email.id, companyId, leadRef.id, files);
  const patch: Record<string, unknown> = {};
  if (photos.saved.length) {
    patch.imageItems = photos.saved;
    patch.imageUrls = photos.saved.map((photo) => photo.url);
  }
  // Photos that couldn't be saved are named on the lead, so nobody thinks there weren't any.
  if (photos.notSaved.length) {
    const note = `${photos.notSaved.join(", ")} (couldn't be saved — in the original email)`;
    patch["rawFields.Attachments"] = otherFilesNote ? `${otherFilesNote}; ${note}` : note;
  }
  if (Object.keys(patch).length) await leadRef.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
  await notifyNewLead(companyId, leadRef.id, lead, siteOrigin);
  // For the webhook's log in Resend: how the photos went.
  return photos.tried
    ? `lead (photos saved ${photos.saved.length} of ${photos.tried}${photos.reasons.length ? ` — ${photos.reasons.join("; ")}` : ""})`
    : "lead";
}

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const webhookSecret = readEnvValue(process.env.RESEND_WEBHOOK_SECRET);
  const apiKey = readEnvValue(process.env.RESEND_RECEIVING_API_KEY) || readEnvValue(process.env.RESEND_API_KEY);
  if (!webhookSecret || !apiKey) {
    console.error("[leads] email inbox isn't set up: RESEND_WEBHOOK_SECRET and a Resend API key are needed");
    return NextResponse.json({ ok: false, error: "not-configured" }, { status: 500 });
  }

  const resend = new Resend(apiKey);
  const payload = await request.text();
  let event: ReturnType<Resend["webhooks"]["verify"]>;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: toStr(request.headers.get("svix-id") ?? request.headers.get("webhook-id")),
        timestamp: toStr(request.headers.get("svix-timestamp") ?? request.headers.get("webhook-timestamp")),
        signature: toStr(request.headers.get("svix-signature") ?? request.headers.get("webhook-signature")),
      },
      webhookSecret,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "bad-signature" }, { status: 401 });
  }
  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  // Which companies' inboxes it was sent to (one email can be sent to more than one).
  const recipients = [...(event.data.received_for ?? []), ...(event.data.to ?? []), ...(event.data.cc ?? [])].map((address) => parseEmailAddress(address).email);
  const inboxes = new Map<string, string>();
  for (const recipient of recipients) {
    const inbox = leadInboxCodeFromAddress(recipient);
    if (inbox && !inboxes.has(inbox.code)) inboxes.set(inbox.code, inbox.localPart);
  }
  const companyIds = new Set<string>();
  for (const [code, localPart] of inboxes) {
    const registered = await adminDb.collection(LEAD_INBOX_CODES_COLLECTION).doc(code).get();
    if (registered.exists && toStr(registered.data()?.localPart) === localPart) companyIds.add(toStr(registered.data()?.companyId));
  }
  companyIds.delete("");
  if (companyIds.size === 0) {
    return NextResponse.json({ ok: true, ignored: "no-inbox" });
  }

  const { data: email, error } = await resend.emails.receiving.get(event.data.email_id);
  if (error || !email) {
    console.error("[leads] couldn't fetch the received email:", error);
    // Resend tries again later. Its reason in the reply, so the webhook's log in Resend says why — e.g.
    // "restricted_api_key": the API key can only send emails (a Full access key is needed: RESEND_RECEIVING_API_KEY).
    return NextResponse.json({ ok: false, error: "fetch-failed", reason: String(error?.name || error?.message || "") }, { status: 502 });
  }
  const inbound: InboundEmail = {
    from: toStr(email.from),
    replyTo: email.reply_to ?? [],
    subject: toStr(email.subject),
    text: email.text,
    html: email.html,
    headers: email.headers,
  };

  const results: Record<string, string> = {};
  for (const companyId of companyIds) {
    try {
      results[companyId] = await fileEmailForCompany(companyId, email, inbound, resend, new URL(request.url).origin);
    } catch (fileError) {
      console.error("[leads] email lead not saved:", fileError);
      return NextResponse.json({ ok: false, error: "save-failed" }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, results });
}
