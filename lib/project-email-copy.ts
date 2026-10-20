// A project's copy, emailed to staff as it's deleted for good (the Archive's "Delete permanently" pop-up): its client
// details in the email's body, its Specifications, Quote, Initial measure cutlist and Production cutlist as PDFs, and its
// images —
// whichever of those whoever's deleting leaves on (lib/project-copy-sections.ts). The subject is "Deleted: <project name>".
// - The PDFs are made here, in the browser (the Specifications and Quote as their own Print/Download makes them —
//   lib/specs-grid-pdf.ts; the cutlists as tables — lib/cutlist-pdf.ts).
// - They're uploaded into the project's own Storage folder (…/email-copy/), and app/api/projects/email-copy sends the
//   email with them attached (they're too big to send it in a request), then they're removed again.
// - From the Preview, the PDFs are made but nothing's uploaded or sent.

import { deleteObject, getBlob, ref as storageRef, uploadBytes, type StorageReference } from "firebase/storage";
import { getDoc } from "@/lib/firestore-client";
import { storage } from "@/lib/firebase";
import { authorizedFetch } from "@/lib/api-fetch";
import { isPreviewMode } from "@/lib/preview-mode";
import { activeDate, activeUnit, activeUnitLabel, formatLength } from "@/lib/company-formats";
import {
  extractLegacySalesFieldFromRawDoc,
  fetchCompanyDoc,
  fetchCutlistData,
  fetchGridVersions,
  fetchProjectMediaData,
  fetchSalesGridData,
  normalizeProjectImageItems,
  parseCutlistRows,
  resolveProjectDocRef,
} from "@/lib/firestore-data";
import { normalizeSpecsGrid, withCurrentCompanyLogo, type SpecsGrid } from "@/lib/specs-grid-types";
import { buildCutlistPdfBlob, type CutlistPdfBoard } from "@/lib/cutlist-pdf";
import { PROJECT_COPY_SECTIONS, projectCopyFileName, type ProjectCopySection, type ProjectCopySections } from "@/lib/project-copy-sections";
import type { Project } from "@/lib/types";

export type ProjectCopyResult = { ok: true; preview?: boolean } | { ok: false; error: string };

const toStr = (value: unknown) => String(value ?? "").trim();
const labelOf = (key: ProjectCopySection) => PROJECT_COPY_SECTIONS.find((section) => section.key === key)?.label ?? key;

// Its own doc's data — where an older project still keeps its sheets and cutlists (read once, only if needed).
function legacyReader(project: Project) {
  let data: Promise<Record<string, unknown> | null> | null = null;
  return () => {
    data ??= resolveProjectDocRef(project)
      .then((ref) => (ref ? getDoc(ref) : null))
      .then((snap) => (snap?.exists() ? ((snap.data() ?? {}) as Record<string, unknown>) : null))
      .catch(() => null);
    return data;
  };
}

// Its Quote or Specifications: the version its client accepted (a quote) or submitted (the specifications) — the latest,
// if more than one was — and failing that, the sheet as it is now (its live one, or an older project's own copy).
async function loadGrid(
  project: Project,
  kind: "quote" | "specifications",
  legacy: ReturnType<typeof legacyReader>,
): Promise<{ grid: SpecsGrid; state: "accepted" | "submitted" | "" } | null> {
  const versions = await fetchGridVersions(project, kind === "quote" ? "quoteGridVersions" : "specificationsVersions").catch(() => []);
  const stampOf = (version: (typeof versions)[number]) => toStr(kind === "quote" ? version.acceptedAtIso : version.submittedAtIso);
  const final = versions.filter((version) => stampOf(version)).sort((a, b) => stampOf(b).localeCompare(stampOf(a)))[0];
  if (final) return { grid: final.grid, state: kind === "quote" ? "accepted" : "submitted" };
  const stored = await fetchSalesGridData(project, kind).catch(() => null);
  if (stored?.grid) return { grid: stored.grid, state: "" };
  const raw = await legacy();
  const grid = raw ? normalizeSpecsGrid(extractLegacySalesFieldFromRawDoc(raw, kind === "quote" ? "quoteGrid" : "specificationsGrid")) : null;
  return grid ? { grid, state: "" } : null;
}

// Its boards (Production › Board settings, kept on its own doc): by the key a cutlist row keeps ("<label> @@ <sheet>")
// and by label — each one's label, its sheet's length in metres ("2.4"), and whether it has grain.
function boardsOf(raw: Record<string, unknown> | null): Record<string, CutlistPdfBoard> {
  const settings = (raw?.projectSettings ?? {}) as Record<string, unknown>;
  const out: Record<string, CutlistPdfBoard> = {};
  for (const item of Array.isArray(settings.boardTypes) ? settings.boardTypes : []) {
    const row = (item ?? {}) as Record<string, unknown>;
    const thickness = toStr(row.thickness);
    const label = [toStr(row.colour), thickness ? (thickness.toLowerCase().endsWith("mm") ? thickness : `${thickness}mm`) : "", toStr(row.finish)]
      .filter(Boolean)
      .join(" ");
    if (!label) continue;
    const sheet = toStr(row.sheetSize);
    const mm = Number.parseFloat(sheet.split("x")[0] || "");
    const board = { label, size: Number.isFinite(mm) && mm > 0 ? (Math.floor(mm / 100) / 10).toFixed(1).replace(/\.0$/, "") : "", grain: row.grain === true };
    out[label] = board;
    if (sheet) out[`${label} @@ ${sheet}`] = board;
  }
  return out;
}

async function loadCutlistRows(project: Project, kind: "production" | "initialMeasure", legacy: ReturnType<typeof legacyReader>): Promise<unknown[]> {
  const stored = await fetchCutlistData(project, kind).catch(() => null);
  if (stored) return stored.rows;
  const raw = await legacy();
  if (!raw) return [];
  if (kind === "production") return parseCutlistRows(raw);
  const initial = extractLegacySalesFieldFromRawDoc(raw, "initialCutlist");
  const rows = initial && typeof initial === "object" ? (initial as Record<string, unknown>).rows : undefined;
  return Array.isArray(rows) ? rows : [];
}

// Its images (the project's Images card, at most 10): each one's Storage path or URL, and its name.
async function loadImages(project: Project, legacy: ReturnType<typeof legacyReader>): Promise<Array<{ source: string; name: string }>> {
  const stored = await fetchProjectMediaData(project, "images").catch(() => null);
  const raw = stored ?? (await legacy());
  if (!raw) return [];
  const items = normalizeProjectImageItems(raw.projectImageItems);
  if (items.length) return items.map((item) => ({ source: item.url, name: item.name }));
  return (Array.isArray(raw.projectImages) ? raw.projectImages : []).map((source) => ({ source: String(source || ""), name: "" })).filter((item) => item.source);
}

// An image as it's attached: no bigger than 2000px either way, as a JPEG — a phone photo's a few MB, and the email has
// to stay under Resend's limit. One the browser can't open (e.g. a HEIC) goes as it is.
const IMAGE_MAX_PX = 2000;
async function emailSizedImage(blob: Blob): Promise<{ blob: Blob; ext: string }> {
  const original = { blob, ext: (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "jpg" };
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, IMAGE_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return original;
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return jpeg && jpeg.size < blob.size ? { blob: jpeg, ext: "jpg" } : original;
  } catch {
    return original;
  }
}
// What all of its attachments together may come to (the server allows a little more).
const MAX_ATTACHMENTS_BYTES = 24 * 1024 * 1024;

// Its client details, for the email's body.
function clientDetailsOf(project: Project): Array<{ label: string; value: string }> {
  const customer = toStr(project.customer);
  return [
    { label: "Client", value: customer === "Unknown Customer" ? "" : customer },
    { label: "Email", value: toStr(project.clientEmail) },
    { label: "Phone", value: toStr(project.clientPhone) },
    { label: "Address", value: toStr(project.clientAddress) },
    { label: "Project", value: toStr(project.name) },
    { label: "Status", value: toStr(project.statusLabel) },
    { label: "Assigned to", value: toStr(project.assignedToName) },
    { label: "Created", value: [activeDate(project.createdAt), toStr(project.createdByName) ? `by ${toStr(project.createdByName)}` : ""].filter(Boolean).join(" ") },
    { label: "Completed", value: activeDate(project.completedAtIso) },
    { label: "Notes", value: toStr(project.notes) },
  ].filter((row) => row.value);
}

// Its PDFs — each one wanted and there to make; and those wanted but not on the project.
export async function buildProjectCopyFiles(
  project: Project,
  sections: ProjectCopySections,
): Promise<{ files: Array<{ filename: string; blob: Blob; ext: string }>; missing: string[] }> {
  const legacy = legacyReader(project);
  const companyDoc = (await fetchCompanyDoc(project.companyId).catch(() => null)) ?? {};
  const theme = (companyDoc.theme ?? {}) as Record<string, unknown>;
  const logoPath = toStr(companyDoc.logoPath) || toStr(theme.logoPath);
  const files: Array<{ filename: string; blob: Blob; ext: string }> = [];
  const missing: string[] = [];

  for (const kind of ["specifications", "quote"] as const) {
    if (!sections[kind]) continue;
    const sheet = await loadGrid(project, kind, legacy);
    const { buildSpecsGridPdfBlob } = await import("@/lib/specs-grid-pdf");
    const blob = sheet ? await buildSpecsGridPdfBlob(withCurrentCompanyLogo(sheet.grid, logoPath)).catch(() => null) : null;
    // Named for what it is: "Quote (accepted)", "Specifications (submitted)" — or just "Quote", the sheet as it is.
    if (blob && sheet) files.push({ filename: projectCopyFileName(project.name, `${labelOf(kind)}${sheet.state ? ` (${sheet.state})` : ""}`), blob, ext: "pdf" });
    else missing.push(labelOf(kind));
  }

  if (sections.initialMeasure || sections.production) {
    // Part type colours, as the cutlists show them (Company Settings › Production › Part types).
    const partTypeColors: Record<string, string> = {
      Front: "#F2D57A",
      Panel: "#C6E8AE",
      Extra: "#B7A4EB",
      Drawer: "#B8D8F8",
      Cabinet: "#4B5563",
      "Special Panel": "#BF1D1D",
      Unassigned: "#CBD5E1",
    };
    for (const item of Array.isArray(companyDoc.partTypes) ? companyDoc.partTypes : []) {
      const row = (item ?? {}) as Record<string, unknown>;
      const name = toStr(row.name);
      const color = toStr(row.color ?? row.colour ?? row.hex ?? row.chipColor);
      if (name && /^#?[0-9a-f]{6}$/i.test(color)) partTypeColors[name] = color.startsWith("#") ? color : `#${color}`;
    }
    const unit = activeUnit();
    // Stored in mm: as the company shows lengths — a plain number only (anything else, as typed).
    const formatStoredLength = (value: string) => (/^-?\d+(\.\d+)?$/.test(value) ? (unit === "mm" ? value : formatLength(value, unit, { withUnit: false })) : value);
    const customer = toStr(project.customer);
    const subtitle = [customer && customer !== "Unknown Customer" ? customer : "", activeDate(new Date())].filter(Boolean).join("  ·  ");
    // The company's part types in their order (their sections come in it), and the project's boards.
    const partTypeOrder = (Array.isArray(companyDoc.partTypes) ? companyDoc.partTypes : [])
      .map((item) => toStr(((item ?? {}) as Record<string, unknown>).name))
      .filter(Boolean);
    const boards = boardsOf(await legacy());
    for (const kind of ["initialMeasure", "production"] as const) {
      if (!sections[kind]) continue;
      const rows = await loadCutlistRows(project, kind, legacy);
      const blob = await buildCutlistPdfBlob({
        title: labelOf(kind),
        projectName: toStr(project.name) || "Project",
        subtitle,
        companyName: toStr(companyDoc.companyName) || toStr(companyDoc.name),
        rows,
        partTypeColors,
        partTypeOrder,
        boards,
        formatLength: formatStoredLength,
        unitLabel: activeUnitLabel(),
      }).catch(() => null);
      if (blob) files.push({ filename: projectCopyFileName(project.name, labelOf(kind)), blob, ext: "pdf" });
      else missing.push(labelOf(kind));
    }
  }

  // Its images — downloaded from Storage (never from the Preview: nothing in it is real), email-sized, in order, while
  // they fit.
  if (sections.images) {
    const storageClient = isPreviewMode() ? null : storage;
    const images = storageClient ? await loadImages(project, legacy) : [];
    let total = files.reduce((sum, file) => sum + file.blob.size, 0);
    let attached = 0;
    let tooBig = 0;
    for (const [index, image] of images.entries()) {
      if (!storageClient) break;
      try {
        const sized = await emailSizedImage(await getBlob(storageRef(storageClient, image.source.replace(/^\/+/, ""))));
        if (total + sized.blob.size > MAX_ATTACHMENTS_BYTES) {
          tooBig += 1;
          continue;
        }
        total += sized.blob.size;
        attached += 1;
        const base = image.name.replace(/\.[a-z0-9]{2,5}$/i, "").trim() || `Image ${index + 1}`;
        files.push({ filename: projectCopyFileName(project.name, base, sized.ext), blob: sized.blob, ext: sized.ext });
      } catch {
        // couldn't be read — left out
      }
    }
    if (!attached) missing.push(labelOf("images"));
    else if (tooBig) missing.push(`${tooBig} more image${tooBig === 1 ? "" : "s"} (too big to fit)`);
  }
  return { files, missing };
}

// Makes its copy and emails it to these staff (by uid). Nothing's deleted here — the caller deletes it once this is ok.
export async function sendProjectCopyEmail({
  project,
  sections,
  recipientUids,
}: {
  project: Project;
  sections: ProjectCopySections;
  recipientUids: string[];
}): Promise<ProjectCopyResult> {
  const companyId = toStr(project.companyId);
  if (!companyId || !project.id) return { ok: false, error: "missing-project" };
  if (!recipientUids.length) return { ok: false, error: "no-recipients" };
  let built: Awaited<ReturnType<typeof buildProjectCopyFiles>>;
  try {
    built = await buildProjectCopyFiles(project, sections);
  } catch {
    return { ok: false, error: "build-failed" };
  }
  if (isPreviewMode()) return { ok: true, preview: true };
  const storageClient = storage;
  if (!storageClient) return { ok: false, error: "no-storage" };

  // Up into its own folder, for the server to attach.
  const stamp = Date.now();
  const uploaded: Array<{ ref: StorageReference; filename: string }> = [];
  try {
    for (const [index, file] of built.files.entries()) {
      const ref = storageRef(storageClient, `companies/${companyId}/jobs/${project.id}/email-copy/${stamp}_${index + 1}.${file.ext}`);
      await uploadBytes(ref, file.blob, { contentType: file.blob.type || (file.ext === "pdf" ? "application/pdf" : "application/octet-stream") });
      uploaded.push({ ref, filename: file.filename });
    }
    const response = await authorizedFetch("/api/projects/email-copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        projectId: project.id,
        projectName: toStr(project.name) || "Project",
        recipientUids,
        clientDetails: sections.clientDetails ? clientDetailsOf(project) : [],
        attachments: uploaded.map((file) => ({ path: file.ref.fullPath, filename: file.filename })),
        missing: built.missing,
        deletedOnLabel: activeDate(new Date()),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return response.ok && result.ok ? { ok: true } : { ok: false, error: toStr(result.error) || `http-${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "send-failed" };
  } finally {
    // They were only there for the email.
    await Promise.all(uploaded.map((file) => deleteObject(file.ref).catch(() => undefined)));
  }
}
