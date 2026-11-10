import { createHash, createHmac, timingSafeEqual } from "crypto";
import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { ApiCompanyAccess, CompanyMemberAccessRow } from "@/lib/api-company-access";
import { notificationText, notificationWords } from "@/lib/notification-messages";
import { sendPushToUser, pushStoredNotification } from "@/lib/push-server";
import {
  QUOTE_DISCOUNT_ACCEPT_PERMISSION,
  QUOTE_DISCOUNT_COUNTER_TYPE,
  QUOTE_DISCOUNT_PERMISSION,
  QUOTE_DISCOUNT_REQUEST_TYPE,
  QUOTE_DISCOUNT_RESPONSE_TYPE,
  normalizeQuoteDiscount,
  quoteDiscountAmountText,
  quoteDiscountRequestUrl,
  type QuoteDiscount,
  type QuoteDiscountAnswer,
  type QuoteDiscountFigures,
  type QuoteDiscountNotice,
} from "@/lib/quote-discount";
import type { SpecsShareLinkDoc } from "@/lib/specs-share";

// The server's half of a quote's discount (lib/quote-discount.ts): who can ask for one, answer one or add one; the
// notifications (with Accept / Decline buttons, which answer through a signed token as the production unlock's do); and
// taking a sent quote off the client portal once a discount's agreed (the same as Reopen Edit does — the quote the
// client has is the old price).

const str = (value: unknown) => String(value ?? "").trim();
const PROJECT_ASSIGNEE_FIELDS = ["assignedToUid", "assignedUid", "projectAssignedUid"];

// As the app's hasPermissionKey: the key itself, company.* (everything), or its area's wildcard (sales.*).
function hasKey(keys: string[], key: string): boolean {
  const normalized = keys.map((item) => str(item).toLowerCase());
  const target = key.toLowerCase();
  return normalized.includes(target) || normalized.includes("company.*") || normalized.includes(`${target.split(".")[0]}.*`);
}
const isOwner = (access: ApiCompanyAccess) => str(access.role).toLowerCase() === "owner";
const isOwnerOrAdmin = (access: ApiCompanyAccess) => ["owner", "admin"].includes(str(access.role).toLowerCase());

// Answers requests: sales.discount.accept — and the owner, always.
export function canAnswerQuoteDiscount(access: ApiCompanyAccess): boolean {
  return isOwner(access) || hasKey(access.permissionKeys, QUOTE_DISCOUNT_ACCEPT_PERMISSION);
}
// Adds one straight in, without asking: sales.discount — and the owner, always.
export function canAddQuoteDiscount(access: ApiCompanyAccess): boolean {
  return isOwner(access) || hasKey(access.permissionKeys, QUOTE_DISCOUNT_PERMISSION);
}
// Asks for one: on a project of their own (created, assigned, or given edit on it), with the Design tab.
export function canRequestQuoteDiscount(access: ApiCompanyAccess, projectData: Record<string, unknown>): boolean {
  const seesDesign = isOwnerOrAdmin(access) || hasKey(access.permissionKeys, "sales.view") || hasKey(access.permissionKeys, "sales.edit");
  if (!seesDesign) return false;
  const uid = access.uid;
  if (str(projectData.createdByUid) === uid) return true;
  if (PROJECT_ASSIGNEE_FIELDS.some((field) => str(projectData[field]) === uid)) return true;
  const settings = (projectData.projectSettings ?? {}) as Record<string, unknown>;
  const grants = (settings.projectPermissionsByUid ?? settings.userAccessByUid ?? settings.memberAccessByUid ?? {}) as Record<string, unknown>;
  return str(grants[uid]).toLowerCase() === "edit";
}

export function quoteDiscountApproverUids(members: CompanyMemberAccessRow[]): string[] {
  return members.filter((member) => canAnswerQuoteDiscount(member.access)).map((member) => member.access.uid);
}

// The company's money format, for the notifications' figures — as lib/company-formats.ts's formatMoney (the same
// currencies, digits and symbol), written out here because that file has the app's React hook in it, which the server
// can't load.
const SERVER_CURRENCY_CODES = ["NZD", "AUD", "USD", "CAD", "GBP", "EUR", "ZAR", "SGD"];
export function companyMoney(companyData: Record<string, unknown>): (value: number) => string {
  const typed = str(companyData.defaultCurrency).toUpperCase().slice(0, 3);
  const code = SERVER_CURRENCY_CODES.includes(typed) ? typed : "NZD";
  return (value: number) => {
    const safe = Number.isFinite(value) ? value : 0;
    try {
      return new Intl.NumberFormat("en-NZ", {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(safe);
    } catch {
      return "$" + safe.toFixed(2);
    }
  };
}

// ---- The client portal.

const QUOTE_SENT_CLEARED = {
  sentToClient: FieldValue.delete(),
  acceptedAtIso: FieldValue.delete(),
  acceptedByName: FieldValue.delete(),
  acceptedOnBehalfByName: FieldValue.delete(),
  declinedAtIso: FieldValue.delete(),
  declinedByName: FieldValue.delete(),
};

export async function isQuoteAcceptedByClient(db: Firestore, projectId: string): Promise<boolean> {
  const snap = await db.collection("specsShareLinks").doc(projectId).get();
  return Boolean(snap.exists && (snap.data() as SpecsShareLinkDoc | undefined)?.quoteAcceptedAt);
}

// A discount's been agreed: the quote on the client portal (sent, waiting on them or declined — never one they've
// accepted) is taken off it, as Reopen Edit does (app/api/specs-share/[shareId]/reopen), so the new price can be sent.
// Whether one was.
export async function retractSentQuote(db: Firestore, projectId: string, projectRef: DocumentReference): Promise<boolean> {
  const shareRef = db.collection("specsShareLinks").doc(projectId);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) return false;
  const share = shareSnap.data() as SpecsShareLinkDoc;
  if (!share.quoteVersionId || share.quoteAcceptedAt) return false;
  const versions = projectRef.collection("quoteGridVersions");
  const markedSent = await versions.where("sentToClient", "==", true).get().catch(() => null);
  const ids = new Set<string>([...(markedSent?.docs.map((d) => d.id) ?? []), share.quoteVersionId]);
  await Promise.all([
    ...Array.from(ids).map((id) =>
      versions
        .doc(id)
        .update(QUOTE_SENT_CLEARED)
        .catch(() => undefined),
    ),
    shareRef.update({
      quoteVersionId: FieldValue.delete(),
      quoteAcceptedAt: FieldValue.delete(),
      quoteAcceptedByName: FieldValue.delete(),
      quoteAcceptedOnBehalfByName: FieldValue.delete(),
      quoteAcceptedOnBehalfByUid: FieldValue.delete(),
      quoteDeclinedAt: FieldValue.delete(),
      quoteDeclinedByName: FieldValue.delete(),
      quoteDeclineReason: FieldValue.delete(),
      quoteSentFromLive: FieldValue.delete(),
    }),
  ]);
  return true;
}

// ---- Notifications.

export function discountNoticeOf(discount: QuoteDiscount, figures: QuoteDiscountFigures, counterByName?: string): QuoteDiscountNotice {
  return {
    requestId: discount.requestId,
    requesterUid: discount.requestedByUid,
    requesterName: discount.requestedByName,
    originalTotal: figures.originalTotal,
    amountOff: figures.amountOff,
    amountOffBeforeGst: figures.amountOffBeforeGst,
    newTotal: figures.newTotal,
    mode: figures.mode,
    ...(figures.percent !== undefined ? { percent: figures.percent } : {}),
    gstPercent: figures.gstPercent,
    ...(counterByName ? { counterByName } : {}),
  };
}

// A request (to each who can answer it) or a counter offer (to who asked): in their Notifications, and on their devices
// with Accept and Decline — each with its own signed token, naming who it went to.
export async function sendQuoteDiscountQuestion(input: {
  uids: string[];
  type: typeof QUOTE_DISCOUNT_REQUEST_TYPE | typeof QUOTE_DISCOUNT_COUNTER_TYPE;
  companyId: string;
  projectId: string;
  projectName: string;
  personName: string;
  notice: QuoteDiscountNotice;
  money: (value: number) => string;
  siteOrigin: string;
}): Promise<void> {
  if (!adminDb) return;
  const db = adminDb;
  const nowIso = new Date().toISOString();
  const wording = notificationText(input.type, {
    person: input.personName,
    project: input.projectName,
    old_total: input.money(input.notice.originalTotal),
    new_total: input.money(input.notice.newTotal),
    amount_off: quoteDiscountAmountText(input.notice, input.money),
  });
  const stage = input.type === QUOTE_DISCOUNT_COUNTER_TYPE ? "counter" : "request";
  await Promise.all(
    input.uids.map(async (uid) => {
      try {
        await db.collection("users").doc(uid).collection("notifications").add({
          ...wording,
          type: input.type,
          projectId: input.projectId,
          companyId: input.companyId,
          // So it can be answered from the notification itself (and found again once it's been answered).
          discountRequestId: input.notice.requestId,
          discountNotice: { ...input.notice, projectName: input.projectName },
          read: false,
          createdAt: new Date(nowIso),
          createdAtIso: nowIso,
          // Sent below, with its buttons — never again by the generic sender.
          pushedAtIso: nowIso,
        });
        const token = signQuoteDiscountToken({ companyId: input.companyId, projectId: input.projectId, requestId: input.notice.requestId, uid, stage });
        await sendPushToUser(
          uid,
          {
            title: wording.title,
            body: wording.message,
            url: quoteDiscountRequestUrl(input.projectId, input.notice.requestId),
            tag: `discount_${input.projectId}_${input.notice.requestId}_${stage}`,
            ...(token
              ? {
                  actions: [
                    { action: "approve", title: notificationWords(input.type, "button_accept") },
                    { action: "deny", title: notificationWords(input.type, "button_decline") },
                  ],
                  actionUrl: "/api/quote-discount",
                  actionToken: token,
                }
              : {}),
          },
          { type: input.type, siteOrigin: input.siteOrigin },
        );
      } catch (error) {
        console.error("[quote-discount] notify failed:", error);
      }
    }),
  );
}

// How it went, to whoever's waiting on it: a plain notification (and its push).
export async function sendQuoteDiscountAnswer(
  uid: string,
  wording: { title: string; message: string },
  where: { companyId: string; projectId: string },
  siteOrigin: string,
): Promise<void> {
  if (!adminDb || !uid) return;
  try {
    const nowIso = new Date().toISOString();
    const ref = await adminDb.collection("users").doc(uid).collection("notifications").add({
      ...wording,
      type: QUOTE_DISCOUNT_RESPONSE_TYPE,
      projectId: where.projectId,
      companyId: where.companyId,
      read: false,
      createdAt: new Date(nowIso),
      createdAtIso: nowIso,
    });
    await pushStoredNotification(uid, ref.id, siteOrigin);
  } catch (error) {
    console.error("[quote-discount] answer notification failed:", error);
  }
}

// Answered (or withdrawn, or overtaken by the client accepting the quote): noted on the notifications it went out on, so
// their Accept and Decline go. Never gets in the way of the answer itself.
export async function markQuoteDiscountNotices(
  uids: string[],
  where: { projectId: string; requestId: string; types: string[] },
  answer: QuoteDiscountAnswer,
): Promise<void> {
  if (!adminDb) return;
  const db = adminDb;
  const nowIso = new Date().toISOString();
  await Promise.all(
    Array.from(new Set(uids.filter(Boolean))).map(async (uid) => {
      try {
        const found = await db.collection("users").doc(uid).collection("notifications").where("discountRequestId", "==", where.requestId).get();
        await Promise.all(
          found.docs
            .filter((docSnap) => {
              const data = docSnap.data() ?? {};
              return str(data.projectId) === where.projectId && where.types.includes(str(data.type)) && !data.discountAnswer;
            })
            .map((docSnap) => docSnap.ref.update({ discountAnswer: answer, read: true, readAtIso: nowIso })),
        );
      } catch (error) {
        console.warn("[quote-discount] couldn't note the answer on a notification:", error);
      }
    }),
  );
}

// The client accepted the quote while a discount was still being worked out: that's the price now, so the request's
// gone, and its notifications say why. (app/api/specs-share/[shareId]/accept and on-behalf.) Best-effort.
export async function cancelQuoteDiscountForAcceptedQuote(projectRef: DocumentReference, projectId: string, members: CompanyMemberAccessRow[]): Promise<void> {
  try {
    const snap = await projectRef.get();
    const discount = normalizeQuoteDiscount((snap.data() ?? {}).quoteDiscount);
    if (!discount || discount.status === "approved") return;
    await projectRef.update({ quoteDiscount: FieldValue.delete() });
    await markQuoteDiscountNotices(
      [...quoteDiscountApproverUids(members), discount.requestedByUid],
      { projectId, requestId: discount.requestId, types: [QUOTE_DISCOUNT_REQUEST_TYPE, QUOTE_DISCOUNT_COUNTER_TYPE] },
      { decision: "client_accepted" },
    );
  } catch (error) {
    console.warn("[quote-discount] couldn't cancel a discount on an accepted quote:", error);
  }
}

// ---- The notification's Accept / Decline buttons can't sign in (they run in the background, from the phone's
// notification), so each carries its own token: signed by the server, naming the project, the request, who it went to and
// what they're answering (a request, or a counter offer), and good for 2 days.

const TOKEN_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export type QuoteDiscountTokenClaims = { companyId: string; projectId: string; requestId: string; uid: string; stage: "request" | "counter" };

function signingKey(): Buffer | null {
  const secret = str(process.env.VAPID_PRIVATE_KEY) || str(process.env.FIREBASE_ADMIN_PRIVATE_KEY);
  return secret ? createHash("sha256").update(`cutsmart-discount-actions:${secret}`).digest() : null;
}

export function signQuoteDiscountToken(claims: QuoteDiscountTokenClaims): string | null {
  const key = signingKey();
  if (!key) return null;
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Date.now() + TOKEN_TTL_MS })).toString("base64url");
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyQuoteDiscountToken(token: string): QuoteDiscountTokenClaims | null {
  const key = signingKey();
  const [body, sig] = String(token || "").split(".");
  if (!key || !body || !sig) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as QuoteDiscountTokenClaims & { exp?: number };
    if (!claims.exp || Date.now() > claims.exp) return null;
    if (!claims.companyId || !claims.projectId || !claims.requestId || !claims.uid) return null;
    if (claims.stage !== "request" && claims.stage !== "counter") return null;
    return claims;
  } catch {
    return null;
  }
}
