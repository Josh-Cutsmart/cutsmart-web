import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { getProjectDocRefAdmin, verifyCompanyMembershipAdmin, type SpecsShareLinkDoc } from "@/lib/specs-share";
import { normalizeSpecsGrid, quoteGridTotalText } from "@/lib/specs-grid-types";
import { projectNotifySubscriberUids } from "@/lib/project-notify";
import { pushStoredNotification } from "@/lib/push-server";

// Staff accepting the quote (kind "quote") or submitting the specifications (kind "specs") for the client — the client
// told them, rather than doing it in their portal. The same records as the client's own accept / submit routes (the
// same stamps on the project's client link and on the version, the changelog, the notifications), with who did it on
// their behalf as well (quoteAcceptedOnBehalfByName / acceptedOnBehalfByName, submittedOnBehalfByName), so it's never
// taken for the client's own: "Accepted on behalf of <client> by <staff>" (lib/on-behalf.ts).
// - Sent to the client and waiting: the sent version. Not sent: the version the staff page has just frozen (versionId —
//   the quote as it stands, or the specifications with the answers given for the client), bound to the client link
//   (made now if there isn't one yet) as if it had been — without anything being sent to the client.
// - Only someone in the project's company; the client's name is the project's, and the staff member's their own —
//   neither taken from the request.
export const maxDuration = 60;

const toStr = (value: unknown) => String(value ?? "").trim();

export async function POST(request: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const db = adminDb;
  const { shareId } = await params;
  const shareRef = db.collection("specsShareLinks").doc(shareId);
  const [uid, shareSnap, rawBody] = await Promise.all([verifyBearerUid(request), shareRef.get(), request.json().catch(() => ({}))]);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = rawBody as Record<string, unknown>;
  const kind = body.kind === "quote" ? "quote" : "specs";
  const shareDoc = shareSnap.exists ? (shareSnap.data() as SpecsShareLinkDoc) : null;
  // The link's own company and project — or, with no link yet, the project's (its id is the link's).
  const companyId = toStr(shareDoc?.companyId) || toStr(body.companyId);
  const projectId = toStr(shareDoc?.projectId) || shareId;
  if (!companyId) return NextResponse.json({ ok: false, error: "missing-company" }, { status: 400 });

  const [isMember, projectRef] = await Promise.all([verifyCompanyMembershipAdmin(db, companyId, uid), getProjectDocRefAdmin(db, projectId, companyId)]);
  if (!isMember) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!projectRef) return NextResponse.json({ ok: false, error: "project-not-found" }, { status: 404 });

  // Who: the project's client, and the staff member doing it.
  const company = db.collection("companies").doc(companyId);
  const [projectSnap, membershipSnap, userSnap] = await Promise.all([projectRef.get(), company.collection("memberships").doc(uid).get(), db.collection("users").doc(uid).get()]);
  const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
  const customer = toStr(projectData.customer);
  const clientName =
    (customer && customer !== "Unknown Customer" ? customer : "") ||
    [toStr(projectData.clientFirstName), toStr(projectData.clientLastName)].filter(Boolean).join(" ") ||
    "the client";
  const staffName =
    toStr(membershipSnap.data()?.displayName) || toStr(userSnap.data()?.displayName) || toStr(userSnap.data()?.name) || toStr(userSnap.data()?.email) || "Staff";
  const projectName = toStr(projectData.name) || "a project";
  const nowIso = new Date().toISOString();
  // A link made just for this (nothing was sent): its own basics, as a send's.
  const linkBasics = shareDoc
    ? {}
    : { projectId, companyId, createdAt: nowIso, clientEmail: toStr(projectData.clientEmail) || clientName, sentByUid: uid, sentByName: staffName };
  const sentFromLive = body.sentFromLive === true;

  let notification: { title: string; message: string; type: string };
  let action: string;
  let versionId: string;
  if (kind === "quote") {
    // Already accepted: as it is. Declined: stays so until it's reopened.
    if (shareDoc?.quoteAcceptedAt) {
      return NextResponse.json({
        ok: true,
        at: shareDoc.quoteAcceptedAt,
        clientName: shareDoc.quoteAcceptedByName || clientName,
        staffName: shareDoc.quoteAcceptedOnBehalfByName || "",
        versionId: shareDoc.quoteVersionId || "",
      });
    }
    if (shareDoc?.quoteDeclinedAt) return NextResponse.json({ ok: false, error: "quote-declined" }, { status: 409 });
    // The sent one, if there is one — else the one the page has frozen.
    versionId = toStr(shareDoc?.quoteVersionId) || toStr(body.versionId);
    if (!versionId) return NextResponse.json({ ok: false, error: "no-quote" }, { status: 400 });
    const versionRef = projectRef.collection("quoteGridVersions").doc(versionId);
    const grid = normalizeSpecsGrid(((await versionRef.get()).data() ?? {}).grid);
    if (!grid) return NextResponse.json({ ok: false, error: "no-quote" }, { status: 404 });
    try {
      await shareRef.set(
        {
          ...linkBasics,
          ...(shareDoc?.quoteVersionId ? {} : { quoteVersionId: versionId, quoteSentFromLive: sentFromLive }),
          quoteAcceptedAt: nowIso,
          quoteAcceptedByName: clientName,
          quoteAcceptedOnBehalfByName: staffName,
          quoteAcceptedOnBehalfByUid: uid,
        },
        { merge: true },
      );
      await versionRef.set({ acceptedAtIso: nowIso, acceptedByName: clientName, acceptedOnBehalfByName: staffName }, { merge: true });
    } catch (error) {
      console.error("[specs-share/on-behalf] quote write failed:", error);
      return NextResponse.json({ ok: false, error: "write-failed" }, { status: 500 });
    }
    const price = quoteGridTotalText(grid);
    action = `Accepted Quote on behalf of ${clientName}`;
    notification = {
      title: `Quote accepted for ${projectName}`,
      message: `Accepted on behalf of ${clientName} by ${staffName}${price ? ` — ${price}` : ""}`,
      type: "quote_accepted",
    };
  } else {
    if (shareDoc?.submittedAt) {
      return NextResponse.json({
        ok: true,
        at: shareDoc.submittedAt,
        clientName: shareDoc.submittedByName || clientName,
        staffName: shareDoc.submittedOnBehalfByName || "",
        versionId: shareDoc.versionId || "",
      });
    }
    versionId = toStr(shareDoc?.versionId) || toStr(body.versionId);
    const versionRef = versionId ? projectRef.collection("specificationsVersions").doc(versionId) : null;
    // (An old link from before links were tied to a version has the sheet on the project itself.)
    if (versionRef && !(await versionRef.get()).exists) return NextResponse.json({ ok: false, error: "no-specifications" }, { status: 404 });
    if (!versionRef && !shareDoc) return NextResponse.json({ ok: false, error: "no-specifications" }, { status: 400 });
    try {
      await shareRef.set(
        {
          ...linkBasics,
          ...(shareDoc?.versionId || !versionId ? {} : { versionId, specsSentFromLive: sentFromLive }),
          submittedAt: nowIso,
          submittedByName: clientName,
          submittedOnBehalfByName: staffName,
          submittedOnBehalfByUid: uid,
        },
        { merge: true },
      );
      if (versionRef) await versionRef.set({ submittedAtIso: nowIso, submittedByName: clientName, submittedOnBehalfByName: staffName }, { merge: true });
    } catch (error) {
      console.error("[specs-share/on-behalf] specs write failed:", error);
      return NextResponse.json({ ok: false, error: "write-failed" }, { status: 500 });
    }
    action = `Submitted Specifications on behalf of ${clientName}`;
    notification = {
      title: `Specifications Submitted for ${projectName}`,
      message: `Submitted on behalf of ${clientName} by ${staffName}`,
      type: "specs_submitted",
    };
  }

  // Best effort, as the client's own: its changelog line, and the project's subscribers told (not whoever did it).
  try {
    await db.collection("changelog").add({ projectId, actor: staffName, action, at: nowIso });
  } catch (error) {
    console.error("[specs-share/on-behalf] changelog write failed:", error);
  }
  try {
    const subscriberUids = projectNotifySubscriberUids({
      assignedToUid: toStr(projectData.assignedToUid),
      notifySubscriptionOverrides: (projectData.notifySubscriptionOverrides ?? {}) as Record<string, boolean>,
    }).filter((subscriber) => subscriber !== uid);
    await Promise.all(
      subscriberUids.map((subscriber) =>
        db
          .collection("users")
          .doc(subscriber)
          .collection("notifications")
          .add({
            ...notification,
            projectId,
            companyId: toStr(projectData.companyId) || companyId,
            read: false,
            createdAt: new Date(nowIso),
            createdAtIso: nowIso,
          })
          .then((ref) => pushStoredNotification(subscriber, ref.id, new URL(request.url).origin).catch(() => undefined)),
      ),
    );
  } catch (error) {
    console.error("[specs-share/on-behalf] notification fan-out failed:", error);
  }

  return NextResponse.json({ ok: true, at: nowIso, clientName, staffName, versionId });
}
