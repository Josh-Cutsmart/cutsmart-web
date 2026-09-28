export type DoorModeValue = "" | "manual" | "door" | "drawer";

export type CutlistRow = {
  id: string;
  room: string;
  partType: string;
  board: string;
  name: string;
  doorMode?: DoorModeValue;
  doorFrontCount?: string;
  doorTopGap?: string;
  doorBetweenGap?: string;
  doorBetweenGaps?: string[];
  doorSideLeft?: "front" | "panel";
  doorSideRight?: "front" | "panel";
  doorSideLeftGap?: string;
  doorSideRightGap?: string;
  doorFrontWidths?: string[];
  doorFrontWidthManual?: boolean[];
  doorFrontHeights?: string[];
  doorFrontHeightManual?: boolean[];
  doorFrontBoards?: string[];
  doorFrontBoardManual?: boolean[];
  doorFrontNames?: string[];
  doorFrontNameManual?: boolean[];
  doorFrontQuantities?: string[];
  doorFrontQuantityManual?: boolean[];
  height: string;
  width: string;
  depth: string;
  quantity: string;
  clashing: string;
  clashLeft?: string;
  clashRight?: string;
  fixedShelf?: string;
  adjustableShelf?: string;
  fixedShelfDrilling?: string;
  adjustableShelfDrilling?: string;
  cabinetryKind?: "base" | "wall";
  // "" | "Bottom" | "Top/Bottom" — which shelf edge(s) clash on a Cabinetry row.
  cabinetryClashBottom?: string;
  cabinetryClashBottomManual?: boolean;
  // Base cabinets get 2 Rails instead of a full Top by default (see buildCabinetryDerivedPieces) —
  // this opts a specific Base cabinet back into a full Top anyway. Wall cabinets always keep a
  // full Top regardless of this flag; it only has an effect on cabinetryKind === "base" rows.
  cabinetryFullTop?: boolean;
  hingesUp?: string[];
  hingesDown?: string[];
  hingeSide?: "" | "LH" | "RH" | "Mirror" | "Top";
  information: string;
  grain: boolean;
  grainValue: string;
  includeInNesting?: boolean;
  parentName?: string;
  bankGroupId?: string;
  bankFrontIndexes?: number[];
};

export type CutlistDraftRow = CutlistRow;
export type CutlistEntryDraft = Omit<CutlistRow, "id" | "room">;

// A staff-named "what if these pieces used a different product" scenario for the Initial Measure
// sheet's Product Compare tool — see computeCutlistSelectionPricing in
// app/(app)/projects/[projectId]/page.tsx. Deliberately holds no frozen price: the $ result is
// always recomputed live from the CURRENT initialCutlistRows state whenever a comparison is
// opened, so it stays correct if a selected row's size/quantity/product changes after this was
// saved. Stored as its own small Firestore subcollection document (never inside the project doc's
// `sales` object) — same reasoning as SpecsGridVersion's own comment: keeps the project document
// safe from Firestore's 1MB per-document limit.
export type ProductComparison = {
  id: string;
  name: string;
  selectedRowIds: string[];
  // Per-row target product, keyed by CutlistRow id — there's no single comparison-wide product;
  // each row is only ever compared to something once it has its own entry here, letting a mixed
  // selection compare some pieces to one product and others to a different one in the same run
  // (e.g. doors to Lacquer, panels to a two-pac). A row missing here contributes zero change.
  rowProductOverrides?: Record<string, string>;
  savedAtIso: string;
  savedByName?: string;
};

// Sums quantity (not row count) grouped by partType — matches the "Parts" total already shown live
// on both cutlist tabs elsewhere in this app, so a summary built from this stays consistent with
// numbers staff already see. Rows with no partType are grouped under "Unassigned" rather than
// dropped, so their quantity isn't silently missing from the total.
export function summarizeCutlistRowsByPartType(rows: CutlistRow[]): Array<{ partType: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const partType = String(row.partType || "").trim() || "Unassigned";
    const quantity = Number(row.quantity) || 0;
    counts.set(partType, (counts.get(partType) ?? 0) + quantity);
  }
  return Array.from(counts.entries())
    .map(([partType, count]) => ({ partType, count }))
    .sort((a, b) => a.partType.localeCompare(b.partType));
}

// room+name, not `id` — a row's id is freshly generated per cutlist (Initial Measure and
// Production are separate Firestore subcollections), so ids can never line up across the two.
function cutlistRowMatchKey(row: CutlistRow): string {
  return `${row.room.trim().toLowerCase()}::${row.name.trim().toLowerCase()}`;
}

// Initial Measure rows with no match (by room+name) in the Production cutlist — used for the
// Production close-summary's "missing from Production" callout. Rows with a blank name are
// excluded on both sides: there's nothing reliable to key an unnamed row on, so it can neither be
// matched nor meaningfully reported as "missing."
export function findMissingProductionRows(initialRows: CutlistRow[], productionRows: CutlistRow[]): CutlistRow[] {
  const productionKeys = new Set(
    productionRows.filter((row) => row.name.trim()).map(cutlistRowMatchKey),
  );
  return initialRows.filter((row) => row.name.trim() && !productionKeys.has(cutlistRowMatchKey(row)));
}
