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

function normalizeLeadImageItems(
  value: unknown,
): Array<{ url: string; name: string; annotations: Array<{ id: string; x: number; y: number; xPx?: number; yPx?: number; note: string; createdByName?: string; createdByColor?: string }> }> {
  if (!Array.isArray(value)) return [];
  const items: Array<{
    url: string;
    name: string;
    annotations: Array<{ id: string; x: number; y: number; xPx?: number; yPx?: number; note: string; createdByName?: string; createdByColor?: string }>;
  }> = [];
  for (const item of value) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const url = toStr(row?.url);
    const name = toStr(row?.name);
    const annotations: Array<{ id: string; x: number; y: number; xPx?: number; yPx?: number; note: string; createdByName?: string; createdByColor?: string }> = [];
    if (Array.isArray(row?.annotations)) {
      for (const annotation of row.annotations) {
        const next =
          annotation && typeof annotation === "object"
            ? (annotation as Record<string, unknown>)
            : null;
        const id = toStr(next?.id);
        const note = toStr(next?.note);
        const x = Number(next?.x);
        const y = Number(next?.y);
        const xPx = Number(next?.xPx);
        const yPx = Number(next?.yPx);
        if (!id || !note || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        annotations.push({
          id,
          note,
          x: Math.min(100, Math.max(0, x)),
          y: Math.min(100, Math.max(0, y)),
          xPx: Number.isFinite(xPx) ? Math.max(0, xPx) : undefined,
          yPx: Number.isFinite(yPx) ? Math.max(0, yPx) : undefined,
          createdByName: toStr(next?.createdByName),
          createdByColor: toStr(next?.createdByColor),
        });
      }
    }
    if (!url) continue;
    items.push({ url, name, annotations });
    if (items.length >= 10) break;
  }
  return items;
}

function buildLeadResponse(
  companyId: string,
  docId: string,
  data: Record<string, unknown>,
  mode: "summary" | "detail" = "detail",
) {
  const imageItems = mode === "detail" ? normalizeLeadImageItems(data.imageItems) : [];
  const summaryImageUrls = Array.isArray(data.imageUrls)
    ? data.imageUrls.map(String).filter(Boolean)
    : Array.isArray(data.imageItems)
      ? normalizeLeadImageItems(data.imageItems).map((item) => item.url)
      : [];
  return {
    id: String(data.id ?? docId),
    companyId,
    name: toStr(data.name),
    email: toStr(data.email),
    phone: toStr(data.phone),
    message: mode === "detail" ? toStr(data.message) : "",
    formName: toStr(data.formName),
    submittedAtIso: toIsoString(data.submittedAtIso ?? data.submittedAt, ""),
    createdAtIso: toIsoString(data.createdAtIso ?? data.createdAt, ""),
    updatedAtIso: toIsoString(data.updatedAtIso ?? data.updatedAt, ""),
    deletedAtIso: toIsoString(data.deletedAtIso ?? data.deletedAt, ""),
    isDeleted: Boolean(data.isDeleted),
    source: toStr(data.source) || "zapier-form",
    status: (() => {
      const raw = toStr(data.status);
      return raw || "New";
    })(),
    assignedToUid: toStr(data.assignedToUid),
    assignedToName: toStr(data.assignedToName || data.assignedTo),
    assignedTo: toStr(data.assignedTo || data.assignedToName),
    imageItems,
    imageUrls:
      mode === "detail"
        ? imageItems.length
          ? imageItems.map((item) => item.url)
          : Array.isArray(data.imageUrls)
            ? data.imageUrls.map(String).filter(Boolean)
            : []
        : summaryImageUrls,
    rawFields:
      data.rawFields && typeof data.rawFields === "object"
        ? (data.rawFields as Record<string, unknown>)
        : undefined,
  };
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
  const mode = pickFirstNonEmpty(url.searchParams.get("mode")).toLowerCase() === "detail" ? "detail" : "summary";
  const leadId = pickFirstNonEmpty(
    url.searchParams.get("leadId"),
    url.searchParams.get("leadID"),
  );
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "missing-company-id" }, { status: 400 });
  }

  try {
    if (mode === "detail") {
      if (!leadId) {
        return NextResponse.json({ ok: false, error: "missing-lead-id" }, { status: 400 });
      }
      const docSnap = await adminDb.collection("companies").doc(companyId).collection("leads").doc(leadId).get();
      if (!docSnap.exists) {
        return NextResponse.json({ ok: false, error: "lead-not-found" }, { status: 404 });
      }
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      return NextResponse.json({ ok: true, lead: buildLeadResponse(companyId, docSnap.id, data, "detail") });
    }
    const snap = await adminDb
      .collection("companies")
      .doc(companyId)
      .collection("leads")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();
    const leads = snap.docs.map((docSnap) =>
      buildLeadResponse(companyId, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>, "summary"),
    );
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
    status: "New",
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

export async function PATCH(request: NextRequest) {
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
  const leadId = pickFirstNonEmpty(
    body.leadId,
    body.leadID,
    body.lead_id,
    url.searchParams.get("leadId"),
    url.searchParams.get("leadID"),
  );
  const status = pickFirstNonEmpty(
    body.status,
    body.leadStatus,
    body.lead_status,
    url.searchParams.get("status"),
  );
  const imageUrlsRaw =
    body.imageUrls ??
    body.images ??
    body.leadImages ??
    url.searchParams.get("imageUrls");
  const imageItemsRaw =
    body.imageItems ??
    body.leadImageItems ??
    body.imagesDetailed;
  const deleteModeRaw = pickFirstNonEmpty(
    body.deleteMode,
    body.deleted,
    body.isDeleted,
    body.is_deleted,
    url.searchParams.get("deleteMode"),
    url.searchParams.get("deleted"),
    url.searchParams.get("isDeleted"),
  );
  const hasDeleteMode = deleteModeRaw !== "";
  const normalizedImageItems = normalizeLeadImageItems(imageItemsRaw);
  const hasImageItems = normalizedImageItems.length > 0 || Array.isArray(imageItemsRaw);
  const hasImageUrls =
    typeof imageUrlsRaw === "string"
      ? imageUrlsRaw.trim() !== ""
      : Array.isArray(imageUrlsRaw);
  const imageUrls = Array.isArray(imageUrlsRaw)
    ? imageUrlsRaw.map((value) => toStr(value)).filter(Boolean).slice(0, 10)
    : typeof imageUrlsRaw === "string"
      ? imageUrlsRaw.split(",").map((value) => toStr(value)).filter(Boolean).slice(0, 10)
      : [];
  const isDeleted =
    hasDeleteMode &&
    ["true", "1", "yes", "on"].includes(String(deleteModeRaw || "").trim().toLowerCase());
  const assignedToUid = pickFirstNonEmpty(
    body.assignedToUid,
    body.assignedUid,
    body.assigned_to_uid,
    url.searchParams.get("assignedToUid"),
  );
  const assignedToName = pickFirstNonEmpty(
    body.assignedToName,
    body.assignedName,
    body.assigned_to_name,
    body.assignedTo,
    url.searchParams.get("assignedToName"),
  );
  const hasAssignmentPatch =
    Object.prototype.hasOwnProperty.call(body, "assignedToUid") ||
    Object.prototype.hasOwnProperty.call(body, "assignedUid") ||
    Object.prototype.hasOwnProperty.call(body, "assigned_to_uid") ||
    Object.prototype.hasOwnProperty.call(body, "assignedToName") ||
    Object.prototype.hasOwnProperty.call(body, "assignedName") ||
    Object.prototype.hasOwnProperty.call(body, "assigned_to_name") ||
    Object.prototype.hasOwnProperty.call(body, "assignedTo");

  if (!companyId || !leadId || (!status && !hasDeleteMode && !hasImageUrls && !hasImageItems && !hasAssignmentPatch)) {
    return NextResponse.json(
      {
        ok: false,
        error: !companyId ? "missing-company-id" : !leadId ? "missing-lead-id" : "missing-patch-fields",
      },
      { status: 400 },
    );
  }

  try {
    const leadRef = adminDb.collection("companies").doc(companyId).collection("leads").doc(leadId);
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) {
      return NextResponse.json({ ok: false, error: "lead-not-found" }, { status: 404 });
    }

    const updatedAtIso = new Date().toISOString();
    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtIso,
    };
    if (status) {
      patch.status = status;
    }
    if (hasDeleteMode) {
      patch.isDeleted = isDeleted;
      patch.deletedAt = isDeleted ? FieldValue.serverTimestamp() : "";
      patch.deletedAtIso = isDeleted ? updatedAtIso : "";
    }
    if (hasImageItems) {
      patch.imageItems = normalizedImageItems;
      patch.imageUrls = normalizedImageItems.map((item) => item.url);
    } else if (hasImageUrls) {
      patch.imageUrls = imageUrls;
      patch.imageItems = imageUrls.map((url) => ({ url, name: "" }));
    }
    if (hasAssignmentPatch) {
      patch.assignedToUid = assignedToUid || "";
      patch.assignedToName = assignedToName || "";
      patch.assignedTo = assignedToName || "";
    }
    await leadRef.update(patch);
    return NextResponse.json({
      ok: true,
      leadId,
      status,
      isDeleted,
      assignedToUid: hasAssignmentPatch ? assignedToUid : undefined,
      assignedToName: hasAssignmentPatch ? assignedToName : undefined,
      imageUrls: hasImageItems ? normalizedImageItems.map((item) => item.url) : imageUrls,
      imageItems: hasImageItems ? normalizedImageItems : imageUrls.map((url) => ({ url, name: "" })),
      updatedAtIso,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "lead-status-update-failed" }, { status: 500 });
  }
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
