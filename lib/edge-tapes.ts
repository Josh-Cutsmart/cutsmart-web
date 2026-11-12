// Edge tapes: the company's library of them (Company Settings › Materials & Boards — a name or colour, its thickness
// and width), and a cutlist piece's clashed edges, each on the board's own tape (Board Settings' Edging — "Matching")
// or one of the library's.
//
// A piece's edges are its two long ones (L1, L2) and its two short ones (S1, S2) — which way round it's cut doesn't
// change which they are. The Clashing column counts them (1L, 2L, 1S, 2S) as it always has; a piece's `edges` adds which
// of them exactly (clicked on its drawing) and the tape on each. Shared by the app and the server.

import { evaluateDimensionMath } from "@/lib/dimension-math";

export type EdgeTape = { id: string; name: string; thicknessMm: number; widthMm: number };

export type EdgeKey = "L1" | "L2" | "S1" | "S2";
export const EDGE_KEYS: readonly EdgeKey[] = ["L1", "L2", "S1", "S2"];
const LONG_KEYS: readonly EdgeKey[] = ["L1", "L2"];
const SHORT_KEYS: readonly EdgeKey[] = ["S1", "S2"];

// A piece's edges as clicked on its drawing: each one there is clashed — "" on the board's own tape (Matching), or an
// edge tape's id.
export type RowEdges = Partial<Record<EdgeKey, string>>;
export type ResolvedEdge = { key: EdgeKey; tapeId: string };
export type EdgeSide = "top" | "right" | "bottom" | "left";

const num = (value: unknown) => {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").replace(/,/g, "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function normalizeEdgeTapeLibrary(raw: unknown): EdgeTape[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EdgeTape[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, thicknessMm: num(row.thicknessMm), widthMm: num(row.widthMm) });
  }
  return out;
}

// "Black (1 × 22mm)" — its name or colour, then its thickness × width in brackets (whichever it has).
export function edgeTapeLabel(tape: Pick<EdgeTape, "name" | "thicknessMm" | "widthMm">): string {
  const size = [tape.thicknessMm, tape.widthMm].filter((n) => n > 0).map((n) => String(Number(n.toFixed(2))));
  return [tape.name || "Edge tape", size.length ? `(${size.join(" × ")}mm)` : ""].filter(Boolean).join(" ");
}

// The library, most picked first (Company Settings keeps how many times each has been picked — edgeTapePicks).
export function edgeTapesByPicks(library: readonly EdgeTape[], picks: unknown): EdgeTape[] {
  const counts = picks && typeof picks === "object" ? (picks as Record<string, unknown>) : {};
  const countOf = (id: string) => Number(counts[id]) || 0;
  return library
    .map((tape, index) => ({ tape, index }))
    .sort((a, b) => countOf(b.tape.id) - countOf(a.tape.id) || a.index - b.index)
    .map((entry) => entry.tape);
}

// The thickness the library's tapes are picked in most (each tape's times picked, added up by its thickness) — what a new
// tape's Thickness starts as. None picked yet: the thickness most of its tapes are; no thicknesses at all: 0.
export function mostUsedEdgeTapeThickness(library: readonly EdgeTape[], picks: Record<string, number>): number {
  const byThickness = new Map<number, { picks: number; tapes: number; first: number }>();
  library.forEach((tape, index) => {
    if (!(tape.thicknessMm > 0)) return;
    const entry = byThickness.get(tape.thicknessMm) ?? { picks: 0, tapes: 0, first: index };
    entry.picks += Number(picks[tape.id]) || 0;
    entry.tapes += 1;
    byThickness.set(tape.thicknessMm, entry);
  });
  let best = 0;
  let bestEntry: { picks: number; tapes: number; first: number } | null = null;
  for (const [thickness, entry] of byThickness) {
    if (
      !bestEntry ||
      entry.picks > bestEntry.picks ||
      (entry.picks === bestEntry.picks && (entry.tapes > bestEntry.tapes || (entry.tapes === bestEntry.tapes && entry.first < bestEntry.first)))
    ) {
      best = thickness;
      bestEntry = entry;
    }
  }
  return best;
}

export function normalizeRowEdges(raw: unknown): RowEdges | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: RowEdges = {};
  for (const key of EDGE_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    out[key] = String(value).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

// How many long and short edges a Clashing says (1L / 2L / 1S / 2S, in its two parts or in one).
export function clashCounts(row: { clashLeft?: unknown; clashRight?: unknown; clashing?: unknown }): { long: number; short: number } {
  let long = 0;
  let short = 0;
  const text = `${String(row.clashLeft ?? "")} ${String(row.clashRight ?? "")} ${row.clashLeft || row.clashRight ? "" : String(row.clashing ?? "")}`;
  for (const match of text.toUpperCase().matchAll(/([12])\s*([LS])/g)) {
    if (match[2] === "L") long = Math.max(long, Number(match[1]));
    else short = Math.max(short, Number(match[1]));
  }
  return { long, short };
}

// A piece's clashed edges, and the tape on each: its Clashing's counts, the edges picked on its drawing among them
// (any more than it counts left off; any fewer, the rest added, in order — L1 before L2), each on the tape it was given
// there (or the board's own).
export function resolveRowEdges(row: { edges?: RowEdges; clashLeft?: unknown; clashRight?: unknown; clashing?: unknown }): ResolvedEdge[] {
  const { long, short } = clashCounts(row);
  const edges = row.edges ?? {};
  const pick = (keys: readonly EdgeKey[], count: number): ResolvedEdge[] => {
    const chosen = keys.filter((key) => edges[key] !== undefined);
    const kept = chosen.slice(0, count);
    for (const key of keys) {
      if (kept.length >= count) break;
      if (!kept.includes(key)) kept.push(key);
    }
    return keys.filter((key) => kept.includes(key)).map((key) => ({ key, tapeId: String(edges[key] ?? "") }));
  };
  return [...pick(LONG_KEYS, long), ...pick(SHORT_KEYS, short)];
}

// Edges picked on the drawing as the Clashing column writes them.
export function clashingFromEdges(edges: RowEdges): { clashLeft: string; clashRight: string } {
  const long = LONG_KEYS.filter((key) => edges[key] !== undefined).length;
  const short = SHORT_KEYS.filter((key) => edges[key] !== undefined).length;
  return { clashLeft: long ? `${long}L` : "", clashRight: short ? `${short}S` : "" };
}

// Where an edge is on the piece as it's drawn: a tall one's long edges its sides (L1 the right), a wide one's its top
// and bottom (L1 the bottom) — as part labels mark them (lib/part-labels.ts' clashedEdgesFor).
export function edgeSide(key: EdgeKey, tall: boolean): EdgeSide {
  if (tall) return key === "L1" ? "right" : key === "L2" ? "left" : key === "S1" ? "bottom" : "top";
  return key === "L1" ? "bottom" : key === "L2" ? "top" : key === "S1" ? "right" : "left";
}
export function edgeAtSide(side: EdgeSide, tall: boolean): EdgeKey {
  return EDGE_KEYS.find((key) => edgeSide(key, tall) === side) as EdgeKey;
}

// A Height or Width as typed ("560", or a sum like "600-40"), in mm — 0 when there isn't one.
const sizeMm = (value: unknown): number => {
  const text = String(value ?? "").trim();
  const n = Number.parseFloat(evaluateDimensionMath(text) ?? text);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
// A piece as its edge drawing draws it: its Height up (else its Depth) and its Width across (else its Depth) — whichever
// two of its three sizes it has, as its part label draws it (a gable's Height × Depth, a shelf's Width × Depth).
export function pieceDrawnSize(row: { height?: unknown; width?: unknown; depth?: unknown }): { height: string; width: string } {
  const height = String(row.height ?? "").trim();
  const width = String(row.width ?? "").trim();
  const depth = String(row.depth ?? "").trim();
  return { height: sizeMm(height) > 0 ? height : depth, width: sizeMm(width) > 0 ? width : depth };
}

// A piece's clashed edges after its Height or Width change, when they were picked on its drawing before its size said
// which way round it is: with a size missing (or the two the same) the drawing's only a stand-in, so which edges it
// called long and which short wasn't real. Each edge stays on the side it was clicked on (its top, its right…), called
// long or short as the piece is drawn now — at each step (its Height typed in before its Width turns the drawing upright
// already). `edges` are its clashed edges as they were (resolveRowEdges); undefined when nothing changes (its size was
// already known, or it's drawn the same way round).
export function edgesForSizeChange(
  edges: readonly ResolvedEdge[],
  before: { height?: unknown; width?: unknown },
  after: { height?: unknown; width?: unknown },
): RowEdges | undefined {
  if (!edges.length) return undefined;
  const bh = sizeMm(before.height);
  const bw = sizeMm(before.width);
  const ah = sizeMm(after.height);
  const aw = sizeMm(after.width);
  if (bh > 0 && bw > 0 && bh !== bw) return undefined;
  // (As the drawing has it: tall when its Height is more than its Width — a missing one counting as none.)
  const beforeTall = bh > bw;
  const afterTall = ah > aw;
  if (beforeTall === afterTall) return undefined;
  const out: RowEdges = {};
  for (const edge of edges) out[edgeAtSide(edgeSide(edge.key, beforeTall), afterTall)] = edge.tapeId;
  return out;
}

// A project's extra edge tape — metres typed in under Board Settings, tied to no board or piece (spares, site work): by
// tape, the metres as typed. Added to whatever the cutlist needs of that tape for what's ordered.
export type ExtraEdgeTapes = Record<string, string>;
export function normalizeExtraEdgeTapes(raw: unknown): ExtraEdgeTapes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ExtraEdgeTapes = {};
  for (const [tapeId, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(tapeId || "").trim();
    if (id && !id.includes(".")) out[id] = String(value ?? "").trim();
  }
  return out;
}
// Edge tape typed into a project by hand (the Edge Tape card's +): a colour and the metres to order, tied to no tape in the
// library, board or piece — projectSettings.manualEdgeTapes, in the order they were added.
export type ManualEdgeTape = { id: string; colour: string; metres: string };
export function normalizeManualEdgeTapes(raw: unknown): ManualEdgeTape[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ManualEdgeTape[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, colour: String(row.colour ?? "").trim(), metres: String(row.metres ?? "").trim() });
  }
  return out;
}

// Metres as Board Settings writes them: up to two decimals, no trailing zeros.
export function formatEdgeTapeMetres(metres: number): string {
  const rounded = Math.round(Math.max(0, metres) * 100) / 100;
  return rounded % 1 === 0 ? String(Math.round(rounded)) : String(rounded.toFixed(2).replace(/\.?0+$/, ""));
}

// The tapes other than a board's own, on a piece, by tape: how many mm of each across its whole quantity, and how many
// runs (edges × quantity — for the excess at each end). Edge tape totals take these off the board's.
export function differentTapeRuns(
  row: { edges?: RowEdges; clashLeft?: unknown; clashRight?: unknown; clashing?: unknown },
  longMm: number,
  shortMm: number,
  qty: number,
): Array<{ tapeId: string; mm: number; runs: number }> {
  if (qty <= 0) return [];
  const out = new Map<string, { mm: number; runs: number }>();
  for (const edge of resolveRowEdges(row)) {
    if (!edge.tapeId) continue;
    const length = edge.key.startsWith("L") ? longMm : shortMm;
    if (!(length > 0)) continue;
    const prev = out.get(edge.tapeId) ?? { mm: 0, runs: 0 };
    out.set(edge.tapeId, { mm: prev.mm + length * qty, runs: prev.runs + qty });
  }
  return Array.from(out, ([tapeId, value]) => ({ tapeId, ...value }));
}
