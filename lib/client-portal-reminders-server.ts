import { FieldPath } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { normalizeClientPortalReminderDays } from "@/lib/push-notification-types";
import { projectNotifySubscriberUids } from "@/lib/project-notify";
import { addNotificationAndPush, isCompanyMemberUid } from "@/lib/push-server";
import { getProjectDocRefAdmin, isShareLinkInactiveAdmin, type SpecsShareLinkDoc } from "@/lib/specs-share";

// "The quote for Kitchen Reno still hasn't been accepted — sent 2 days ago." A quote or specifications
// sent to a client (specsShareLinks/{projectId}) and still not accepted/declined/submitted reminds the
// person who sent it and the project's followers (the same people told when the client answers) —
// after as many days as each of them chose (User Settings > Phone & Desktop Notifications > Client
// Portal: users/{uid}.clientPortalReminderDays, 2 days each until changed). Run by the notifications
// scheduled job (app/api/cron/notifications) and, as a backup, by any open app.
//
// Each person's each "after N days" is sent once per send: the share doc remembers it
// (pendingRemindersSent.{uid}_{quote|specs}_{N} = the sent time it was for), so a re-send starts over.
// One they've set to repeat goes again every N days (after N, 2N, 3N… days) until the client answers:
// pendingRemindersSent.{uid}_{kind}_{N}_repeat = "<sent time>#<how many N's>" for the last one sent.
// If several are due at once, only one reminder is sent.

const DAY_MS = 24 * 60 * 60 * 1000;

function str(value: unknown): string {
  return String(value ?? "").trim();
}

type Kind = "quote" | "specs";

export type ClientPortalReminderRunResult = { links: number; sent: number };

export async function runClientPortalPendingReminders(options: { siteOrigin: string; companyIds?: string[]; now?: number }): Promise<ClientPortalReminderRunResult> {
  const result: ClientPortalReminderRunResult = { links: 0, sent: 0 };
  if (!adminDb) return result;
  const db = adminDb;
  const now = options.now ?? Date.now();
  const collection = db.collection("specsShareLinks");
  const snaps = options.companyIds?.length
    ? (await Promise.all(options.companyIds.map((cid) => collection.where("companyId", "==", cid).get()))).flatMap((snap) => snap.docs)
    : (await collection.get()).docs;

  const daysByUid = new Map<string, ReturnType<typeof normalizeClientPortalReminderDays>>();
  const daysFor = async (uid: string) => {
    if (!daysByUid.has(uid)) {
      const snap = await db.collection("users").doc(uid).get();
      daysByUid.set(uid, normalizeClientPortalReminderDays(snap.data()?.clientPortalReminderDays));
    }
    return daysByUid.get(uid)!;
  };

  for (const shareSnap of snaps) {
    const share = shareSnap.data() as SpecsShareLinkDoc & Record<string, unknown>;
    // What's sent and still waiting on the client, and when each was sent.
    const waiting: Array<{ kind: Kind; sentAtIso: string }> = [];
    if (share.quoteVersionId && !share.quoteAcceptedAt && !share.quoteDeclinedAt) {
      waiting.push({ kind: "quote", sentAtIso: str(share.quoteSentAt) || str(share.lastSentAt) });
    }
    if (share.versionId && !share.submittedAt) {
      waiting.push({ kind: "specs", sentAtIso: str(share.specsSentAt) || str(share.lastSentAt) });
    }
    const pending = waiting.filter((item) => Number.isFinite(Date.parse(item.sentAtIso)) && now - Date.parse(item.sentAtIso) >= DAY_MS);
    if (!pending.length) continue;
    result.links += 1;

    const companyId = str(share.companyId);
    const projectRef = await getProjectDocRefAdmin(db, str(share.projectId), companyId).catch(() => null);
    const projectSnap = projectRef ? await projectRef.get() : null;
    if (!projectSnap?.exists) continue;
    const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
    // A finished project's link is closed — nothing to chase.
    if (await isShareLinkInactiveAdmin(db, share, projectData)) continue;

    const recipients = new Set<string>(
      projectNotifySubscriberUids({
        assignedToUid: str(projectData.assignedToUid),
        notifySubscriptionOverrides: (projectData.notifySubscriptionOverrides ?? {}) as Record<string, boolean>,
      }),
    );
    if (str(share.sentByUid)) recipients.add(str(share.sentByUid));
    const sentMap = (share.pendingRemindersSent as Record<string, unknown> | undefined) ?? {};
    const projectName = str(projectData.name) || "a project";
    const clientName = str(projectData.customer) || str(share.clientEmail) || "The client";

    for (const { kind, sentAtIso } of pending) {
      const sentMs = Date.parse(sentAtIso);
      const daysSince = Math.floor((now - sentMs) / DAY_MS);
      for (const uid of recipients) {
        const prefs = await daysFor(uid);
        const repeating = kind === "quote" ? prefs.quoteRepeat : prefs.specsRepeat;
        // Each due one as the share-doc field it's remembered under and the value that marks it sent.
        const due = prefs[kind].flatMap((d) => {
          if (repeating.includes(d)) {
            const times = Math.floor((now - sentMs) / (d * DAY_MS));
            const mark = `${sentAtIso}#${times}`;
            return times >= 1 && sentMap[`${uid}_${kind}_${d}_repeat`] !== mark ? [{ field: `${uid}_${kind}_${d}_repeat`, mark }] : [];
          }
          return now >= sentMs + d * DAY_MS && sentMap[`${uid}_${kind}_${d}`] !== sentAtIso ? [{ field: `${uid}_${kind}_${d}`, mark: sentAtIso }] : [];
        });
        if (!due.length) continue;
        if (!(await isCompanyMemberUid(companyId, uid))) continue;
        // Claim them (so two runs at once can't both send), then send one.
        const claimed = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(shareSnap.ref);
          if (!fresh.exists) return false;
          const current = (fresh.data()?.pendingRemindersSent as Record<string, unknown> | undefined) ?? {};
          const stillDue = due.filter((item) => current[item.field] !== item.mark);
          if (!stillDue.length) return false;
          const [first, ...rest] = stillDue;
          tx.update(
            shareSnap.ref,
            new FieldPath("pendingRemindersSent", first.field),
            first.mark,
            ...rest.flatMap((item) => [new FieldPath("pendingRemindersSent", item.field), item.mark]),
          );
          return true;
        });
        if (!claimed) continue;
        const ago = `${daysSince} day${daysSince === 1 ? "" : "s"} ago`;
        await addNotificationAndPush(
          uid,
          kind === "quote"
            ? {
                title: "Quote not accepted yet",
                message: `${clientName} hasn't accepted the quote for ${projectName} yet — sent ${ago}.`,
                type: "quote_pending",
                projectId: str(share.projectId),
                companyId,
              }
            : {
                title: "Specifications not submitted yet",
                message: `${clientName} hasn't submitted the specifications for ${projectName} yet — sent ${ago}.`,
                type: "specs_pending",
                projectId: str(share.projectId),
                companyId,
              },
          options.siteOrigin,
        );
        result.sent += 1;
      }
    }
  }
  return result;
}
