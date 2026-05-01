import { NextRequest, NextResponse } from "next/server";
import { collection, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

function toStr(value: unknown) {
  return String(value ?? "").trim();
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

export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ ok: false, error: "missing-firestore" }, { status: 500 });
  }

  const url = new URL(request.url);
  const body = await parseBody(request);
  const companyId = toStr(body.companyId) || toStr(url.searchParams.get("companyId"));
  const token = toStr(url.searchParams.get("token")) || toStr(request.headers.get("x-zapier-secret"));

  if (!companyId || !token) {
    return NextResponse.json({ ok: false, error: "missing-company-or-token" }, { status: 400 });
  }

  const companySnap = await getDoc(doc(db, "companies", companyId)).catch(() => null);
  const companyDoc = companySnap?.exists() ? ((companySnap.data() ?? {}) as Record<string, unknown>) : null;
  const zapier = readZapierLeadsConfig(companyDoc);

  if (!zapier.enabled || !zapier.webhookSecret || zapier.webhookSecret !== token) {
    return NextResponse.json({ ok: false, error: "invalid-webhook-auth" }, { status: 403 });
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

  const leadRef = doc(collection(db, "companies", companyId, "leads"));
  try {
    await setDoc(leadRef, {
      id: leadRef.id,
      ...payload,
      rawFields: body,
      submittedAt: submittedAtIso,
      createdAt: serverTimestamp(),
      createdAtIso: new Date().toISOString(),
      updatedAt: serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "lead-save-failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, leadId: leadRef.id });
}
