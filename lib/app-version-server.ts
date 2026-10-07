import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { listCompanyMemberAccess } from "@/lib/api-company-access";
import { readPublicTextFile } from "@/lib/public-file-server";
import { addNotificationAndPush } from "@/lib/push-server";
import { parseUpdateNotesText, type WhatsNewHighlight } from "@/lib/update-notes-utils";

// Publishing a new version — only ever when a Dev user says so (the What's New page's Publish, now or at a
// set date and time). Deploying never publishes anything by itself: a version in public/update-notes.txt
// that isn't in the changelog yet is a draft only Dev users see.
//
// Publishing (publishVersionNow):
// 1. If it's a staged Vercel deploy (built, but not the live site yet), it's made the live site — Vercel's
//    promote, with VERCEL_API_TOKEN (and VERCEL_TEAM_ID for a team's project). So the code goes live then
//    too, not when it was deployed.
// 2. It's added to the changelog (Application/changelog/versions) — the What's New page then shows it to
//    everyone the next time they open CutSmart.
// 3. If "Notify everyone" was ticked, every member of every company gets a "New version" notification,
//    pushed to their phones/computers — each company once (appVersionAnnouncements/{version}, server-only;
//    the scheduled job finishes anything that didn't get through).
//
// A scheduled publish (appVersionPublishes/{version}, server-only) keeps what's to be published — the
// notes, which deploy to make live, whether to notify — and the scheduled job (every minute) runs it once
// its time comes.

export type PublishContent = { version: string; whatsNew: string; highlights: WhatsNewHighlight[] };
export type PublishResult = { ok: boolean; error?: string; version: string; promoted?: boolean; companies?: number; notified?: number };

const ANNOUNCEMENTS_COLLECTION = "appVersionAnnouncements";
const SCHEDULES_COLLECTION = "appVersionPublishes";

function changelogVersionsCollection() {
  return adminDb!.collection("Application").doc("changelog").collection("versions");
}

const versionIdOf = (version: string) => version.trim().toLowerCase();

// The version and notes this deploy carries (its own public/update-notes.txt).
export async function readDeployedNotes(siteOrigin: string): Promise<PublishContent> {
  const { version, whatsNew, highlights } = parseUpdateNotesText(await readPublicTextFile("update-notes.txt", siteOrigin));
  return { version, whatsNew, highlights };
}

export async function isVersionPublished(version: string): Promise<boolean> {
  if (!adminDb || !version) return false;
  return (await changelogVersionsCollection().doc(versionIdOf(version)).get()).exists;
}

// ---- Vercel: which deploy this is, and making a deploy the live site.

export type DeployState = {
  // Running on Vercel (not a local dev server).
  onVercel: boolean;
  // This deploy is the live site.
  isLive: boolean;
  // The deploy publishing would make live (a staged production deploy), if any.
  deploymentId: string;
  // Making it live is set up (VERCEL_API_TOKEN).
  canPromote: boolean;
  // Why it can't be published from here, if it can't.
  blockedReason: string;
};

function hostOf(value: string): string {
  return value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/:\d+$/, "").toLowerCase();
}

export function deployStateFor(requestHost: string): DeployState {
  const onVercel = Boolean(process.env.VERCEL);
  const token = String(process.env.VERCEL_API_TOKEN || "").trim();
  if (!onVercel) {
    return {
      onVercel,
      isLive: false,
      deploymentId: "",
      canPromote: false,
      blockedReason: "Publishing is off on a local server — publish from the website.",
    };
  }
  const host = hostOf(requestHost);
  const productionHost = hostOf(String(process.env.VERCEL_PROJECT_PRODUCTION_URL || ""));
  const isLive = Boolean(productionHost) && (host === productionHost || host === `www.${productionHost}` || `www.${host}` === productionHost);
  if (isLive) return { onVercel, isLive, deploymentId: "", canPromote: Boolean(token), blockedReason: "" };
  const env = String(process.env.VERCEL_ENV || "");
  const deploymentId = String(process.env.VERCEL_DEPLOYMENT_ID || "").trim();
  let blockedReason = "";
  if (env !== "production") blockedReason = "This is a preview deploy — push it to the main branch to stage it for the live site, then publish it.";
  else if (!deploymentId) blockedReason = "Vercel didn't say which deploy this is — turn on System Environment Variables in the project's settings.";
  else if (!token) blockedReason = "Publishing can't make this deploy live yet — add a VERCEL_API_TOKEN environment variable in Vercel (or promote it in Vercel first, then publish from the live site).";
  return { onVercel, isLive, deploymentId: env === "production" ? deploymentId : "", canPromote: Boolean(token), blockedReason };
}

async function promoteDeployment(deploymentId: string): Promise<{ ok: boolean; error?: string }> {
  const token = String(process.env.VERCEL_API_TOKEN || "").trim();
  const projectId = String(process.env.VERCEL_PROJECT_ID || "").trim();
  if (!token || !projectId) return { ok: false, error: "vercel-not-configured" };
  const teamId = String(process.env.VERCEL_TEAM_ID || "").trim();
  const url = `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deploymentId)}${
    teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""
  }`;
  try {
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, error: body?.error?.message || `vercel-${response.status}` };
  } catch {
    return { ok: false, error: "vercel-unreachable" };
  }
}

// ---- Publishing

export async function publishVersionNow(options: {
  content: PublishContent;
  notify: boolean;
  publishedByUid: string;
  siteOrigin: string;
  // A staged deploy to make the live site first (none when it's already live).
  deploymentId?: string;
}): Promise<PublishResult> {
  const { content, notify, publishedByUid, siteOrigin, deploymentId } = options;
  const version = content.version;
  if (!adminDb) return { ok: false, error: "no-database", version };
  if (!version) return { ok: false, error: "no-version", version };
  const db = adminDb;
  const id = versionIdOf(version);
  const entryRef = changelogVersionsCollection().doc(id);
  if ((await entryRef.get()).exists) return { ok: false, error: "already-published", version };

  // The code first: if it can't go live, nothing is announced.
  let promoted = false;
  if (deploymentId) {
    const promotion = await promoteDeployment(deploymentId);
    if (!promotion.ok) return { ok: false, error: promotion.error || "promote-failed", version };
    promoted = true;
  }

  const recordRef = db.collection(ANNOUNCEMENTS_COLLECTION).doc(id);
  const created = await db.runTransaction(async (tx) => {
    if ((await tx.get(entryRef)).exists) return false;
    const nowIso = new Date().toISOString();
    tx.set(entryRef, {
      id,
      version,
      whatsNew: content.whatsNew,
      highlights: content.highlights,
      capturedAtIso: nowIso,
      publishedAtIso: nowIso,
      publishedByUid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtIso: nowIso,
    });
    tx.set(recordRef, {
      version,
      notify,
      pending: notify,
      createdAtIso: nowIso,
      companies: {},
      ...(notify ? {} : { doneAtIso: nowIso }),
    });
    return true;
  });
  if (!created) return { ok: false, error: "already-published", version, promoted };
  // Anything scheduled for it is done with.
  await db.collection(SCHEDULES_COLLECTION).doc(id).set({ status: "published", publishedAtIso: new Date().toISOString() }, { merge: true }).catch(() => undefined);
  if (!notify) return { ok: true, version, promoted, companies: 0, notified: 0 };
  const announced = await announceToCompanies(recordRef, version, content.whatsNew, siteOrigin);
  return { ok: true, version, promoted, ...announced };
}

// Tells every company that hasn't been told yet — claimed one at a time, so each is told once even if the
// scheduled job and a publish are both at it.
async function announceToCompanies(
  recordRef: FirebaseFirestore.DocumentReference,
  version: string,
  whatsNew: string,
  siteOrigin: string,
): Promise<{ companies: number; notified: number }> {
  const db = adminDb!;
  const companyIds = (await db.collection("companies").select().get()).docs.map((docSnap) => docSnap.id);
  let companies = 0;
  let notified = 0;
  for (const companyId of companyIds) {
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
          { title: `New version ${version}`, message: whatsNew || "CutSmart has been updated.", type: "app_version", companyId },
          siteOrigin,
        ),
      ),
    );
    notified += uids.length;
  }
  await recordRef.set({ pending: false, doneAtIso: new Date().toISOString() }, { merge: true });
  return { companies, notified };
}

// ---- Scheduling

export type PublishSchedule = { scheduledForIso: string; notify: boolean; status: string; error?: string } | null;

export async function readPublishSchedule(version: string): Promise<PublishSchedule> {
  if (!adminDb || !version) return null;
  const snap = await adminDb.collection(SCHEDULES_COLLECTION).doc(versionIdOf(version)).get();
  const data = snap.data();
  if (!data) return null;
  return {
    scheduledForIso: String(data.scheduledForIso || ""),
    notify: Boolean(data.notify),
    status: String(data.status || ""),
    error: data.error ? String(data.error) : undefined,
  };
}

export async function schedulePublish(options: {
  content: PublishContent;
  notify: boolean;
  scheduledForIso: string;
  scheduledByUid: string;
  deploymentId?: string;
}): Promise<void> {
  const { content, notify, scheduledForIso, scheduledByUid, deploymentId } = options;
  const db = adminDb!;
  // Only the newest version waits to be published: an older one still scheduled is replaced (it would make
  // an older deploy live).
  const waiting = await db.collection(SCHEDULES_COLLECTION).where("status", "==", "scheduled").get();
  await Promise.all(
    waiting.docs
      .filter((docSnap) => docSnap.id !== versionIdOf(content.version))
      .map((docSnap) => docSnap.ref.set({ status: "replaced", replacedBy: content.version }, { merge: true })),
  );
  await db
    .collection(SCHEDULES_COLLECTION)
    .doc(versionIdOf(content.version))
    .set({
      version: content.version,
      whatsNew: content.whatsNew,
      highlights: content.highlights,
      notify,
      scheduledForIso,
      scheduledByUid,
      deploymentId: deploymentId || "",
      status: "scheduled",
      createdAtIso: new Date().toISOString(),
    });
}

export async function cancelScheduledPublish(version: string): Promise<void> {
  await adminDb!.collection(SCHEDULES_COLLECTION).doc(versionIdOf(version)).delete();
}

// ---- The scheduled job (app/api/cron/notifications, every minute)

export async function runAppVersionJobs(siteOrigin: string): Promise<{ published: string[]; failed: string[]; announced: number }> {
  const result = { published: [] as string[], failed: [] as string[], announced: 0 };
  if (!adminDb) return result;
  const db = adminDb;
  const nowIso = new Date().toISOString();

  // Scheduled publishes whose time has come.
  const due = await db.collection(SCHEDULES_COLLECTION).where("status", "==", "scheduled").get();
  for (const docSnap of due.docs) {
    const data = docSnap.data();
    if (String(data.scheduledForIso || "") > nowIso) continue;
    // Claimed, so two runs can't both publish it.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(docSnap.ref);
      if (fresh.data()?.status !== "scheduled") return false;
      tx.update(docSnap.ref, { status: "publishing", startedAtIso: new Date().toISOString() });
      return true;
    });
    if (!claimed) continue;
    const content: PublishContent = {
      version: String(data.version || ""),
      whatsNew: String(data.whatsNew || ""),
      highlights: Array.isArray(data.highlights) ? (data.highlights as WhatsNewHighlight[]) : [],
    };
    const published = await publishVersionNow({
      content,
      notify: Boolean(data.notify),
      publishedByUid: String(data.scheduledByUid || ""),
      siteOrigin,
      deploymentId: String(data.deploymentId || "") || undefined,
    });
    if (published.ok || published.error === "already-published") {
      result.published.push(content.version);
      await docSnap.ref.set({ status: "published", publishedAtIso: new Date().toISOString() }, { merge: true });
    } else {
      result.failed.push(content.version);
      await docSnap.ref.set({ status: "failed", error: published.error || "failed" }, { merge: true });
    }
  }

  // Announcements that didn't finish (a publish that ran out of time).
  const pending = await db.collection(ANNOUNCEMENTS_COLLECTION).where("pending", "==", true).limit(3).get();
  for (const recordSnap of pending.docs) {
    const version = String(recordSnap.data().version || "");
    const entry = await changelogVersionsCollection().doc(versionIdOf(version)).get();
    const announced = await announceToCompanies(recordSnap.ref, version, String(entry.data()?.whatsNew || ""), siteOrigin);
    result.announced += announced.notified;
  }
  return result;
}
