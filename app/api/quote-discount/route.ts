import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { listCompanyMemberAccess, requireCompanyMember } from "@/lib/api-company-access";
import { getProjectDocRefAdmin } from "@/lib/specs-share";
import { displayNameIn } from "@/lib/production-unlock-server";
import { notificationText } from "@/lib/notification-messages";
import {
  QUOTE_DISCOUNT_COUNTER_TYPE,
  QUOTE_DISCOUNT_REQUEST_TYPE,
  isQuoteDiscountMode,
  normalizeQuoteDiscount,
  quoteDiscountAmountText,
  quoteDiscountFigures,
  type QuoteDiscount,
  type QuoteDiscountAnswer,
} from "@/lib/quote-discount";
import {
  canAddQuoteDiscount,
  canAnswerQuoteDiscount,
  canRequestQuoteDiscount,
  companyMoney,
  discountNoticeOf,
  isQuoteAcceptedByClient,
  markQuoteDiscountNotices,
  quoteDiscountApproverUids,
  retractSentQuote,
  sendQuoteDiscountAnswer,
  sendQuoteDiscountQuestion,
  verifyQuoteDiscountToken,
} from "@/lib/quote-discount-server";

// A quote's discount (lib/quote-discount.ts, lib/quote-discount-server.ts) — every change to one comes through here, so
// only the server writes it (firestore.rules). { action, companyId, projectId, … } as the signed-in user:
// - "request": staff on their own project ask for one ({ mode, value, originalTotal, gstPercent }) — whoever can answer
//   is notified;
// - "add": someone with sales.discount adds one straight in (the same fields);
// - "remove": withdraws one still being worked out, or takes an agreed one off;
// - "answer": one who can answer a request accepts it, or declines it ({ decision }, with { counter: { mode, value } } for
//   a counter offer);
// - "counter-answer": who asked accepts or declines the counter offer.
// Or { token, decision } from a notification's Accept / Decline (public/sw.js) — the token says who, and which request.
// Agreed (added, accepted, or a counter offer accepted): the sent quote comes off the client portal.

type Json = Record<string, unknown>;
const str = (value: unknown) => String(value ?? "").trim();
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) return fail("missing-firebase-admin-config", 500);
  const db = adminDb;
  const body = (await request.json().catch(() => ({}))) as Json;
  const siteOrigin = new URL(request.url).origin;

  let action = str(body.action);
  let companyId = str(body.companyId);
  let projectId = str(body.projectId);
  let requestId = str(body.requestId);
  let actorUid = "";
  // From a notification's button (no sign-in): the token's claims.
  let fromButton = false;
  if (body.token) {
    const claims = verifyQuoteDiscountToken(str(body.token));
    if (!claims) return fail("invalid-token", 401);
    ({ companyId, projectId, requestId } = claims);
    actorUid = claims.uid;
    action = claims.stage === "counter" ? "counter-answer" : "answer";
    fromButton = true;
  } else {
    if (!companyId || !projectId) return fail("missing-fields", 400);
    const access = await requireCompanyMember(request, companyId);
    if (!access) return fail("unauthorized", 401);
    actorUid = access.uid;
  }
  if (!["request", "add", "remove", "answer", "counter-answer"].includes(action)) return fail("bad-action", 400);

  const projectRef = await getProjectDocRefAdmin(db, projectId, companyId);
  const [projectSnap, companySnap, members] = await Promise.all([
    projectRef ? projectRef.get() : Promise.resolve(null),
    db.collection("companies").doc(companyId).get(),
    listCompanyMemberAccess(companyId),
  ]);
  if (!projectRef || !projectSnap?.exists) return fail("project-not-found", 404);
  const projectData = (projectSnap.data() ?? {}) as Json;
  if (str(projectData.companyId) && str(projectData.companyId) !== companyId) return fail("project-not-found", 404);
  if (projectData.isArchived === true || projectData.isDeleted === true) return fail("project-archived", 409);
  const actor = members.find((member) => member.access.uid === actorUid)?.access;
  // (Still in the company — a button's token outlives someone leaving.)
  if (!actor) return fail("forbidden", 403);
  const actorName = displayNameIn(members, actorUid);
  const money = companyMoney((companySnap.data() ?? {}) as Json);
  const projectName = str(projectData.name) || "a project";
  const where = { companyId, projectId };
  const current = normalizeQuoteDiscount(projectData.quoteDiscount);
  const approverUids = quoteDiscountApproverUids(members);

  // The project's quoteDiscount changed only if it's still what was read (no two answers at once).
  const swap = async (expectRequestId: string | null, next: QuoteDiscount | null): Promise<boolean> =>
    db.runTransaction(async (tx) => {
      const snap = await tx.get(projectRef);
      const now = normalizeQuoteDiscount((snap.data() ?? {}).quoteDiscount);
      if ((now?.requestId ?? null) !== expectRequestId) return false;
      tx.update(projectRef, { quoteDiscount: next ? JSON.parse(JSON.stringify(next)) : FieldValue.delete() });
      return true;
    });

  // Nothing left to answer (already answered, withdrawn, or a newer one).
  const alreadyAnswered = () => {
    const tap = notificationText("quote_discount_tap.already_answered");
    return NextResponse.json({ ok: true, alreadyAnswered: true, discount: current, tapTitle: tap.title, tapMessage: tap.message });
  };

  // ---- Asking for one, or adding one straight in.
  if (action === "request" || action === "add") {
    const mode = body.mode;
    if (!isQuoteDiscountMode(mode)) return fail("bad-discount", 400);
    const figures = quoteDiscountFigures(body.originalTotal, body.gstPercent, mode, body.value);
    if (!figures) return fail("bad-discount", 400);
    if (action === "add" ? !canAddQuoteDiscount(actor) : !canRequestQuoteDiscount(actor, projectData)) return fail("forbidden", 403);
    if (await isQuoteAcceptedByClient(db, projectId)) return fail("quote-accepted", 409);
    if (current) return fail("discount-exists", 409);
    const nowIso = new Date().toISOString();
    const base = { ...figures, requestId: nowIso, requestedByUid: actorUid, requestedByName: actorName, requestedAtIso: nowIso };
    const next: QuoteDiscount =
      action === "add"
        ? { ...base, status: "approved", direct: true, approvedByUid: actorUid, approvedByName: actorName, approvedAtIso: nowIso }
        : { ...base, status: "pending" };
    if (!(await swap(null, next))) return fail("discount-exists", 409);
    if (action === "add") {
      const retracted = await retractSentQuote(db, projectId, projectRef);
      return NextResponse.json({ ok: true, discount: next, retracted });
    }
    await sendQuoteDiscountQuestion({
      uids: approverUids.filter((uid) => uid !== actorUid),
      type: QUOTE_DISCOUNT_REQUEST_TYPE,
      companyId,
      projectId,
      projectName,
      personName: actorName,
      notice: discountNoticeOf(next, next),
      money,
      siteOrigin,
    });
    return NextResponse.json({ ok: true, discount: next });
  }

  // ---- Withdrawing one, or taking an agreed one off.
  if (action === "remove") {
    if (!current) return NextResponse.json({ ok: true, discount: null });
    const allowed =
      current.requestedByUid === actorUid || canAddQuoteDiscount(actor) || canAnswerQuoteDiscount(actor) || canRequestQuoteDiscount(actor, projectData);
    if (!allowed) return fail("forbidden", 403);
    if (!(await swap(current.requestId, null))) return fail("changed", 409);
    if (current.status !== "approved") {
      await markQuoteDiscountNotices(
        [...approverUids, current.requestedByUid],
        { projectId, requestId: current.requestId, types: [QUOTE_DISCOUNT_REQUEST_TYPE, QUOTE_DISCOUNT_COUNTER_TYPE] },
        { decision: "withdrawn" },
      );
    }
    return NextResponse.json({ ok: true, discount: null });
  }

  // ---- Answering: a request (one who can answer), or a counter offer (who asked).
  const decision = str(body.decision);
  if (decision !== "approve" && decision !== "deny") return fail("bad-decision", 400);
  const answeringCounter = action === "counter-answer";
  if (!current || current.requestId !== requestId || current.status !== (answeringCounter ? "countered" : "pending")) return alreadyAnswered();
  if (answeringCounter ? current.requestedByUid !== actorUid : !canAnswerQuoteDiscount(actor) || current.requestedByUid === actorUid) {
    return fail("forbidden", 403);
  }
  const noticeTypes = [answeringCounter ? QUOTE_DISCOUNT_COUNTER_TYPE : QUOTE_DISCOUNT_REQUEST_TYPE];
  const noticeUids = answeringCounter ? [current.requestedByUid] : approverUids;

  // The client's accepted the quote in the meantime: that's the price, and this is gone.
  if (await isQuoteAcceptedByClient(db, projectId)) {
    await swap(current.requestId, null);
    await markQuoteDiscountNotices(
      [...approverUids, current.requestedByUid],
      { projectId, requestId: current.requestId, types: [QUOTE_DISCOUNT_REQUEST_TYPE, QUOTE_DISCOUNT_COUNTER_TYPE] },
      { decision: "client_accepted" },
    );
    const tap = notificationText("quote_discount_tap.already_answered");
    return NextResponse.json({ ok: true, alreadyAnswered: true, clientAccepted: true, discount: null, tapTitle: tap.title, tapMessage: tap.message });
  }

  const nowIso = new Date().toISOString();
  const answerNote = (answer: QuoteDiscountAnswer) => markQuoteDiscountNotices(noticeUids, { projectId, requestId: current.requestId, types: noticeTypes }, answer);

  if (decision === "approve") {
    // Accepted: the request's figures — or, for a counter offer, the counter offer's.
    const counter = current.counter;
    const agreed: QuoteDiscount =
      answeringCounter && counter
        ? {
            ...current,
            mode: counter.mode,
            percent: counter.percent,
            originalTotal: counter.originalTotal,
            amountOff: counter.amountOff,
            newTotal: counter.newTotal,
            amountOffBeforeGst: counter.amountOffBeforeGst,
            gstPercent: counter.gstPercent,
            status: "approved",
            counter: undefined,
            approvedByUid: counter.byUid,
            approvedByName: counter.byName,
            approvedAtIso: nowIso,
          }
        : { ...current, status: "approved", approvedByUid: actorUid, approvedByName: actorName, approvedAtIso: nowIso };
    if (agreed.percent === undefined) delete agreed.percent;
    if (!(await swap(current.requestId, agreed))) return alreadyAnswered();
    const retracted = await retractSentQuote(db, projectId, projectRef);
    const vars = { person: actorName, project: projectName, new_total: money(agreed.newTotal), amount_off: quoteDiscountAmountText(agreed, money) };
    if (answeringCounter) {
      await sendQuoteDiscountAnswer(
        counter?.byUid || "",
        notificationText(retracted ? "quote_discount_response.counter_accepted_unsent" : "quote_discount_response.counter_accepted", vars),
        where,
        siteOrigin,
      );
    } else {
      await sendQuoteDiscountAnswer(
        current.requestedByUid,
        notificationText(retracted ? "quote_discount_response.approved_unsent" : "quote_discount_response.approved", vars),
        where,
        siteOrigin,
      );
    }
    await answerNote({ decision: "approve", byName: actorName });
    const tap = notificationText(answeringCounter ? "quote_discount_tap.counter_accepted" : "quote_discount_tap.approved", {
      person: current.requestedByName || "They",
      new_total: money(agreed.newTotal),
    });
    return NextResponse.json({ ok: true, decision, discount: agreed, retracted, tapTitle: tap.title, tapMessage: tap.message });
  }

  // Declined with a counter offer (in the app only — a notification's Decline is just a decline).
  const counterInput = !answeringCounter && !fromButton && body.counter && typeof body.counter === "object" ? (body.counter as Json) : null;
  if (counterInput) {
    const mode = counterInput.mode;
    const figures = isQuoteDiscountMode(mode) ? quoteDiscountFigures(current.originalTotal, current.gstPercent, mode, counterInput.value) : null;
    if (!figures) return fail("bad-discount", 400);
    const countered: QuoteDiscount = { ...current, status: "countered", counter: { ...figures, byUid: actorUid, byName: actorName, atIso: nowIso } };
    if (!(await swap(current.requestId, countered))) return alreadyAnswered();
    await answerNote({ decision: "counter", byName: actorName, counterTotal: figures.newTotal });
    await sendQuoteDiscountQuestion({
      uids: [current.requestedByUid],
      type: QUOTE_DISCOUNT_COUNTER_TYPE,
      companyId,
      projectId,
      projectName,
      personName: actorName,
      notice: discountNoticeOf(current, figures, actorName),
      money,
      siteOrigin,
    });
    return NextResponse.json({ ok: true, decision: "counter", discount: countered });
  }

  // Declined: it's gone.
  if (!(await swap(current.requestId, null))) return alreadyAnswered();
  const declinedTo = answeringCounter ? current.counter?.byUid || "" : current.requestedByUid;
  await sendQuoteDiscountAnswer(
    declinedTo,
    notificationText(answeringCounter ? "quote_discount_response.counter_declined" : "quote_discount_response.declined", {
      person: actorName,
      project: projectName,
    }),
    where,
    siteOrigin,
  );
  await answerNote({ decision: "deny", byName: actorName });
  const tap = notificationText(answeringCounter ? "quote_discount_tap.counter_declined" : "quote_discount_tap.declined", {
    person: answeringCounter ? current.counter?.byName || "They" : current.requestedByName || "They",
  });
  return NextResponse.json({ ok: true, decision, discount: null, tapTitle: tap.title, tapMessage: tap.message });
}
