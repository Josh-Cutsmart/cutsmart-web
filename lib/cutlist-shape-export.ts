// A Custom piece's drawing exported from the shape editor (components/cutlist-shape-editor.tsx): its 2D drawing with all
// its numbers (lib/cutlist-shape-render.ts's shapeDrawingOps — a cabinet's plan, lib/cutlist-cabinet-shape.ts's
// cabinetPlanDrawingOps), or its 3D view as it's seen with its overall sizes (cabinet3dDrawingOps) — as a PNG, or a PDF
// (A4 across, a title line over it: its part name, part type, room and board). Each made at the size it's to be, then
// drawn: a PNG on a canvas, a PDF in vectors (lib/cutlist-print-pdf.ts's drawShapeDrawingOps). A browser only; nothing's
// downloaded but on a click.

import { drawShapeDrawingOps } from "@/lib/cutlist-print-pdf";
import { paintShapeDrawingOps, type ShapeDrawing } from "@/lib/cutlist-shape-render";

export type ShapeExportTitle = { name: string; partType: string; room: string; board: string };
// What makes the drawing at a size (px — a PDF's points).
export type ShapeDrawingBuilder = (size: { width: number; height: number; fontSize: number }) => ShapeDrawing;

// "Corner shelf - 2D.pdf": its part name (else its part type), which view, the kind of file — nothing a file name can't have.
export function shapeExportFileName(title: ShapeExportTitle, which: "2D" | "3D", extension: "png" | "pdf"): string {
  const base = (String(title.name || "").trim() || String(title.partType || "").trim() || "Custom piece").replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `${base} - ${which}.${extension}`;
}

const download = (href: string, fileName: string) => {
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// As a PNG: 1400 × 950, twice that many pixels (sharp enough to print), on white.
export function downloadShapeDrawingPng(build: ShapeDrawingBuilder, fileName: string): void {
  if (typeof document === "undefined") return;
  const drawing = build({ width: 1400, height: 950, fontSize: 15 });
  const ratio = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(drawing.width * ratio));
  canvas.height = Math.max(1, Math.round(drawing.height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(ratio, ratio);
  paintShapeDrawingOps(ctx, drawing.ops);
  download(canvas.toDataURL("image/png"), fileName);
}

// As a PDF: A4 across, its title line along the top, the drawing filling the rest.
export async function downloadShapeDrawingPdf(build: ShapeDrawingBuilder, title: ShapeExportTitle, fileName: string): Promise<void> {
  if (typeof document === "undefined") return;
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 32;
  const heading = String(title.name || "").trim() || String(title.partType || "").trim() || "Custom piece";
  const details = [title.name ? title.partType : "", title.room, title.board ? `Board: ${title.board}` : ""].map((part) => String(part || "").trim()).filter(Boolean);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor("#0F172A");
  doc.text(heading, margin, margin + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor("#334155");
  if (details.length) doc.text(details.join("  ·  "), margin, margin + 26);
  const top = margin + 40;
  const drawing = build({ width: pageW - 2 * margin, height: pageH - top - margin, fontSize: 9 });
  drawShapeDrawingOps(doc, drawing.ops, margin, top);
  doc.save(fileName);
}
