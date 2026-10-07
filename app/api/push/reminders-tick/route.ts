import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { requireCompanyMember } from "@/lib/api-company-access";
import { runCalendarReminders } from "@/lib/calendar-reminders-server";
import { runClientPortalPendingReminders } from "@/lib/client-portal-reminders-server";
import { flushDuePushDigests } from "@/lib/push-server";

// The fallback for calendar reminders (and held notification groups) when no scheduler is calling
// app/api/cron/notifications: the
// app calls this when it's opened (lib/push-client.ts), and it checks the caller's company — at most
// once every 5 minutes per company, however many people have the app open.

const MIN_GAP_MS = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as { companyId?: unknown };
  const companyId = String(body.companyId ?? "").trim();
  if (!companyId || companyId.includes("/")) return NextResponse.json({ ok: false, error: "missing-company-id" }, { status: 400 });
  if (!(await requireCompanyMember(request, companyId))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // Server-only bookkeeping (no client rules): when this company was last checked.
  const stampRef = adminDb.collection("calendarReminderRuns").doc(companyId);
  const now = Date.now();
  const due = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(stampRef);
    const lastMs = Number(snap.data()?.lastRunMs ?? 0);
    if (Number.isFinite(lastMs) && now - lastMs < MIN_GAP_MS) return false;
    tx.set(stampRef, { lastRunMs: now, lastRunIso: new Date(now).toISOString() });
    return true;
  });
  if (!due) return NextResponse.json({ ok: true, skipped: "recently-checked" });
  const siteOrigin = new URL(request.url).origin;
  // And any held notification groups whose time is up (anyone's — it's the scheduled job's backup).
  const [result, clientPortal, groupsSent] = await Promise.all([
    runCalendarReminders({ siteOrigin, companyIds: [companyId], now }),
    runClientPortalPendingReminders({ siteOrigin, companyIds: [companyId], now }),
    flushDuePushDigests(siteOrigin),
  ]);
  return NextResponse.json({ ok: true, ...result, clientPortal, groupsSent });
}
