import type { Firestore } from "firebase-admin/firestore";
import { COLUMN_AUTOMATION_RUNS_COLLECTION, columnAutomationRunFor, type ColumnAutomation, type ColumnAutomationRunFields, type ColumnAutomationTrigger } from "@/lib/column-automations";

// A column automation's run, noted for Company Settings' Automations log, from the server's side (the app's own:
// logColumnAutomationRun, lib/firestore-data.ts). Never gets in the way of what it's noting: if it can't be written, the
// automation's still done.
export async function recordColumnAutomationRun(
  db: Firestore,
  companyId: string,
  automation: ColumnAutomation,
  item: { id: string; name: string },
  event: ColumnAutomationTrigger,
  fields: ColumnAutomationRunFields,
): Promise<void> {
  try {
    await db.collection("companies").doc(companyId).collection(COLUMN_AUTOMATION_RUNS_COLLECTION).add(columnAutomationRunFor(automation, item, event, fields));
  } catch (error) {
    console.warn("[column-automations] couldn't note a run:", error);
  }
}
