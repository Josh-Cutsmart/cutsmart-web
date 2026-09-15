import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { getProjectDocRefAdmin, getQuoteShareGridTarget, resolveAssignedContactAdmin, type SpecsShareLinkDoc } from "@/lib/specs-share";
import { normalizeSpecsGrid } from "@/lib/specs-grid-types";

// Quote's own version of .../grid/route.ts — same public, no-access-code shape (see that file's
// own header comment for the reasoning), just resolving through getQuoteShareGridTarget instead,
// which returns null (rather than a legacy-project fallback) when the Quote was never sent to
// this hub link at all.
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

  const projectRef = await getProjectDocRefAdmin(adminDb, shareDoc.projectId, shareDoc.companyId);
  if (!projectRef) {
    return NextResponse.json({ ok: false, error: "project-not-found" }, { status: 404 });
  }
  const projectSnap = await projectRef.get();
  const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;

  const target = getQuoteShareGridTarget(projectRef, shareDoc);
  if (!target) {
    return NextResponse.json({ ok: false, error: "quote-not-sent" }, { status: 404 });
  }
  const targetSnap = await target.ref.get();
  const targetData = (targetSnap.data() ?? {}) as Record<string, unknown>;
  const grid = normalizeSpecsGrid(targetData.grid);
  if (!grid) {
    return NextResponse.json({ ok: false, error: "no-quote" }, { status: 404 });
  }

  // Only the grid + a display name (+ the assigned staff member's own contact info) — never the
  // raw project document, which may hold unrelated sensitive business data (pricing on OTHER
  // quotes, other contacts) that must never reach this public route.
  const projectName = String(projectData.name ?? "").trim();
  const assignedContact = await resolveAssignedContactAdmin(adminDb, shareDoc.companyId, projectData);
  const quoteAcceptedAt = shareDoc.quoteAcceptedAt || null;
  const quoteAcceptedByName = shareDoc.quoteAcceptedByName || null;
  return NextResponse.json({ ok: true, grid, projectName, assignedContact, quoteAcceptedAt, quoteAcceptedByName });
}
