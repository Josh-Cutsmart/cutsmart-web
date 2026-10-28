// Putting things back for the Undo bar (components/undo-bar.tsx) — the few deletes whose own lib has nothing to undo
// them with. Each one writes back exactly what its delete took away; like those deletes, best-effort: false (or null)
// when it couldn't (the bar's already gone by then, so there's nothing more to say).

import { doc, getDoc, setDoc, updateDoc } from "@/lib/firestore-client";
import { db } from "@/lib/firebase";

// A project taken off the Dashboard's Completed list (removeCompletedProjectRecord, lib/completed-projects.ts): its
// record's removed stamp cleared, so it's on the list again (and locks the project's status again).
export async function restoreCompletedProjectRecord(companyId: string, projectId: string): Promise<boolean> {
  const cid = String(companyId || "").trim();
  if (!db || !cid || !projectId) return false;
  try {
    await updateDoc(doc(db, "companies", cid, "completedProjects", projectId), { removedAtIso: "", removedByName: "" });
    return true;
  } catch {
    return false;
  }
}

// A notification cleared from the top bar's Notifications (deleteUserNotification, lib/firestore-data.ts): its doc read
// just before it goes, so it can be written back exactly as it was — the same id, every field (its server timestamp
// too), not just what the list shows of it.
export async function readUserNotificationDoc(uid: string, notificationId: string): Promise<Record<string, unknown> | null> {
  const userId = String(uid || "").trim();
  const id = String(notificationId || "").trim();
  if (!db || !userId || !id) return null;
  try {
    const snap = await getDoc(doc(db, "users", userId, "notifications", id));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function restoreUserNotificationDoc(uid: string, notificationId: string, data: Record<string, unknown>): Promise<boolean> {
  const userId = String(uid || "").trim();
  const id = String(notificationId || "").trim();
  if (!db || !userId || !id) return false;
  try {
    await setDoc(doc(db, "users", userId, "notifications", id), data);
    return true;
  } catch {
    return false;
  }
}
