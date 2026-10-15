import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { apiHasPermission, requireCompanyMember } from "@/lib/api-company-access";
import { collectLeadFormAnswers, MANUAL_LEAD_SOURCES, normalizeLeadForms, type LeadFormAnswers } from "@/lib/lead-forms";
import { notifyNewLead } from "@/lib/lead-notify-server";

// Create Lead on the Leads page: a lead entered by a staff member, on one of the company's lead forms
// (lib/lead-forms.ts) — the answers checked and filed exactly as a customer's would be, except staff may leave
// out required questions (on a phone call you don't always get everything). Plus how it came in (sourceDetail),
// its status and who it's assigned to. Someone who can only see their own leads always gets it assigned to them,
// so they can see what they've just added.

function toStr(value: unknown) {
  return String(value ?? "").trim();
}

async function memberName(companyId: string, uid: string): Promise<string | null> {
  const snap = await adminDb!.collection("companies").doc(companyId).collection("memberships").doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return toStr(data.displayName ?? data.name) || "A teammate";
}

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const companyId = toStr(body.companyId);
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "missing-company-id" }, { status: 400 });
  }
  const access = await requireCompanyMember(request, companyId);
  if (!access) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const seesOthers = apiHasPermission(access, "leads.view.others");
  if (!seesOthers && !apiHasPermission(access, "leads.view")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const companyRef = adminDb.collection("companies").doc(companyId);
  const companyData = ((await companyRef.get()).data() ?? {}) as Record<string, unknown>;
  const form = normalizeLeadForms(companyData.leadForms).find((row) => row.id === toStr(body.formId));
  if (!form) {
    return NextResponse.json({ ok: false, error: "form-not-found" }, { status: 404 });
  }
  const answers = (body.answers && typeof body.answers === "object" ? body.answers : {}) as LeadFormAnswers;
  const submission = collectLeadFormAnswers(form, answers, { skipRequired: true });
  if (Object.keys(submission.errors).length > 0) {
    return NextResponse.json({ ok: false, error: "invalid-answers", errors: submission.errors }, { status: 400 });
  }
  if (submission.answeredCount === 0) {
    return NextResponse.json({ ok: false, error: "empty-lead" }, { status: 400 });
  }

  // One of the company's lead statuses (the board's columns) — else its first.
  const statusNames = (Array.isArray(companyData.leadStatuses) ? companyData.leadStatuses : [])
    .map((row) => toStr((row as Record<string, unknown> | null)?.name))
    .filter(Boolean);
  const requestedStatus = toStr(body.status);
  const status = statusNames.find((name) => name.toLowerCase() === requestedStatus.toLowerCase()) || statusNames[0] || "New";
  const requestedSource = toStr(body.sourceDetail);
  const sourceDetail = (MANUAL_LEAD_SOURCES as readonly string[]).includes(requestedSource) ? requestedSource : "Other";

  const creatorName = (await memberName(companyId, access.uid)) || "A teammate";
  let assignedToUid = seesOthers ? toStr(body.assignedToUid) : access.uid;
  let assignedToName = "";
  if (assignedToUid) {
    const name = assignedToUid === access.uid ? creatorName : await memberName(companyId, assignedToUid);
    if (name) assignedToName = name;
    else assignedToUid = "";
  }

  const nowIso = new Date().toISOString();
  const leadRef = companyRef.collection("leads").doc();
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
    source: "manual",
    sourceDetail,
    status,
    rawFields: submission.rawFields,
    assignedToUid,
    assignedToName,
    assignedTo: assignedToName,
    createdByUid: access.uid,
    createdByName: creatorName,
    submittedAtIso: nowIso,
    submittedAt: nowIso,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };
  try {
    await leadRef.set({ ...lead, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  } catch {
    return NextResponse.json({ ok: false, error: "lead-save-failed" }, { status: 500 });
  }
  await notifyNewLead(companyId, leadRef.id, lead, new URL(request.url).origin, { uid: access.uid, name: creatorName });
  return NextResponse.json({ ok: true, leadId: leadRef.id });
}
