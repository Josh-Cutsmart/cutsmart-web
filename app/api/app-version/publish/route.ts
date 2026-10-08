import { NextResponse, type NextRequest } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUser } from "@/lib/api-auth";
import { isDevEmailOnServer } from "@/lib/dev-emails-server";
import {
  cancelScheduledPublish,
  deployStateFor,
  isVersionPublished,
  publishScheduledNow,
  publishVersionNow,
  readDeployedNotes,
  readPublishSchedule,
  readWaitingPublish,
  schedulePublish,
} from "@/lib/app-version-server";

// Dev users only (public/dev-emails.txt): this deploy's version (or ?version=) — whether it's published or
// scheduled, and whether publishing from here would make this deploy the live site — plus the publish that's
// waiting for its time, if any (with its notes, to preview from anywhere); and publishing this deploy's
// version now or at a set date and time, publishing a scheduled one now, or cancelling one
// (lib/app-version-server.ts).

// Making a deploy live, then telling every company.
export const maxDuration = 60;

async function devCaller(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) return { error: NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 }) };
  const user = await verifyBearerUser(request);
  if (!user) return { error: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  if (!(await isDevEmailOnServer(user.email, new URL(request.url).origin))) {
    return { error: NextResponse.json({ ok: false, error: "not-dev" }, { status: 403 }) };
  }
  return { user };
}

function requestHost(request: NextRequest): string {
  return request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
}

export async function GET(request: NextRequest) {
  const caller = await devCaller(request);
  if (caller.error) return caller.error;
  const content = await readDeployedNotes(new URL(request.url).origin);
  const version = String(new URL(request.url).searchParams.get("version") || "").trim() || content.version;
  const [published, schedule, waiting] = await Promise.all([isVersionPublished(version), readPublishSchedule(version), readWaitingPublish()]);
  const deploy = deployStateFor(requestHost(request));
  return NextResponse.json({
    ok: true,
    version,
    deployedVersion: content.version,
    published,
    schedule,
    waiting,
    deploy: { onVercel: deploy.onVercel, isLive: deploy.isLive, canPromote: deploy.canPromote, blockedReason: deploy.blockedReason },
  });
}

export async function POST(request: NextRequest) {
  const caller = await devCaller(request);
  if (caller.error) return caller.error;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; notify?: unknown; scheduledForIso?: unknown; version?: unknown };
  const action = String(body.action ?? "publish");
  const siteOrigin = new URL(request.url).origin;
  const content = await readDeployedNotes(siteOrigin);
  // Cancel / publish a scheduled one now: the version named (from any page), else this deploy's.
  const namedVersion = String(body.version ?? "").trim() || content.version;

  if (action === "cancel") {
    await cancelScheduledPublish(namedVersion);
    return NextResponse.json({ ok: true, version: namedVersion });
  }
  if (action === "publish-scheduled") {
    // Like any publish, not from a local server.
    const here = deployStateFor(requestHost(request));
    if (!here.onVercel) return NextResponse.json({ ok: false, error: "blocked", message: here.blockedReason }, { status: 409 });
    const result = await publishScheduledNow(namedVersion, siteOrigin);
    return NextResponse.json(result, { status: result.ok ? 200 : result.error === "not-scheduled" ? 409 : 500 });
  }
  if (!content.version) return NextResponse.json({ ok: false, error: "no-version" }, { status: 400 });

  const deploy = deployStateFor(requestHost(request));
  if (deploy.blockedReason) return NextResponse.json({ ok: false, error: "blocked", message: deploy.blockedReason }, { status: 409 });
  const notify = body.notify !== false;
  const deploymentId = deploy.isLive ? undefined : deploy.deploymentId || undefined;

  if (action === "schedule") {
    const scheduledForMs = Date.parse(String(body.scheduledForIso ?? ""));
    if (!Number.isFinite(scheduledForMs) || scheduledForMs < Date.now() + 60_000) {
      return NextResponse.json({ ok: false, error: "bad-time", message: "Pick a time at least a minute from now." }, { status: 400 });
    }
    if (await isVersionPublished(content.version)) return NextResponse.json({ ok: false, error: "already-published" }, { status: 409 });
    await schedulePublish({
      content,
      notify,
      scheduledForIso: new Date(scheduledForMs).toISOString(),
      scheduledByUid: caller.user.uid,
      deploymentId,
    });
    return NextResponse.json({ ok: true, version: content.version, scheduledForIso: new Date(scheduledForMs).toISOString() });
  }

  const result = await publishVersionNow({ content, notify, publishedByUid: caller.user.uid, siteOrigin, deploymentId });
  return NextResponse.json(result, { status: result.ok ? 200 : result.error === "already-published" ? 409 : 500 });
}
