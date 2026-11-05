import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { requireCompanyMember } from "@/lib/api-company-access";
import { sendColumnAutomationEmail } from "@/lib/column-automation-email-server";
import { automationConditionsMet, automationItemFacts, isInAutomationColumn, normalizeColumnAutomations, type BoardSpot } from "@/lib/column-automations";

// A project moved in the app (its column automations run there — notifyColumnAutomationMove, lib/firestore-data.ts): the
// email of one of them, sent. All the request says is which project and which automation:
// - Only a member of the company can ask.
// - Who it goes to and what it says come from the automation as saved, and the project's name from the project.
// - The project really has to have just done what the automation's for: be in its column (entering) or out of it (leaving).
// - The same automation emails about the same project at most once a minute (lib/column-automation-email-server.ts).

const str = (value: unknown) => String(value ?? "").trim();

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = str(body.companyId);
  const projectId = str(body.projectId);
  const automationId = str(body.automationId);
  if (!companyId || !projectId || !automationId || /[/\\]/.test(projectId)) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }
  const access = await requireCompanyMember(request, companyId);
  if (!access) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const companyRef = adminDb.collection("companies").doc(companyId);
  const companyData = ((await companyRef.get()).data() ?? {}) as Record<string, unknown>;
  const automation = normalizeColumnAutomations(companyData.columnAutomations).find((row) => row.id === automationId);
  // ("Has been in" ones are the scheduled job's own.)
  if (!automation || automation.action !== "email" || automation.trigger === "stays") {
    return NextResponse.json({ ok: false, error: "no-such-automation" }, { status: 404 });
  }

  const projectRef = companyRef.collection("jobs").doc(projectId);
  const data = ((await projectRef.get()).data() ?? null) as Record<string, unknown> | null;
  if (!data || data.isDeleted === true || data.isPurged === true || data.isSmallJob === true) {
    return NextResponse.json({ ok: false, error: "no-such-project" }, { status: 404 });
  }
  const here: BoardSpot = { status: str(data.status), subStage: str(data.dashboardSubStageId) };
  if (isInAutomationColumn(automation, here) !== (automation.trigger === "enters")) {
    return NextResponse.json({ ok: false, error: "not-what-it-is-for" }, { status: 409 });
  }
  const name = str(data.name) || "A project";
  const rawFrom = (body.from ?? null) as Record<string, unknown> | null;
  const from: BoardSpot | null = rawFrom && str(rawFrom.status) ? { status: str(rawFrom.status), subStage: str(rawFrom.subStage) } : null;
  if (!automationConditionsMet(automation, automationItemFacts(data, name), from)) {
    return NextResponse.json({ ok: false, error: "conditions-not-met" }, { status: 409 });
  }

  const sent = await sendColumnAutomationEmail({ db: adminDb, companyId, companyData, automation, projectRef, projectName: name, siteOrigin: request.nextUrl.origin, movedTo: here });
  return NextResponse.json({ ok: true, sent });
}
