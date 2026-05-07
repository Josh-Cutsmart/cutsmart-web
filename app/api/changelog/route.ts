import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";

type AppReportKind = "issue" | "feature";

function toStr(value: unknown) {
  return String(value ?? "").trim();
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
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return fallback;
    }
  }
  if (value instanceof Date) return value.toISOString();
  return fallback;
}

function normalizeVersionId(version: string) {
  return String(version || "").trim().toLowerCase();
}

function versionsCollection() {
  return adminDb!.collection("Application").doc("changelog").collection("versions");
}

function reportsCollection(kind: AppReportKind) {
  return adminDb!
    .collection("Application")
    .doc("changelog")
    .collection(kind === "feature" ? "Suggested feature" : "Reports");
}

export async function GET(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const url = new URL(request.url);
  const type = toStr(url.searchParams.get("type")).toLowerCase();

  try {
    if (type === "reports") {
      const mapReportRow = (
        kind: AppReportKind,
        data: Record<string, unknown>,
        id: string,
      ) => ({
        id: toStr(data.id) || id,
        kind,
        deviceType: (() => {
          const raw = toStr(data.deviceType).toLowerCase();
          return raw === "desktop" || raw === "tablet" || raw === "mobile" ? raw : "";
        })(),
        subject: toStr(data.subject),
        body: toStr(data.body),
        createdAtIso: toIsoString(data.createdAtIso ?? data.createdAt, ""),
        appVersion: toStr(data.appVersion),
        reporterEmail: toStr(data.reporterEmail),
        reporterName: toStr(data.reporterName),
        reporterUid: toStr(data.reporterUid),
        completed: Boolean(data.completed),
        completedAtIso: toIsoString(data.completedAtIso ?? data.completedAt, ""),
      });

      const [issueSnap, featureSnap] = await Promise.all([
        reportsCollection("issue").orderBy("createdAt", "desc").limit(500).get(),
        reportsCollection("feature").orderBy("createdAt", "desc").limit(500).get(),
      ]);
      const reports = [
        ...issueSnap.docs.map((docSnap) =>
          mapReportRow("issue", (docSnap.data() ?? {}) as Record<string, unknown>, docSnap.id),
        ),
        ...featureSnap.docs.map((docSnap) =>
          mapReportRow("feature", (docSnap.data() ?? {}) as Record<string, unknown>, docSnap.id),
        ),
      ].sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")));

      return NextResponse.json({ ok: true, reports });
    }

    const snap = await versionsCollection().orderBy("capturedAtIso", "desc").limit(500).get();
    const entries = snap.docs
      .map((docSnap) => {
        const data = (docSnap.data() ?? {}) as Record<string, unknown>;
        return {
          version: toStr(data.version),
          whatsNew: String(data.whatsNew ?? ""),
          capturedAtIso: toStr(data.capturedAtIso),
        };
      })
      .filter((row) => row.version);

    return NextResponse.json({ ok: true, entries });
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "changelog-read-failed")
        : "changelog-read-failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const type = toStr((body as Record<string, unknown>).type).toLowerCase();

  try {
    if (type === "sync-versions") {
      const entries = Array.isArray((body as Record<string, unknown>).entries)
        ? ((body as Record<string, unknown>).entries as unknown[])
        : [];
      let didWrite = false;
      for (const entry of entries) {
        const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
        const version = toStr(row?.version);
        if (!version) continue;
        const id = normalizeVersionId(version);
        await versionsCollection()
          .doc(id)
          .set(
            {
              id,
              version,
              whatsNew: String(row?.whatsNew ?? ""),
              capturedAtIso: toStr(row?.capturedAtIso) || new Date().toISOString(),
              updatedAt: FieldValue.serverTimestamp(),
              updatedAtIso: new Date().toISOString(),
            },
            { merge: true },
          );
        didWrite = true;
      }
      return NextResponse.json({ ok: true, didWrite });
    }

    if (type === "submit-report") {
      const kind = toStr((body as Record<string, unknown>).kind).toLowerCase();
      if (kind !== "issue" && kind !== "feature") {
        return NextResponse.json({ ok: false, error: "invalid-kind" }, { status: 400 });
      }
      const subject = toStr((body as Record<string, unknown>).subject);
      const reportBody = toStr((body as Record<string, unknown>).body);
      const reporterUid = toStr((body as Record<string, unknown>).reporterUid);
      const reporterEmail = toStr((body as Record<string, unknown>).reporterEmail);
      if (!subject || !reportBody || !reporterUid || !reporterEmail) {
        return NextResponse.json({ ok: false, error: "missing-required-fields" }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      const ref = reportsCollection(kind as AppReportKind).doc();
      await ref.set({
        id: ref.id,
        kind,
        deviceType: toStr((body as Record<string, unknown>).deviceType).toLowerCase(),
        subject,
        body: reportBody,
        appVersion: toStr((body as Record<string, unknown>).appVersion),
        reporterUid,
        reporterEmail,
        reporterName: toStr((body as Record<string, unknown>).reporterName),
        completed: false,
        completedAtIso: "",
        createdAt: FieldValue.serverTimestamp(),
        createdAtIso: nowIso,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: nowIso,
      });
      return NextResponse.json({ ok: true, id: ref.id });
    }

    if (type === "set-report-completed") {
      const id = toStr((body as Record<string, unknown>).reportId);
      const completed = Boolean((body as Record<string, unknown>).completed);
      if (!id) {
        return NextResponse.json({ ok: false, error: "missing-report-id" }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      try {
        await reportsCollection("issue").doc(id).update({
          completed,
          completedAt: completed ? FieldValue.serverTimestamp() : null,
          completedAtIso: completed ? nowIso : "",
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtIso: nowIso,
        });
      } catch {
        await reportsCollection("feature").doc(id).update({
          completed,
          completedAt: completed ? FieldValue.serverTimestamp() : null,
          completedAtIso: completed ? nowIso : "",
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtIso: nowIso,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (type === "cleanup-version") {
      const normalizedVersion = toStr((body as Record<string, unknown>).version).replace(/^v+/i, "");
      if (!normalizedVersion) {
        return NextResponse.json({ ok: false, error: "missing-version" }, { status: 400 });
      }
      await adminDb.collection("appMeta").doc("reportsCleanup").set(
        {
          lastVersion: normalizedVersion,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtIso: new Date().toISOString(),
        },
        { merge: true },
      );
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "invalid-type" }, { status: 400 });
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "changelog-write-failed")
        : "changelog-write-failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
