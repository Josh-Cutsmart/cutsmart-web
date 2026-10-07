import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { listCompanyMemberAccess } from "@/lib/api-company-access";
import { readPublicTextFile } from "@/lib/public-file-server";
import { addNotificationAndPush } from "@/lib/push-server";
import { parseUpdateNotesText } from "@/lib/update-notes-utils";

// A new version (public/update-notes.txt, once it's live) reaches everyone without anyone having to open
// CutSmart: the scheduled job (app/api/cron/notifications, every minute) adds it to the changelog and gives
// every member of every company a "New version" notification — pushed to their phones/computers too. An
// app that opens it before the job has run asks for the same for its own company
// (app/api/app-version/announce). Either way each company is told once: appVersionAnnouncements/{version}
// (server-only) records which have been, and when every company has (doneAtIso), so the job then only
// reads that one doc a minute until the next version.

const ANNOUNCEMENTS_COLLECTION = "appVersionAnnouncements";
// Versions added to the changelog before this were announced the old way — by whichever app opened them
// first, to its own company — so they're not announced again.
const ANNOUNCED_BY_SERVER_SINCE_ISO = "2026-10-07T00:00:00.000Z";

export type AppVersionAnnounceResult = { version: string; companies: number; notified: number; skipped?: string };

function changelogVersionsCollection() {
  return adminDb!.collection("Application").doc("changelog").collection("versions");
}

// onlyCompanyId: just that company (an app that opened the new version); otherwise every company.
export async function announceCurrentAppVersion(siteOrigin: string, onlyCompanyId?: string): Promise<AppVersionAnnounceResult> {
  const empty = { version: "", companies: 0, notified: 0 };
  if (!adminDb) return { ...empty, skipped: "no-database" };
  const db = adminDb;
  const { version, whatsNew } = parseUpdateNotesText(await readPublicTextFile("update-notes.txt", siteOrigin));
  if (!version) return { ...empty, skipped: "no-version" };
  const versionId = version.toLowerCase();
  const recordRef = db.collection(ANNOUNCEMENTS_COLLECTION).doc(versionId);

  // Usually all that's read: already told everyone (or it's an old version).
  const recordSnap = await recordRef.get();
  const record = recordSnap.data();
  if (record?.legacy) return { ...empty, version, skipped: "announced-before" };
  if (record?.doneAtIso && !onlyCompanyId) return { ...empty, version, skipped: "done" };

  // In the changelog (as the app would add it), and the record started — together, once.
  const entryRef = changelogVersionsCollection().doc(versionId);
  const started = await db.runTransaction(async (tx) => {
    const [entry, existingRecord] = await Promise.all([tx.get(entryRef), tx.get(recordRef)]);
    const nowIso = new Date().toISOString();
    if (!entry.exists) {
      tx.set(entryRef, {
        id: versionId,
        version,
        whatsNew,
        capturedAtIso: nowIso,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: nowIso,
      });
    }
    const capturedAtIso = entry.exists ? String(entry.data()?.capturedAtIso || "") : nowIso;
    const legacy = existingRecord.exists ? Boolean(existingRecord.data()?.legacy) : Boolean(capturedAtIso) && capturedAtIso < ANNOUNCED_BY_SERVER_SINCE_ISO;
    if (!existingRecord.exists) tx.set(recordRef, { version, createdAtIso: nowIso, legacy, companies: {} });
    // The changelog's own text (it can be edited there) is what everyone's told.
    return { legacy, whatsNew: entry.exists ? String(entry.data()?.whatsNew ?? whatsNew) : whatsNew };
  });
  if (started.legacy) return { ...empty, version, skipped: "announced-before" };

  const companyIds = onlyCompanyId
    ? [onlyCompanyId]
    : (await db.collection("companies").select().get()).docs.map((docSnap) => docSnap.id);
  let companies = 0;
  let notified = 0;
  for (const companyId of companyIds) {
    // Claimed first, so a company is only ever told once (the job and an app may both try).
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(recordRef);
      const told = (snap.data()?.companies ?? {}) as Record<string, unknown>;
      if (told[companyId]) return false;
      tx.update(recordRef, new FieldPath("companies", companyId), new Date().toISOString());
      return true;
    });
    if (!claimed) continue;
    companies += 1;
    const members = await listCompanyMemberAccess(companyId).catch(() => []);
    const uids = Array.from(new Set(members.map((member) => member.access.uid).filter(Boolean)));
    await Promise.all(
      uids.map((uid) =>
        addNotificationAndPush(
          uid,
          { title: `New version ${version}`, message: started.whatsNew || "CutSmart has been updated.", type: "app_version", companyId },
          siteOrigin,
        ),
      ),
    );
    notified += uids.length;
  }
  if (!onlyCompanyId) await recordRef.set({ doneAtIso: new Date().toISOString() }, { merge: true });
  return { version, companies, notified };
}
