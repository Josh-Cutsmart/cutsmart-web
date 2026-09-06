import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { isSpecsShareLinkExpired, getProjectDocRefAdmin, getSpecsShareGridTarget, type SpecsShareLinkDoc } from "@/lib/specs-share";
import { normalizeSpecsGrid, type SpecsCell } from "@/lib/specs-grid-types";

// No access code — the link itself (this shareId) is the only secret, per the user's explicit
// call. See lib/specs-share.ts's buildSpecsConfirmationEmailText comment for the reasoning.
export async function POST(request: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const { shareId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rowId = String(body.rowId ?? "").trim();
  const colIndex = Number(body.colIndex);
  // `value: null` means "clear this answer" (clicking an already-selected Yes/No un-selects it) —
  // distinct from `false` ("No"), so this can't just be Boolean(body.value) like a plain toggle.
  const isClear = body.value === null;
  const value = isClear ? null : Boolean(body.value);
  if (!rowId || !Number.isFinite(colIndex) || colIndex < 0) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }

  const shareRef = adminDb.collection("specsShareLinks").doc(shareId);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) {
    return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  const shareDoc = shareSnap.data() as SpecsShareLinkDoc;

  if (isSpecsShareLinkExpired(shareDoc)) {
    return NextResponse.json({ ok: false, error: "expired" }, { status: 400 });
  }

  // The sheet-wide lock, checked before anything else — once submitted, no further answer changes
  // are accepted regardless of which cell or how the code was obtained. Lives on this small,
  // separate specsShareLinks doc, not on the project doc — see lib/specs-share.ts's
  // SpecsShareLinkDoc comment for why.
  if (shareDoc.submittedAt) {
    return NextResponse.json({ ok: false, error: "already-submitted" }, { status: 400 });
  }

  const projectRef = await getProjectDocRefAdmin(adminDb, shareDoc.projectId, shareDoc.companyId);
  if (!projectRef) {
    return NextResponse.json({ ok: false, error: "project-not-found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  // The share link is bound to a specific specificationsVersions snapshot (the exact grid that
  // existed when "Send to Client" was clicked) — never the live project doc, so further staff
  // edits to the live draft can never reach an already-shared link. See
  // SpecsShareLinkDoc.versionId's own comment. A link created before this field existed falls back
  // to the old live-project-doc behavior.
  const target = getSpecsShareGridTarget(projectRef, shareDoc);
  try {
    const result = await adminDb.runTransaction(async (tx) => {
      const targetSnap = await tx.get(target.ref);
      const targetData = (targetSnap.data() ?? {}) as Record<string, unknown>;
      const grid =
        target.kind === "version"
          ? normalizeSpecsGrid(targetData.grid)
          : normalizeSpecsGrid(((targetData.sales ?? {}) as Record<string, unknown>).specificationsGrid);
      if (!grid) {
        return { error: "no-specifications-sheet", status: 404 } as const;
      }
      const row = grid.rows.find((r) => r.id === rowId);
      const cell = row?.cells[colIndex];
      // The real per-cell access-control boundary: knowing this link proves "this is the invited
      // client," not "this exact cell is theirs to answer" — only cells the author explicitly
      // marked can ever be written here.
      if (!row || !cell || !cell.confirmable) {
        return { error: "cell-not-confirmable", status: 400 } as const;
      }
      let nextCell: SpecsCell;
      if (isClear) {
        nextCell = { ...cell };
        delete nextCell.confirmedYes;
        delete nextCell.confirmedAt;
      } else {
        nextCell = { ...cell, confirmedYes: value as boolean, confirmedAt: nowIso };
      }
      const nextGrid = {
        ...grid,
        rows: grid.rows.map((r) => (r.id !== rowId ? r : { ...r, cells: r.cells.map((c, ci) => (ci === colIndex ? nextCell : c)) })),
      };
      // Dotted-path update targeting only `sales.specificationsGrid` — never re-transmits any
      // sibling key under `sales` (quote grid, quote snapshots, version history...). Rewriting the
      // whole `sales` object here (as an earlier version of this route did, via
      // `set(..., {merge:true})` with a full spread) risked exactly the failure
      // app/(app)/projects/[projectId]/page.tsx's own persistSalesPatch has a standing comment
      // about: a large sales object silently exceeding Firestore's per-document write size and
      // failing the whole transaction.
      //
      // JSON round-trip before writing — normalizeSpecsGrid's rebuild path can carry over a
      // present-but-`undefined` key (e.g. `rowSpan: undefined` on a cell that never had a span,
      // rebuilt for an unrelated reason) since it isn't guaranteed to omit every optional field
      // that happens to be absent. The client-side persistSalesPatch always does this exact
      // round-trip before writing, for exactly this reason — the admin SDK is just as strict as
      // the client SDK about rejecting a literal `undefined` value, so this route needs the same
      // safety net.
      const nextGridSanitized = JSON.parse(JSON.stringify(nextGrid));
      if (target.kind === "version") {
        // The version doc holds nothing but {id,name,version,savedAtIso,...,grid} — a single
        // top-level field update, no sibling keys to avoid disturbing.
        tx.update(target.ref, { grid: nextGridSanitized });
      } else {
        // Legacy link (created before versionId existed) — same dotted-path update this route
        // always used against the live project doc. Also mirrors into
        // projectSettings.sales.specificationsGrid since the internal editor's own
        // extractSalesPayloadFromProject (app/(app)/projects/[projectId]/page.tsx) reads
        // projectSettings.sales BEFORE the plain `sales` field.
        tx.update(target.ref, {
          "sales.specificationsGrid": nextGridSanitized,
          "projectSettings.sales.specificationsGrid": nextGridSanitized,
        });
      }
      return { ok: true } as const;
    });
    if ("error" in result) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
  } catch (err) {
    console.error("[specs-share/answer] transaction failed:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "transaction-failed" }, { status: 500 });
  }

  return NextResponse.json(isClear ? { ok: true, confirmedYes: null, confirmedAt: null } : { ok: true, confirmedYes: value, confirmedAt: nowIso });
}
