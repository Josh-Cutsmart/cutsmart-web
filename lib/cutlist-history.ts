"use client";

import { deleteField, doc, getDoc, updateDoc, writeBatch } from "@/lib/firestore-client";
import { resolveProjectDocRef } from "@/lib/firestore-data";
import type { Project } from "@/lib/types";
import type { CutlistDataKind } from "@/lib/use-project-cutlist";

// A cutlist row's History (the Cutlist List's right-click menu): each time someone changes a row, the row as it was just
// before — every field — with when, and who. Kept beside the cutlist, one small doc per row (cutlistData/{kind}History_{row
// id} — open to the project's company in firestore.rules, as the cutlist and its presence doc are), so a long-lived
// cutlist never grows its own doc. Each change is its own entry in the doc's `entries` (added without reading it first);
// past the newest MAX_ENTRIES, the oldest are cleared out as it's read.

export type CutlistHistoryEntry = { id: string; at: string; by: string; row: Record<string, unknown> };

const MAX_ENTRIES = 40;

async function historyDocRef(project: Project, kind: CutlistDataKind, rowId: string) {
  const projectRef = await resolveProjectDocRef(project);
  return projectRef ? doc(projectRef, "cutlistData", `${kind}History_${rowId}`) : null;
}

// Rows as they were before a save changed them (plain data: no undefined values, no arrays of arrays), stamped now.
export async function addCutlistRowHistory(
  project: Project,
  kind: CutlistDataKind,
  rows: Array<{ rowId: string; row: Record<string, unknown> }>,
  by: string,
): Promise<void> {
  if (!rows.length) return;
  const projectRef = await resolveProjectDocRef(project);
  if (!projectRef) return;
  const at = new Date().toISOString();
  try {
    const batch = writeBatch(projectRef.firestore);
    rows.forEach(({ rowId, row }, index) => {
      const id = `${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`;
      batch.set(doc(projectRef, "cutlistData", `${kind}History_${rowId}`), { rowId, kind, entries: { [id]: { at, by, row } } }, { merge: true });
    });
    await batch.commit();
  } catch (error) {
    // (Not kept — the cutlist itself is saved; said in the console so it's not lost without a word.)
    console.warn("Couldn't keep the cutlist row history", error);
  }
}

// A row's history, newest first.
export async function fetchCutlistRowHistory(project: Project, kind: CutlistDataKind, rowId: string): Promise<CutlistHistoryEntry[]> {
  const ref = await historyDocRef(project, kind, rowId);
  if (!ref) return [];
  const snap = await getDoc(ref).catch((error) => {
    console.warn("Couldn't read the cutlist row history", error);
    return null;
  });
  const raw = (snap?.exists() ? (snap.data()?.entries as Record<string, unknown> | undefined) : undefined) ?? {};
  const entries = Object.entries(raw)
    .map(([id, value]) => {
      const entry = (value ?? {}) as { at?: unknown; by?: unknown; row?: unknown };
      return {
        id,
        at: String(entry.at ?? ""),
        by: String(entry.by ?? "").trim(),
        row: entry.row && typeof entry.row === "object" ? (entry.row as Record<string, unknown>) : {},
      };
    })
    .filter((entry) => entry.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id.localeCompare(a.id)));
  if (entries.length > MAX_ENTRIES) {
    const stale = entries.slice(MAX_ENTRIES);
    void updateDoc(ref, Object.fromEntries(stale.map((entry) => [`entries.${entry.id}`, deleteField()]))).catch(() => undefined);
  }
  return entries.slice(0, MAX_ENTRIES);
}
