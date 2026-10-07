import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { announceCurrentAppVersion } from "@/lib/app-version-server";
import { runCalendarReminders } from "@/lib/calendar-reminders-server";
import { runClientPortalPendingReminders } from "@/lib/client-portal-reminders-server";
import { flushDuePushDigests } from "@/lib/push-server";

// The notifications scheduled job — meant to be called every minute or few by a scheduler, with the
// CRON_SECRET environment variable as `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends) or
// `?key=<CRON_SECRET>` (for a service like cron-job.org). It sends:
// - calendar reminders that are due (lib/calendar-reminders-server.ts), for every company;
// - "quote not accepted / specifications not submitted yet" reminders (lib/client-portal-reminders-server.ts);
// - notifications held by people's "time between notifications" whose time is up, grouped into one
//   (flushDuePushDigests in lib/push-server.ts);
// - a new version, once it's live: added to the changelog and announced to everyone in every company,
//   without anyone having to open CutSmart first (lib/app-version-server.ts).

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return NextResponse.json({ ok: false, error: "cron-not-configured" }, { status: 503 });
  const header = String(request.headers.get("authorization") || "");
  const key = new URL(request.url).searchParams.get("key") || "";
  if (header !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const siteOrigin = new URL(request.url).origin;
  const [reminders, clientPortal, groupsSent, newVersion] = await Promise.all([
    runCalendarReminders({ siteOrigin }),
    runClientPortalPendingReminders({ siteOrigin }),
    flushDuePushDigests(siteOrigin),
    announceCurrentAppVersion(siteOrigin).catch((error) => {
      console.error("[cron/notifications] new version announcement failed:", error);
      return null;
    }),
  ]);
  return NextResponse.json({ ok: true, reminders, clientPortal, groupsSent, newVersion });
}
