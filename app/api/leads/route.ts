import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";

function toStr(value: unknown) {
  return String(value ?? "").trim();
}

function pickFirstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const next = toStr(value);
    if (next) return next;
  }
  return "";
}

function readZapierLeadsConfig(companyDoc: Record<string, unknown> | null) {
  const integrations =
    companyDoc?.integrations && typeof companyDoc.integrations === "object"
      ? (companyDoc.integrations as Record<string, unknown>)
      : {};
  const zapierLeads =
    integrations.zapierLeads && typeof integrations.zapierLeads === "object"
      ? (integrations.zapierLeads as Record<string, unknown>)
      : {};
  return {
    enabled: Boolean(zapierLeads.enabled),
    webhookSecret: toStr(zapierLeads.webhookSecret),
  };
}

async function parseBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const parsed = await request.json().catch(() => ({}));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData().catch(() => null);
    if (!form) return {};
    const out: Record<string, unknown> = {};
    form.forEach((value, key) => {
      out[key] = typeof value === "string" ? value : value.name;
    });
    return out;
  }
  return {};
}

function toIsoString(value: unknown, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return fallback;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
  }
  if (value && typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
    try {
      const parsed = (value as { toDate: () => Date }).toDate();
      return parsed.toISOString();
    } catch {
      return fallback;
    }
  }
  if (value instanceof Date) return value.toISOString();
  return fallback;
}

export async function GET(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const url = new URL(request.url);
  const companyId = pickFirstNonEmpty(
    url.searchParams.get("companyId"),
    url.searchParams.get("companyID"),
  );
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "missing-company-id" }, { status: 400 });
  }

  try {
    const snap = await adminDb
      .collection("companies")
      .doc(companyId)
      .collection("leads")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();
    const leads = snap.docs.map((docSnap) => {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      return {
        id: String(data.id ?? docSnap.id),
        companyId,
        name: toStr(data.name),
        email: toStr(data.email),
        phone: toStr(data.phone),
        message: toStr(data.message),
        formName: toStr(data.formName),
        submittedAtIso: toIsoString(data.submittedAtIso ?? data.submittedAt, ""),
        createdAtIso: toIsoString(data.createdAtIso ?? data.createdAt, ""),
        source: toStr(data.source) || "zapier-form",
        status: (() => {
          const raw = toStr(data.status).toLowerCase();
          return raw === "contacted" || raw === "converted" || raw === "archived" ? raw : "new";
        })(),
        rawFields:
          data.rawFields && typeof data.rawFields === "object"
            ? (data.rawFields as Record<string, unknown>)
            : undefined,
      };
    });
    return NextResponse.json({ ok: true, leads });
  } catch {
    return NextResponse.json({ ok: false, error: "lead-read-failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const url = new URL(request.url);
  const body = await parseBody(request);
  const companyId = pickFirstNonEmpty(
    body.companyId,
    body.companyID,
    body.company_id,
    url.searchParams.get("companyId"),
    url.searchParams.get("companyID"),
    request.headers.get("x-company-id"),
  );
  const token = pickFirstNonEmpty(
    url.searchParams.get("token"),
    request.headers.get("x-zapier-secret"),
    body.token,
    body.webhookSecret,
    body.zapierSecret,
  );

  if (!companyId || !token) {
    return NextResponse.json(
      {
        ok: false,
        error: !companyId ? "missing-company-id" : "missing-webhook-token",
      },
      { status: 400 },
    );
  }

  const companySnap = await adminDb.collection("companies").doc(companyId).get().catch(() => null);
  const companyDoc = companySnap?.exists ? ((companySnap.data() ?? {}) as Record<string, unknown>) : null;
  if (!companyDoc) {
    return NextResponse.json({ ok: false, error: "company-not-found" }, { status: 404 });
  }
  const zapier = readZapierLeadsConfig(companyDoc);

  if (!zapier.enabled) {
    return NextResponse.json({ ok: false, error: "zapier-leads-disabled" }, { status: 403 });
  }
  if (!zapier.webhookSecret) {
    return NextResponse.json({ ok: false, error: "missing-company-webhook-secret" }, { status: 403 });
  }
  if (zapier.webhookSecret !== token) {
    return NextResponse.json({ ok: false, error: "webhook-token-mismatch" }, { status: 403 });
  }

  const submittedAtIso = toStr(body.submittedAt) || new Date().toISOString();
  const payload = {
    companyId,
    name: toStr(body.name),
    email: toStr(body.email),
    phone: toStr(body.phone),
    message: toStr(body.message),
    formName: toStr(body.formName),
    submittedAtIso,
    source: toStr(body.source) || "zapier-form",
    status: "new",
  };

  const leadRef = adminDb.collection("companies").doc(companyId).collection("leads").doc();
  try {
    await leadRef.set({
      id: leadRef.id,
      ...payload,
      rawFields: body,
      submittedAt: submittedAtIso,
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "lead-save-failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, leadId: leadRef.id });
}

export async function DELETE(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const url = new URL(request.url);
  const body = await parseBody(request);
  const companyId = pickFirstNonEmpty(
    body.companyId,
    body.companyID,
    body.company_id,
    url.searchParams.get("companyId"),
    url.searchParams.get("companyID"),
    request.headers.get("x-company-id"),
  );
  const token = pickFirstNonEmpty(
    url.searchParams.get("token"),
    request.headers.get("x-zapier-secret"),
    body.token,
    body.webhookSecret,
    body.zapierSecret,
  );
  const sampleOnly = ["1", "true", "yes"].includes(
    pickFirstNonEmpty(body.sampleOnly, url.searchParams.get("sampleOnly")).toLowerCase(),
  );

  if (!companyId || !token) {
    return NextResponse.json(
      {
        ok: false,
        error: !companyId ? "missing-company-id" : "missing-webhook-token",
      },
      { status: 400 },
    );
  }
  if (!sampleOnly) {
    return NextResponse.json({ ok: false, error: "missing-delete-mode" }, { status: 400 });
  }

  const companySnap = await adminDb.collection("companies").doc(companyId).get().catch(() => null);
  const companyDoc = companySnap?.exists ? ((companySnap.data() ?? {}) as Record<string, unknown>) : null;
  if (!companyDoc) {
    return NextResponse.json({ ok: false, error: "company-not-found" }, { status: 404 });
  }
  const zapier = readZapierLeadsConfig(companyDoc);

  if (!zapier.enabled) {
    return NextResponse.json({ ok: false, error: "zapier-leads-disabled" }, { status: 403 });
  }
  if (!zapier.webhookSecret) {
    return NextResponse.json({ ok: false, error: "missing-company-webhook-secret" }, { status: 403 });
  }
  if (zapier.webhookSecret !== token) {
    return NextResponse.json({ ok: false, error: "webhook-token-mismatch" }, { status: 403 });
  }

  try {
    const snap = await adminDb
      .collection("companies")
      .doc(companyId)
      .collection("leads")
      .limit(500)
      .get();
    const sampleDocs = snap.docs.filter((docSnap) => {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const rawFields =
        data.rawFields && typeof data.rawFields === "object"
          ? (data.rawFields as Record<string, unknown>)
          : {};
      return rawFields.__sampleLead === true;
    });
    const batch = adminDb.batch();
    sampleDocs.forEach((docSnap) => batch.delete(docSnap.ref));
    if (sampleDocs.length > 0) {
      await batch.commit();
    }
    return NextResponse.json({ ok: true, deleted: sampleDocs.length });
  } catch {
    return NextResponse.json({ ok: false, error: "lead-delete-failed" }, { status: 500 });
  }
}
