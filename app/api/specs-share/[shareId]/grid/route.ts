import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { getProjectDocRefAdmin, getSpecsShareGridTarget, resolveAssignedContactAdmin, type SpecsShareLinkDoc } from "@/lib/specs-share";
import { normalizeSpecsGrid } from "@/lib/specs-grid-types";

// No access code — the link itself (this shareId) is the only secret, per the user's explicit
// call. See lib/specs-share.ts's buildSpecsConfirmationEmailText comment for the reasoning.
export async function GET(request: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const { shareId } = await params;
  const shareRef = adminDb.collection("specsShareLinks").doc(shareId);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) {
    return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  const shareDoc = shareSnap.data() as SpecsShareLinkDoc;

  // A hub link that only ever had the Quote sent (quoteVersionId present, versionId absent) must
  // never fall through to getSpecsShareGridTarget's legacy live-project fallback below — that
  // fallback only exists for a genuinely pre-versionId Specs link, and would otherwise leak the
  // LIVE (never-sent) specs sheet under a phantom Specs tab. Only true when Specs was never sent
  // to this hub at all.
  if (!shareDoc.versionId && shareDoc.quoteVersionId) {
    return NextResponse.json({ ok: false, error: "specs-not-sent" }, { status: 404 });
  }

  const projectRef = await getProjectDocRefAdmin(adminDb, shareDoc.projectId, shareDoc.companyId);
  if (!projectRef) {
    return NextResponse.json({ ok: false, error: "project-not-found" }, { status: 404 });
  }
  const projectSnap = await projectRef.get();
  const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;

  // The share link is bound to a specific specificationsVersions snapshot (the exact grid that
  // existed when "Send to Client" was clicked) — never the live project doc, so further staff
  // edits to the live draft can never reach an already-shared link. See
  // SpecsShareLinkDoc.versionId's own comment. A link created before this field existed falls back
  // to the old live-project-doc behavior.
  const target = getSpecsShareGridTarget(projectRef, shareDoc);
  const grid =
    target.kind === "version"
      ? normalizeSpecsGrid(((await target.ref.get()).data() ?? {}).grid)
      : normalizeSpecsGrid(((projectData.sales ?? {}) as Record<string, unknown>).specificationsGrid);
  if (!grid) {
    return NextResponse.json({ ok: false, error: "no-specifications-sheet" }, { status: 404 });
  }

  // Only the grid + a display name (+ the assigned staff member's own contact info, resolved via
  // resolveAssignedContactAdmin) — never the raw project document, which may hold unrelated
  // sensitive business data (pricing, other contacts) that must never reach this public route.
  const projectName = String(projectData.name ?? "").trim();
  const assignedContact = await resolveAssignedContactAdmin(adminDb, shareDoc.companyId, projectData);
  // Lives on the small, separate specsShareLinks doc already fetched above, not on the project
  // doc — see lib/specs-share.ts's SpecsShareLinkDoc comment for why.
  const confirmationSubmittedAt = shareDoc.submittedAt || null;
  const confirmationSubmittedByName = shareDoc.submittedByName || null;
  return NextResponse.json({ ok: true, grid, projectName, assignedContact, confirmationSubmittedAt, confirmationSubmittedByName });
}
