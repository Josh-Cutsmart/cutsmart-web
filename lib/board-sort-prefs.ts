import { doc, FieldPath, getDoc, setDoc } from "@/lib/firestore-client";
import { db } from "@/lib/firebase";
import { normalizeBoardColumnSorts, normalizeBoardSortMode, type BoardSortMode } from "@/lib/board-drop-order";

// Each user's sort choices for the Kanban boards (components/board-sort-menu.tsx), saved on their own
// profile doc (users/{uid}, which only they can read or write) so they follow them to any device —
// under boardSortPrefs.<board>.<companyId>, as each company has its own columns.

export type BoardSortBoard = "leads" | "dashboard";
export type BoardSortPrefs = { columnSorts: Record<string, BoardSortMode>; boardSort: BoardSortMode };

// null when nothing's been saved yet (or it can't be read right now).
export async function readBoardSortPrefs(uid: string, board: BoardSortBoard, companyId: string): Promise<BoardSortPrefs | null> {
  if (!db || !uid || !companyId) return null;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const all = (snap.data()?.boardSortPrefs ?? null) as Record<string, Record<string, unknown>> | null;
    const saved = all?.[board]?.[companyId];
    if (!saved || typeof saved !== "object") return null;
    const row = saved as Record<string, unknown>;
    return { columnSorts: normalizeBoardColumnSorts(row.columnSorts), boardSort: normalizeBoardSortMode(row.boardSort) };
  } catch {
    return null;
  }
}

export async function saveBoardSortPrefs(uid: string, board: BoardSortBoard, companyId: string, prefs: BoardSortPrefs): Promise<boolean> {
  if (!db || !uid || !companyId) return false;
  try {
    // mergeFields replaces just this board+company entry (so a column set back to Custom order really
    // goes) and leaves everything else on the profile alone.
    await setDoc(
      doc(db, "users", uid),
      { boardSortPrefs: { [board]: { [companyId]: { columnSorts: prefs.columnSorts, boardSort: prefs.boardSort } } } },
      { mergeFields: [new FieldPath("boardSortPrefs", board, companyId)] },
    );
    return true;
  } catch {
    return false;
  }
}
