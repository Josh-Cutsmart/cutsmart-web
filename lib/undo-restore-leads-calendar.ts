// What the Undo bar (components/undo-bar.tsx) puts back on the Calendar page, where the delete itself keeps nothing: a
// calendar event's whole Firestore doc, read just before it's deleted — everything it had (its subscribers, when it
// was added and by whom, anything the reminders job marked on it), not only what the calendar shows of it — and
// written back under the same id, so it comes back exactly as it was.

import { deleteDoc, doc, getDoc, setDoc } from "@/lib/firestore-client";
import { db } from "@/lib/firebase";

export type SavedCalendarEventDoc = { companyId: string; eventId: string; data: Record<string, unknown> };

// Deletes an event (as deleteCalendarEvent does), handing back what its doc held. saved is null when it couldn't be
// read first — it's deleted all the same, and Undo puts back what the calendar had of it instead.
export async function deleteCalendarEventKeepingCopy(
  companyId: string,
  eventId: string,
): Promise<{ ok: boolean; saved: SavedCalendarEventDoc | null }> {
  const cid = String(companyId || "").trim();
  const id = String(eventId || "").trim();
  if (!db || !cid || !id) return { ok: false, saved: null };
  const ref = doc(db, "companies", cid, "calendarEvents", id);
  let saved: SavedCalendarEventDoc | null = null;
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) saved = { companyId: cid, eventId: id, data: (snap.data() ?? {}) as Record<string, unknown> };
  } catch {
    // couldn't read it — deleted without a copy
  }
  try {
    await deleteDoc(ref);
    return { ok: true, saved };
  } catch {
    return { ok: false, saved: null };
  }
}

// The event back, as it was: the same doc, the same id (the calendar's live list brings it straight back).
export async function restoreCalendarEventDoc(saved: SavedCalendarEventDoc): Promise<boolean> {
  if (!db) return false;
  try {
    await setDoc(doc(db, "companies", saved.companyId, "calendarEvents", saved.eventId), saved.data);
    return true;
  } catch {
    return false;
  }
}
