import type { CompanyLeadRow, LeadImageItem, LeadNote } from "@/lib/firestore-data";
import type { ProjectChecklist } from "@/lib/types";

// A lead as the app works with it, from its Firestore document (companies/{companyId}/leads/{leadId}) — shared by
// /api/leads (server) and the Leads page's own direct reads (lib/firestore-data.ts), so the two always agree.
// "summary": what the board and list need (no message or photo comments); "detail": all of it, for its pop-up.

function toStr(value: unknown) {
  return String(value ?? "").trim();
}

// A date as an ISO string, from a string, a Firestore Timestamp (client or admin — anything with toDate) or a Date.
export function leadIsoString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return fallback;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
  }
  if (value && typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
    try {
      const parsed = (value as { toDate: () => Date }).toDate();
      return parsed.toISOString();
    } catch {
      return fallback;
    }
  }
  if (value instanceof Date) return value.toISOString();
  return fallback;
}

// A lead's photos (at most 10), each with its comment pins.
export function normalizeStoredLeadImageItems(value: unknown): LeadImageItem[] {
  if (!Array.isArray(value)) return [];
  const items: LeadImageItem[] = [];
  for (const item of value) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const url = toStr(row?.url);
    const name = toStr(row?.name);
    const annotations: NonNullable<LeadImageItem["annotations"]> = [];
    if (Array.isArray(row?.annotations)) {
      for (const annotation of row.annotations) {
        const next = annotation && typeof annotation === "object" ? (annotation as Record<string, unknown>) : null;
        const id = toStr(next?.id);
        const note = toStr(next?.note);
        const x = Number(next?.x);
        const y = Number(next?.y);
        const xPx = Number(next?.xPx);
        const yPx = Number(next?.yPx);
        if (!id || !note || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        annotations.push({
          id,
          note,
          x: Math.min(100, Math.max(0, x)),
          y: Math.min(100, Math.max(0, y)),
          xPx: Number.isFinite(xPx) ? Math.max(0, xPx) : undefined,
          yPx: Number.isFinite(yPx) ? Math.max(0, yPx) : undefined,
          createdByName: toStr(next?.createdByName),
          createdByColor: toStr(next?.createdByColor),
        });
      }
    }
    if (!url) continue;
    items.push({ url, name, annotations });
    if (items.length >= 10) break;
  }
  return items;
}

// Its notes (the lead pop-up's Notes), oldest first — the last 200, each with its text.
export const LEAD_NOTES_MAX = 200;
export function normalizeLeadNotes(value: unknown): LeadNote[] {
  if (!Array.isArray(value)) return [];
  const notes: LeadNote[] = [];
  for (const item of value) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const id = toStr(row?.id);
    const text = toStr(row?.text);
    if (!id || !text) continue;
    notes.push({
      id,
      text,
      createdAtIso: leadIsoString(row?.createdAtIso, ""),
      createdByUid: toStr(row?.createdByUid),
      createdByName: toStr(row?.createdByName),
    });
  }
  return notes.slice(-LEAD_NOTES_MAX);
}

// Its checklists (the lead pop-up's Checklists), in the order they were added — at most 20, of 100 items each.
export const LEAD_CHECKLISTS_MAX = 20;
export function normalizeLeadChecklists(value: unknown): ProjectChecklist[] {
  if (!Array.isArray(value)) return [];
  const checklists: ProjectChecklist[] = [];
  for (const item of value) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const id = toStr(row?.id).slice(0, 120);
    if (!id) continue;
    const items: ProjectChecklist["items"] = [];
    for (const entry of Array.isArray(row?.items) ? row.items : []) {
      const next = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
      const itemId = toStr(next?.id).slice(0, 120);
      const text = toStr(next?.text).slice(0, 500);
      if (!itemId || !text) continue;
      items.push({ id: itemId, text, checked: next?.checked === true });
      if (items.length >= 100) break;
    }
    checklists.push({
      id,
      name: toStr(row?.name).slice(0, 120) || "Checklist",
      items,
      addedAt: toStr(row?.addedAt) || undefined,
    });
    if (checklists.length >= LEAD_CHECKLISTS_MAX) break;
  }
  return checklists;
}

export function buildLeadRow(
  companyId: string,
  docId: string,
  data: Record<string, unknown>,
  mode: "summary" | "detail" = "detail",
): CompanyLeadRow {
  const imageItems = mode === "detail" ? normalizeStoredLeadImageItems(data.imageItems) : [];
  const summaryImageUrls = Array.isArray(data.imageUrls)
    ? data.imageUrls.map(String).filter(Boolean)
    : Array.isArray(data.imageItems)
      ? normalizeStoredLeadImageItems(data.imageItems).map((item) => item.url)
      : [];
  return {
    id: String(data.id ?? docId),
    companyId,
    name: toStr(data.name),
    email: toStr(data.email),
    phone: toStr(data.phone),
    message: mode === "detail" ? toStr(data.message) : "",
    formName: toStr(data.formName),
    // A lead from one of the company's own lead forms (lib/lead-forms.ts): which form, and which question each
    // of its answers (rawFields) belongs to.
    formId: toStr(data.formId),
    formFieldKeys:
      data.formFieldKeys && typeof data.formFieldKeys === "object" ? (data.formFieldKeys as Record<string, string>) : undefined,
    // How a lead added by hand came in (Phone call, Walk-in, …).
    sourceDetail: toStr(data.sourceDetail),
    submittedAtIso: leadIsoString(data.submittedAtIso ?? data.submittedAt, ""),
    createdAtIso: leadIsoString(data.createdAtIso ?? data.createdAt, ""),
    updatedAtIso: leadIsoString(data.updatedAtIso ?? data.updatedAt, ""),
    deletedAtIso: leadIsoString(data.deletedAtIso ?? data.deletedAt, ""),
    isDeleted: Boolean(data.isDeleted),
    source: toStr(data.source) || "zapier-form",
    status: toStr(data.status) || "New",
    assignedToUid: toStr(data.assignedToUid),
    assignedToName: toStr(data.assignedToName || data.assignedTo),
    assignedTo: toStr(data.assignedTo || data.assignedToName),
    imageItems,
    imageUrls:
      mode === "detail"
        ? imageItems.length
          ? imageItems.map((item) => item.url)
          : Array.isArray(data.imageUrls)
            ? data.imageUrls.map(String).filter(Boolean)
            : []
        : summaryImageUrls,
    rawFields: data.rawFields && typeof data.rawFields === "object" ? (data.rawFields as Record<string, unknown>) : undefined,
    boardOrder: typeof data.boardOrder === "number" && Number.isFinite(data.boardOrder) ? data.boardOrder : undefined,
    // In the summary too (they're short), so the pop-up's notes stay up to date as the list does.
    notes: normalizeLeadNotes(data.notes),
    checklists: normalizeLeadChecklists(data.checklists),
  };
}
