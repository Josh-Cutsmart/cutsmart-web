import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { normalizeLeadForms, type LeadForm } from "@/lib/lead-forms";

// A company's lead form as the public sees it — its page (app/f/[companyId]/[formId]), the embed on the company's
// website (public/embed/lead-form.js) and what it sends (app/api/lead-forms/submit) — and the checks that keep
// robots out:
// - A signed ticket handed out with the page (issueLeadFormTicket): a submission must carry one for that form, not
//   sent faster than a person could fill it in, and not days old.
// - A box people never see (the page's honeypot): only a robot fills it in.
// - A limit on how many enquiries one place (IP address) can send a company in a while, and on how many a company
//   can be sent in an hour (takeLeadFormSubmissionSlot).

const TICKET_MIN_AGE_MS = 1500;
const TICKET_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const PER_PLACE_WINDOW_MS = 10 * 60 * 1000;
const PER_PLACE_MAX = 5;
const PER_COMPANY_WINDOW_MS = 60 * 60 * 1000;
const PER_COMPANY_MAX = 120;
const RATE_LIMITS_COLLECTION = "leadFormRateLimits";

export type PublicLeadForm = {
  form: LeadForm;
  companyName: string;
  themeColor: string;
};

function toStr(value: unknown) {
  return String(value ?? "").trim();
}

// The key the tickets are signed with: its own setting if there is one, else one made from the server's Firebase
// key (never sent anywhere — only what's signed with it is).
function ticketSecret() {
  const own = toStr(process.env.LEAD_FORM_SECRET);
  if (own) return own;
  return createHash("sha256").update(`cutsmart-lead-form:${toStr(process.env.FIREBASE_ADMIN_PRIVATE_KEY)}`).digest("hex");
}

function sign(value: string) {
  return createHmac("sha256", ticketSecret()).update(value).digest("base64url");
}

// The company's form, or null — the company or form isn't there (or the address is nonsense).
export async function loadPublicLeadForm(companyId: string, formId: string): Promise<(PublicLeadForm & { companyData: Record<string, unknown> }) | null> {
  const cid = toStr(companyId);
  const fid = toStr(formId);
  if (!adminDb || !cid || !fid || cid.includes("/") || cid.startsWith(".")) return null;
  try {
    const snap = await adminDb.collection("companies").doc(cid).get();
    if (!snap.exists) return null;
    const companyData = (snap.data() ?? {}) as Record<string, unknown>;
    const form = normalizeLeadForms(companyData.leadForms).find((row) => row.id === fid);
    if (!form) return null;
    const themeColor = toStr(companyData.themeColor);
    return {
      form,
      companyName: toStr(companyData.name ?? companyData.companyName),
      themeColor: /^#[0-9a-f]{6}$/i.test(themeColor) ? themeColor : "#2F6BFF",
      companyData,
    };
  } catch {
    return null;
  }
}

// The ticket a form's page carries: when it was handed out, signed for that form.
export function issueLeadFormTicket(companyId: string, formId: string, nowMs = Date.now()) {
  const issuedAt = String(nowMs);
  return `${issuedAt}.${sign(`${companyId}|${formId}|${issuedAt}`)}`;
}

export function checkLeadFormTicket(companyId: string, formId: string, ticket: string, nowMs = Date.now()): "ok" | "too-fast" | "expired" | "invalid" {
  const [issuedAt, signature] = toStr(ticket).split(".");
  if (!issuedAt || !signature || !/^\d+$/.test(issuedAt)) return "invalid";
  const expected = Buffer.from(sign(`${companyId}|${formId}|${issuedAt}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
  const age = nowMs - Number(issuedAt);
  if (age < TICKET_MIN_AGE_MS) return "too-fast";
  if (age > TICKET_MAX_AGE_MS) return "expired";
  return "ok";
}

// Where a submission came from, as a one-way hash (the address itself isn't kept).
export function submissionPlace(headers: Headers) {
  const forwarded = toStr(headers.get("x-forwarded-for")).split(",")[0];
  const ip = toStr(forwarded) || toStr(headers.get("x-real-ip")) || "unknown";
  return createHash("sha256").update(`${ticketSecret()}|${ip}`).digest("hex").slice(0, 40);
}

type WindowCount = { windowStart: number; count: number };

function nextCount(current: WindowCount | null, windowMs: number, nowMs: number): WindowCount {
  if (!current || nowMs - current.windowStart >= windowMs) return { windowStart: nowMs, count: 1 };
  return { windowStart: current.windowStart, count: current.count + 1 };
}

function readCount(data: Record<string, unknown> | undefined): WindowCount | null {
  const windowStart = Number(data?.windowStart);
  const count = Number(data?.count);
  return Number.isFinite(windowStart) && Number.isFinite(count) ? { windowStart, count } : null;
}

// Counts this submission against both limits — false (and nothing counted) when either is already used up.
export async function takeLeadFormSubmissionSlot(companyId: string, place: string, nowMs = Date.now()): Promise<boolean> {
  if (!adminDb) return false;
  const db = adminDb;
  const placeRef = db.collection(RATE_LIMITS_COLLECTION).doc(`p_${createHash("sha256").update(`${companyId}|${place}`).digest("hex").slice(0, 40)}`);
  const companyRef = db.collection(RATE_LIMITS_COLLECTION).doc(`c_${createHash("sha256").update(companyId).digest("hex").slice(0, 40)}`);
  return db.runTransaction(async (tx) => {
    const [placeSnap, companySnap] = await Promise.all([tx.get(placeRef), tx.get(companyRef)]);
    const placeCount = nextCount(readCount(placeSnap.data()), PER_PLACE_WINDOW_MS, nowMs);
    const companyCount = nextCount(readCount(companySnap.data()), PER_COMPANY_WINDOW_MS, nowMs);
    if (placeCount.count > PER_PLACE_MAX || companyCount.count > PER_COMPANY_MAX) return false;
    tx.set(placeRef, { ...placeCount, updatedAt: nowMs });
    tx.set(companyRef, { ...companyCount, updatedAt: nowMs });
    return true;
  });
}

// Web links in the answers — a pile of them is spam, not an enquiry.
export function countLinks(texts: string[]) {
  return texts.reduce((sum, text) => sum + (text.match(/https?:\/\/|www\./gi) || []).length, 0);
}
