// Pure helpers for the per-project notification subscription model — no Firestore SDK
// dependency, so this is safe to import from both client components and Admin-SDK API routes.

type NotifySubscribableProject = {
  assignedToUid?: string | null;
  notifySubscriptionOverrides?: Record<string, boolean> | null;
};

export function isProjectNotifySubscribed(project: NotifySubscribableProject, uid: string): boolean {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) return false;
  const overrides = project.notifySubscriptionOverrides ?? {};
  if (cleanUid in overrides) return Boolean(overrides[cleanUid]);
  return String(project.assignedToUid || "").trim() === cleanUid;
}

export function projectNotifySubscriberUids(project: NotifySubscribableProject): string[] {
  const overrides = project.notifySubscriptionOverrides ?? {};
  const out = new Set<string>();
  const assignedUid = String(project.assignedToUid || "").trim();
  if (assignedUid && overrides[assignedUid] !== false) out.add(assignedUid);
  for (const [uid, subscribed] of Object.entries(overrides)) {
    if (subscribed) out.add(uid);
  }
  return Array.from(out);
}
