// Lacquer coverage maths. One formula, shared by the project page's Design tab (the Lacquer column
// in its Product container) and the Company Wrapped "Lacquer Used (m²)" figure, so the two can
// never drift apart. Per cutlist piece:
//
//   faces = long × short × sides   (sides: 1 for "Lacquer (1 side)", 2 for "Lacquer (2 side)")
//   edges = each clashed edge's length × 20 mm (an average board thickness). Edges are counted
//           once however many faces get sprayed: "1L" is one long edge, "2L" both long edges,
//           "1S"/"2S" the same for the short edges.
//   area  = (faces + edges) × quantity, in mm²; ÷ 1,000,000 for m².
//
// "Long"/"short" are the piece's longer/shorter face dimension, the same way the edge-tape maths
// reads the L/S in a clash value.

export const LACQUER_EDGE_THICKNESS_MM = 20;

/** How many faces of a piece get lacquered; 0 means the piece isn't lacquered at all. */
export type LacquerSides = 0 | 1 | 2;

/** Company Settings > Sales > Products "Type" value → lacquered faces ("lacquer-1" / "lacquer-2"). */
export function lacquerSidesForProductType(type: unknown): LacquerSides {
  const value = String(type ?? "").trim().toLowerCase();
  if (value === "lacquer-2") return 2;
  if (value === "lacquer-1") return 1;
  return 0;
}

/**
 * Clashed long/short edges in a clash value, however it was written: "1L", "2L 1S", "2L1S",
 * "1L, 2S", and the old "2SH" spelling all parse. Capped at 2 each, since a rectangle only has two
 * long and two short edges.
 */
export function parseClashEdgeCounts(raw: unknown): { long: number; short: number } {
  let long = 0;
  let short = 0;
  for (const match of String(raw ?? "").toUpperCase().matchAll(/([12])\s*([LS])/g)) {
    if (match[2] === "L") long += Number(match[1]);
    else short += Number(match[1]);
  }
  return { long: Math.min(2, long), short: Math.min(2, short) };
}

// Positive number at the start of a dimension field ("600", "600mm", "600,5"), else 0. Same
// leniency as the edge-tape maths' own parser.
function parseDimMm(value: unknown): number {
  const match = String(value ?? "").replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const n = Number.parseFloat(match[0]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Lacquered area of one cutlist piece across its whole quantity, in mm². `dims` is the piece's
 * height/width/depth. Most pieces only fill two of them (a cabinet side is height × depth, a shelf
 * width × depth), so the face is always the two largest values; a third, smaller value would be a
 * thickness, not part of the face.
 */
export function lacquerPieceAreaMm2(piece: {
  dims: unknown[];
  clash: unknown;
  quantity: unknown;
  sides: LacquerSides;
}): number {
  if (piece.sides <= 0) return 0;
  const qty = Math.max(0, Number.parseInt(String(piece.quantity ?? "0"), 10) || 0);
  if (qty <= 0) return 0;
  const [long = 0, short = 0] = piece.dims.map(parseDimMm).filter((v) => v > 0).sort((a, b) => b - a);
  if (long <= 0) return 0;
  const faceMm2 = long * short * piece.sides;
  const edges = parseClashEdgeCounts(piece.clash);
  const edgeMm2 = (edges.long * long + edges.short * short) * LACQUER_EDGE_THICKNESS_MM;
  return (faceMm2 + edgeMm2) * qty;
}

export function mm2ToM2(mm2: number): number {
  return mm2 / 1_000_000;
}

/** "3.42", "0.5", "12": at most 2 decimals with trailing zeros dropped, like the edge-tape metres. */
export function formatLacquerSqm(m2: number): string {
  const rounded = Math.round(Math.max(0, m2) * 100) / 100;
  return rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(2).replace(/\.?0+$/, "");
}
