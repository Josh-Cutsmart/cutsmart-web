"use client";

import type { jsPDF as JsPdf } from "jspdf";
import { resolveProjectImageUrl } from "@/lib/project-image-data";

// The title sheet a production print starts with (Nesting, CNC Cutlist, the Cutlist — as the CNC Cutlist's always has):
// the company's logo top right; then, down the middle of the page, the print's name (its tab's) and the company, a rule,
// the project and who it's for (its assigned user, else whoever created it), a rule, and NOTES — the project's
// production Notes (the Production Cutlist's Notes box; not the contractors'). Drawn on whatever page the doc is on, in
// whatever size and unit it uses.

export type PrintTitleLogo = { dataUrl: string; format: "PNG" | "JPEG" | "WEBP"; width: number; height: number };

export type PrintTitlePage = {
  // "CNC CUTLIST", "NESTING", "CUTLIST".
  heading: string;
  companyName: string;
  projectName: string;
  person: string;
  // Plain text (lines kept).
  notes: string;
  logo: PrintTitleLogo | null;
};

const EDGE = 18;
const NOTES_FONT = 11;
const NOTES_LINE = 15;

export function drawPrintTitlePage(doc: JsPdf, page: PrintTitlePage): void {
  // Laid out in points, whatever the doc's own unit.
  const scale = doc.internal.scaleFactor;
  const u = (pt: number) => pt / scale;
  const width = doc.internal.pageSize.getWidth() * scale;
  const height = doc.internal.pageSize.getHeight() * scale;
  const left = EDGE;
  const right = width - EDGE;

  if (page.logo) {
    const maxW = 190;
    const maxH = 90;
    const ratio = page.logo.width / Math.max(1, page.logo.height);
    let drawW = maxW;
    let drawH = drawW / Math.max(0.0001, ratio);
    if (drawH > maxH) {
      drawH = maxH;
      drawW = drawH * ratio;
    }
    doc.addImage(page.logo.dataUrl, page.logo.format, u(right - drawW), u(EDGE + 6), u(drawW), u(drawH));
  }

  // The notes under NOTES, as many lines as the page has room for (the last cut short when there's more).
  doc.setFont("helvetica", "normal");
  doc.setFontSize(NOTES_FONT);
  const wrapped = page.notes.trim() ? (doc.splitTextToSize(page.notes.trim(), u(right - left)) as string[]) : [];
  // The block centred down the page (as it always has been, with no notes): its top no higher than under the logo.
  const blockBase = 232;
  const minTop = 28;
  const maxLines = Math.max(0, Math.floor((height - EDGE - (minTop + 152)) / NOTES_LINE));
  let lines = wrapped.slice(0, maxLines);
  if (wrapped.length > maxLines && lines.length) {
    lines = [...lines.slice(0, -1), `${lines[lines.length - 1].replace(/\s*\S*$/, "")}…`];
  }
  const blockHeight = Math.max(blockBase, 152 + lines.length * NOTES_LINE);
  const top = Math.max(minTop, (height - blockHeight) / 2);

  doc.setTextColor(17, 17, 17);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(page.heading, u(left), u(top + 20), { align: "left" });
  doc.text(page.companyName, u(right), u(top + 20), { align: "right" });
  doc.setDrawColor(17, 17, 17);
  doc.setLineWidth(u(0.8));
  doc.line(u(left), u(top + 38), u(right), u(top + 38));
  doc.setFontSize(14);
  doc.text(page.projectName, u(left), u(top + 66), { align: "left" });
  doc.setFontSize(12);
  doc.text(page.person, u(right), u(top + 66), { align: "right" });
  doc.line(u(left), u(top + 90), u(right), u(top + 90));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("NOTES", u(left), u(top + 132), { align: "left" });
  if (lines.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(NOTES_FONT);
    doc.setTextColor(40, 40, 40);
    lines.forEach((line, index) => doc.text(line, u(left), u(top + 152 + index * NOTES_LINE)));
  }
}

// Notes as they're kept (the notes editor's HTML) as plain lines for a title sheet: each paragraph, line break and list
// item on its own line (list items with a bullet), and the editor's escapes (&amp;, &nbsp;, …) back as what they are.
export function notesHtmlToPlainText(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw.trim()) return "";
  const text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  let decoded = text;
  if (typeof document !== "undefined") {
    const box = document.createElement("textarea");
    box.innerHTML = text;
    decoded = box.value;
  }
  return decoded
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The company's logo for a title sheet (from its stored path or link) — null when there's none, or it won't load.
export async function loadPrintTitleLogo(raw: string): Promise<PrintTitleLogo | null> {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const url = (await resolveProjectImageUrl(value)) || (/^https?:\/\//i.test(value) ? value : "");
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const mime = String(blob.type || "").toLowerCase();
    const format: PrintTitleLogo["format"] = mime.includes("jpeg") || mime.includes("jpg") ? "JPEG" : mime.includes("webp") ? "WEBP" : "PNG";
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("file-reader-failed"));
      reader.readAsDataURL(blob);
    });
    const size = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: Math.max(1, img.naturalWidth || 1), h: Math.max(1, img.naturalHeight || 1) });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = dataUrl;
    });
    return { dataUrl, format, width: size.w, height: size.h };
  } catch {
    return null;
  }
}
