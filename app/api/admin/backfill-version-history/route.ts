import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { getProjectDocRefAdmin, verifyCompanyMembershipAdmin } from "@/lib/specs-share";
import { normalizeSpecsGridVersion } from "@/lib/specs-grid-types";

// One-time maintenance tool — NOT wired into any UI — for a project whose `sales.quoteGridVersions`/
// `sales.specificationsVersions` arrays already pushed it past Firestore's 1MB per-document limit
// before those two fields were moved into their own subcollections (see
// lib/firestore-data.ts's fetchGridVersions/saveGridVersion/updateGridVersionGrid). New saves
// already go to the subcollections on their own — this route only cleans up a project's EXISTING,
// already-oversized data: it copies each array entry into the matching subcollection, then removes
// the old fields from all four `sales` mirror locations (see persistSalesPatch in
// app/(app)/projects/[projectId]/page.tsx) so the document actually shrinks.
//
// `dryRun` defaults to true — it reports counts/byte sizes and writes nothing. Only `dryRun: false`
// commits any change. Deliberately no UI trigger: run manually, once, per already-oversized project.
export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const uid = await verifyBearerUid(request);
  if (!uid) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const projectId = String(body.projectId ?? "").trim();
  const companyId = String(body.companyId ?? "").trim();
  const dryRun = body.dryRun !== false;
  if (!projectId || !companyId) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }

  const isMember = await verifyCompanyMembershipAdmin(adminDb, companyId, uid);
  if (!isMember) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const projectRef = await getProjectDocRefAdmin(adminDb, projectId, companyId);
  if (!projectRef) {
    return NextResponse.json({ ok: false, error: "project-not-found" }, { status: 404 });
  }

  const projectSnap = await projectRef.get();
  const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
  const sales = (projectData.sales ?? {}) as Record<string, unknown>;
  const projectSettings = (projectData.projectSettings ?? {}) as Record<string, unknown>;
  const quoteGridVersionsRaw = Array.isArray(sales.quoteGridVersions) ? sales.quoteGridVersions : [];
  const specificationsVersionsRaw = Array.isArray(sales.specificationsVersions) ? sales.specificationsVersions : [];

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      quoteGridVersionsCount: quoteGridVersionsRaw.length,
      quoteGridVersionsBytes: Buffer.byteLength(JSON.stringify(quoteGridVersionsRaw)),
      specificationsVersionsCount: specificationsVersionsRaw.length,
      specificationsVersionsBytes: Buffer.byteLength(JSON.stringify(specificationsVersionsRaw)),
    });
  }

  // Real run — write each existing entry into its own subcollection document first (mirrors the
  // client-side saveGridVersion's own doc(collection(...)) + setDoc idiom, admin-SDK equivalent),
  // validating/reshaping through the same normalizer used everywhere else this data is read.
  let migratedQuoteGridVersions = 0;
  for (const entry of quoteGridVersionsRaw) {
    const version = normalizeSpecsGridVersion(entry);
    if (!version) continue;
    const versionRef = projectRef.collection("quoteGridVersions").doc();
    await versionRef.set(JSON.parse(JSON.stringify({ ...version, id: versionRef.id })));
    migratedQuoteGridVersions += 1;
  }
  let migratedSpecificationsVersions = 0;
  for (const entry of specificationsVersionsRaw) {
    const version = normalizeSpecsGridVersion(entry);
    if (!version) continue;
    const versionRef = projectRef.collection("specificationsVersions").doc();
    await versionRef.set(JSON.parse(JSON.stringify({ ...version, id: versionRef.id })));
    migratedSpecificationsVersions += 1;
  }

  // Then shrink the project doc itself — dotted-path field deletion on all four `sales` mirror
  // locations, plus rebuilding the two JSON-string mirrors from the now-stripped objects (a literal
  // `delete` here, not FieldValue.delete(), since these are plain in-memory objects being
  // re-serialized, not a Firestore update payload).
  const strippedSales = { ...sales };
  delete strippedSales.quoteGridVersions;
  delete strippedSales.specificationsVersions;
  const strippedProjectSettings = { ...projectSettings, sales: strippedSales };

  await projectRef.update({
    "sales.quoteGridVersions": FieldValue.delete(),
    "sales.specificationsVersions": FieldValue.delete(),
    "projectSettings.sales.quoteGridVersions": FieldValue.delete(),
    "projectSettings.sales.specificationsVersions": FieldValue.delete(),
    salesJson: JSON.stringify(strippedSales),
    projectSettingsJson: JSON.stringify(strippedProjectSettings),
  });

  return NextResponse.json({
    ok: true,
    dryRun: false,
    migratedQuoteGridVersions,
    migratedSpecificationsVersions,
  });
}
