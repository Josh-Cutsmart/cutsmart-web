// A cutlist shape (lib/cutlist-shape.ts) as a DXF — the plain AutoCAD R12 kind every CAM program reads, in mm.
// Pure, no React.
//
//  - Layer CUT: the outline, one closed POLYLINE — its VERTEXes' bulges (group 42) making its curves and rounded
//    corners true arcs, not chopped into lines.
//  - Layer BANDING: each banded stretch (banded edges joined through their rounded or smooth corners) as a polyline of
//    its own, over the outline — open, or closed if it goes the whole way round.
//
// Drawn the way up it's seen (the DXF's y runs up the page, the shape's down: it's turned over), its box's bottom left
// corner at 0, 0. A shape's bulges are already signed for that (lib/cutlist-shape.ts), so they go in as they are.

import { shapeBandedChains, shapeGeometry, type CutlistShape, type ShapeCorner, type ShapeGeometry, type ShapePoint } from "@/lib/cutlist-shape";

type DxfVertex = { point: ShapePoint; bulge: number };

// A rounded corner's curve as a bulge, its start to its end (signed as a shape's are).
function cornerBulge(corner: ShapeCorner): number {
  const turn = Math.tan((Math.PI - corner.angle) / 4);
  // (Its sweep 1: angles increasing as the numbers run — clockwise as it's seen, so −.)
  return corner.sweep ? -turn : turn;
}
const edgeBulge = (geometry: ShapeGeometry, edge: number) => geometry.edges[edge]?.curve?.bulge ?? 0;

// The outline's vertices: a rounded corner its curve's two ends (the first carrying the curve), a sharp one its point —
// each carrying the curve (if it is one) of the edge from it.
function outlineVertices(geometry: ShapeGeometry): DxfVertex[] {
  const out: DxfVertex[] = [];
  for (const corner of geometry.corners) {
    if (corner.radius > 0) {
      out.push({ point: corner.start, bulge: cornerBulge(corner) });
      out.push({ point: corner.end, bulge: edgeBulge(geometry, corner.index) });
    } else {
      out.push({ point: corner.point, bulge: edgeBulge(geometry, corner.index) });
    }
  }
  return out;
}

// A banded stretch's vertices, its first edge's start on.
function chainVertices(geometry: ShapeGeometry, chain: { edges: number[]; closed: boolean }): DxfVertex[] {
  const n = geometry.corners.length;
  const out: DxfVertex[] = [];
  chain.edges.forEach((edgeIndex, k) => {
    const edge = geometry.edges[edgeIndex];
    out.push({ point: edge.from, bulge: edge.curve?.bulge ?? 0 });
    if (k === chain.edges.length - 1 && !chain.closed) {
      out.push({ point: edge.to, bulge: 0 });
      return;
    }
    // (Into the next edge: round its rounded corner — a smooth one's the same point, the next edge's start.)
    const corner = geometry.corners[(edgeIndex + 1) % n];
    if (corner.radius > 0) out.push({ point: corner.start, bulge: cornerBulge(corner) });
  });
  return out;
}

// A number as a DXF wants it: plain decimals, no exponent, no −0.
function num(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  const text = Number(value.toFixed(6)).toString();
  if (text === "-0") return "0.0";
  return text.includes(".") ? text : `${text}.0`;
}

export function shapeToDxf(shape: CutlistShape, options: { name?: string } = {}): string {
  const geometry = shapeGeometry(shape);
  const b = geometry.bounds;
  // Turned the right way up, its box's corner at 0, 0.
  const at = (p: ShapePoint): ShapePoint => [p[0] - b.minX, b.maxY - p[1]];
  const lines: string[] = [];
  const pair = (code: number, value: string) => {
    lines.push(String(code).padStart(3, " "));
    lines.push(value);
  };
  const name = String(options.name ?? "").replace(/[\r\n]+/g, " ").trim();
  if (name) pair(999, name);

  // ---- HEADER: R12, in mm, and how far it reaches.
  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$ACADVER");
  pair(1, "AC1009");
  pair(9, "$INSUNITS");
  pair(70, "4");
  pair(9, "$EXTMIN");
  pair(10, num(0));
  pair(20, num(0));
  pair(30, num(0));
  pair(9, "$EXTMAX");
  pair(10, num(geometry.valid ? b.width : 0));
  pair(20, num(geometry.valid ? b.height : 0));
  pair(30, num(0));
  pair(0, "ENDSEC");

  // ---- TABLES: the one line type the layers use, and the two layers.
  pair(0, "SECTION");
  pair(2, "TABLES");
  pair(0, "TABLE");
  pair(2, "LTYPE");
  pair(70, "1");
  pair(0, "LTYPE");
  pair(2, "CONTINUOUS");
  pair(70, "0");
  pair(3, "Solid line");
  pair(72, "65");
  pair(73, "0");
  pair(40, num(0));
  pair(0, "ENDTAB");
  pair(0, "TABLE");
  pair(2, "LAYER");
  pair(70, "2");
  for (const [layer, colour] of [
    ["CUT", "7"],
    ["BANDING", "30"],
  ] as const) {
    pair(0, "LAYER");
    pair(2, layer);
    pair(70, "0");
    pair(62, colour);
    pair(6, "CONTINUOUS");
  }
  pair(0, "ENDTAB");
  pair(0, "ENDSEC");

  // ---- ENTITIES.
  const polyline = (layer: string, vertices: DxfVertex[], closed: boolean) => {
    if (vertices.length < 2) return;
    pair(0, "POLYLINE");
    pair(8, layer);
    pair(66, "1");
    pair(10, num(0));
    pair(20, num(0));
    pair(30, num(0));
    pair(70, closed ? "1" : "0");
    for (const vertex of vertices) {
      const p = at(vertex.point);
      pair(0, "VERTEX");
      pair(8, layer);
      pair(10, num(p[0]));
      pair(20, num(p[1]));
      pair(30, num(0));
      if (Math.abs(vertex.bulge) > 1e-9) pair(42, num(vertex.bulge));
    }
    pair(0, "SEQEND");
    pair(8, layer);
  };
  pair(0, "SECTION");
  pair(2, "ENTITIES");
  if (geometry.valid) {
    polyline("CUT", outlineVertices(geometry), true);
    for (const chain of shapeBandedChains(geometry)) polyline("BANDING", chainVertices(geometry, chain), chain.closed);
  }
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return `${lines.join("\r\n")}\r\n`;
}

// A file name for it ("Corner shelf.dxf"), safe on any computer.
export function shapeDxfFileName(name: string): string {
  const safe = String(name || "shape").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "shape";
  return `${safe}.dxf`;
}
