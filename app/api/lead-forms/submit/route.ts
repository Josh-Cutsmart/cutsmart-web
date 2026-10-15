import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { collectLeadFormAnswers, type LeadFormAnswers } from "@/lib/lead-forms";
import {
  checkLeadFormTicket,
  countLinks,
  loadPublicLeadForm,
  submissionPlace,
  takeLeadFormSubmissionSlot,
} from "@/lib/lead-form-public-server";
import { notifyNewLead } from "@/lib/lead-notify-server";

// A lead form sent from its public page or a company's website (app/f/[companyId]/[formId]) — no sign-in, so it's
// checked for robots first (lib/lead-form-public-server.ts), then answered exactly as the form asks (required
// questions too) and saved as a New lead, with the usual "New lead" notification. Nobody is emailed back.

const MAX_LINKS = 3;

function toStr(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 500 });
  }
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const companyId = toStr(body.companyId);
  const formId = toStr(body.formId);
  if (!companyId || !formId) {
    return NextResponse.json({ ok: false, error: "form-not-found" }, { status: 404 });
  }
  // The box people never see: only a robot fills it in. It's told it worked, and nothing is saved.
  if (toStr(body.website)) {
    return NextResponse.json({ ok: true });
  }
  const ticket = checkLeadFormTicket(companyId, formId, toStr(body.ticket));
  if (ticket !== "ok") {
    return NextResponse.json({ ok: false, error: ticket === "too-fast" ? "too-fast" : "expired" }, { status: 400 });
  }

  const loaded = await loadPublicLeadForm(companyId, formId);
  if (!loaded) {
    return NextResponse.json({ ok: false, error: "form-not-found" }, { status: 404 });
  }
  const { form, companyData } = loaded;
  const answers = (body.answers && typeof body.answers === "object" ? body.answers : {}) as LeadFormAnswers;
  const submission = collectLeadFormAnswers(form, answers);
  if (Object.keys(submission.errors).length > 0) {
    return NextResponse.json({ ok: false, error: "invalid-answers", errors: submission.errors }, { status: 400 });
  }
  if (submission.answeredCount === 0) {
    return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
  }
  if (countLinks(Object.values(submission.rawFields)) > MAX_LINKS) {
    return NextResponse.json({ ok: false, error: "too-many-links" }, { status: 400 });
  }
  try {
    if (!(await takeLeadFormSubmissionSlot(companyId, submissionPlace(request.headers)))) {
      return NextResponse.json({ ok: false, error: "rate-limited" }, { status: 429 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 500 });
  }

  // A New lead — the company's first lead status (the first column on its Leads board).
  const firstStatus = (Array.isArray(companyData.leadStatuses) ? companyData.leadStatuses : [])
    .map((row) => toStr((row as Record<string, unknown> | null)?.name))
    .find(Boolean);
  // The website page it was sent from, when it was embedded on one.
  let sourcePage = "";
  try {
    const page = new URL(toStr(body.pageUrl));
    if (page.protocol === "https:" || page.protocol === "http:") sourcePage = `${page.origin}${page.pathname}`.slice(0, 300);
  } catch {
    sourcePage = "";
  }

  const nowIso = new Date().toISOString();
  const leadRef = adminDb.collection("companies").doc(companyId).collection("leads").doc();
  const lead = {
    id: leadRef.id,
    companyId,
    name: submission.contact.name,
    email: submission.contact.email,
    phone: submission.contact.phone,
    message: submission.contact.message,
    formId: form.id,
    formName: form.name,
    formFieldKeys: submission.formFieldKeys,
    source: "web-form",
    sourceDetail: "Website",
    sourcePage,
    status: firstStatus || "New",
    rawFields: submission.rawFields,
    submittedAtIso: nowIso,
    submittedAt: nowIso,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };
  try {
    await leadRef.set({ ...lead, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  } catch {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 500 });
  }
  await notifyNewLead(companyId, leadRef.id, lead, new URL(request.url).origin);
  return NextResponse.json({ ok: true });
}
