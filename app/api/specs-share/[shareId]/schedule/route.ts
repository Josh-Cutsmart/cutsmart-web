import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { isShareLinkInactiveAdmin, SHARE_LINK_INACTIVE_ERROR, type SpecsShareLinkDoc } from "@/lib/specs-share";
import type { ClientScheduleEvent } from "@/lib/calendar-data";

// The client portal's Schedule tab: calendar events linked to this hub link's project that staff
// switched "Show on client portal" on for. Same public, link-is-the-secret shape as .../grid — and
// like that route it returns only what the client should see (title, times, category), never the
// event's location, notes or who added it.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const { shareId } = await params;
  const shareSnap = await adminDb.collection("specsShareLinks").doc(shareId).get();
  if (!shareSnap.exists) {
    return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  const shareDoc = shareSnap.data() as SpecsShareLinkDoc;
  const companyId = String(shareDoc.companyId || "").trim();
  const projectId = String(shareDoc.projectId || "").trim();
  if (!companyId || !projectId) {
    return NextResponse.json({ ok: true, events: [] });
  }
  // A finished project's link stops working (archived, or past the company's archive delay).
  if (await isShareLinkInactiveAdmin(adminDb, shareDoc)) {
    return NextResponse.json({ ok: false, error: SHARE_LINK_INACTIVE_ERROR }, { status: 410 });
  }

  const companyRef = adminDb.collection("companies").doc(companyId);
  const [eventsSnap, companySnap] = await Promise.all([
    companyRef.collection("calendarEvents").where("projectId", "==", projectId).get(),
    companyRef.get(),
  ]);
  const categories = Array.isArray(companySnap.data()?.calendarCategories)
    ? (companySnap.data()?.calendarCategories as Array<Record<string, unknown>>)
    : [];
  const categoryById = new Map(categories.map((c) => [String(c?.id ?? ""), c]));

  const events: ClientScheduleEvent[] = eventsSnap.docs
    .map((d) => {
      const data = d.data() ?? {};
      if (data.showToClient !== true || data.archived === true) return null;
      const startMs = Number(data.startMs);
      const endMs = Number(data.endMs);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
      const category = categoryById.get(String(data.categoryId ?? ""));
      return {
        id: d.id,
        title: String(data.title ?? "").trim() || "Scheduled",
        allDay: Boolean(data.allDay),
        startMs,
        endMs: Math.max(endMs, startMs),
        categoryName: String(category?.name ?? "").trim(),
        color: String(category?.color ?? "").trim() || "#2F6BFF",
      };
    })
    .filter((e): e is ClientScheduleEvent => Boolean(e))
    .sort((a, b) => a.startMs - b.startMs);

  return NextResponse.json({ ok: true, events });
}
