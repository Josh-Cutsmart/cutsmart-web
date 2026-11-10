// A discount on a project's quote, agreed between staff (the client never sees any of it — only the quote's new total).
// Staff on their own projects ask for one (Request Discount, in the quote's bottom bar); whoever can answer them
// (sales.discount.accept, and the owner) accepts it, declines it, or declines it with a counter offer, which the one who
// asked accepts or declines. Someone with sales.discount adds one straight in. Kept on the project doc as quoteDiscount —
// written only by the server (app/api/quote-discount, lib/quote-discount-server.ts; firestore.rules keeps it that way).
// Shared by the app and the server.

export const QUOTE_DISCOUNT_PERMISSION = "sales.discount";
export const QUOTE_DISCOUNT_ACCEPT_PERMISSION = "sales.discount.accept";

// How it was typed: the new total, the amount off, or a percentage off — of the quote's total as it showed then
// (with GST, when the company adds it).
export type QuoteDiscountMode = "total" | "amount" | "percent";
export const QUOTE_DISCOUNT_MODES: Array<{ id: QuoteDiscountMode; label: string }> = [
  { id: "total", label: "New total" },
  { id: "amount", label: "Amount off" },
  { id: "percent", label: "Percent off" },
];

// What a discount comes to: the quote's total then, how much comes off it, and the new total (all with GST, as the
// quote shows them), and the part that's taken off before GST — what stays the same as the quote changes afterwards.
export type QuoteDiscountFigures = {
  mode: QuoteDiscountMode;
  percent?: number;
  originalTotal: number;
  amountOff: number;
  newTotal: number;
  amountOffBeforeGst: number;
  gstPercent: number;
};

export type QuoteDiscountStatus = "pending" | "countered" | "approved";

export type QuoteDiscount = QuoteDiscountFigures & {
  status: QuoteDiscountStatus;
  // Which request this is (its requestedAtIso) — its notifications carry it too.
  requestId: string;
  requestedByUid: string;
  requestedByName: string;
  requestedAtIso: string;
  // Added straight in by someone with sales.discount (never asked for).
  direct?: boolean;
  // Declined with a counter offer (status "countered"): what was offered instead, and by whom.
  counter?: QuoteDiscountFigures & { byUid: string; byName: string; atIso: string };
  // Accepted (status "approved") — by whom.
  approvedByUid?: string;
  approvedByName?: string;
  approvedAtIso?: string;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
// A number from what was typed or stored — NaN for nothing at all (not 0: a missing percentage isn't 0%).
const num = (value: unknown) => {
  if (value === null || value === undefined) return NaN;
  const text = typeof value === "number" ? "" : String(value).replace(/[^0-9.-]/g, "");
  if (typeof value !== "number" && !text) return NaN;
  const n = typeof value === "number" ? value : Number(text);
  return Number.isFinite(n) ? n : NaN;
};

export function isQuoteDiscountMode(value: unknown): value is QuoteDiscountMode {
  return value === "total" || value === "amount" || value === "percent";
}

// A discount from what was typed, against the quote's total then (with GST, when the company adds it) — null when it
// isn't one (nothing off, or all of it). It always comes off the price before GST, and GST goes on what's left:
// - New total: the total the client pays (with GST) — exactly what was typed;
// - Amount off: off the price before GST — $1,000 off is $1,000 off it, so the total (with 15% GST) comes down $1,150;
// - Percent off: off the price, the same either way.
export function quoteDiscountFigures(originalTotal: unknown, gstPercent: unknown, mode: QuoteDiscountMode, typed: unknown): QuoteDiscountFigures | null {
  const total = round2(num(originalTotal));
  const value = num(typed);
  const gst = Math.max(0, num(gstPercent) || 0);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(value)) return null;
  const withGst = 1 + gst / 100;
  let amountOff: number;
  let amountOffBeforeGst: number;
  let percent: number | undefined;
  if (mode === "amount") {
    amountOffBeforeGst = round2(value);
    amountOff = round2(amountOffBeforeGst * withGst);
  } else {
    if (mode === "total") amountOff = round2(total - value);
    else {
      percent = round2(value);
      amountOff = round2((total * value) / 100);
    }
    amountOffBeforeGst = round2(amountOff / withGst);
  }
  if (!(amountOff > 0) || !(amountOffBeforeGst > 0) || amountOff >= total) return null;
  return {
    mode,
    ...(percent !== undefined ? { percent } : {}),
    originalTotal: total,
    amountOff,
    newTotal: round2(total - amountOff),
    amountOffBeforeGst,
    gstPercent: gst,
  };
}

// How a discount reads in a notification: before GST, as it comes off ("$1,000.00 + GST"), when the company adds GST.
export function quoteDiscountAmountText(figures: { amountOff: number; amountOffBeforeGst?: number; gstPercent: number }, money: (value: number) => string): string {
  if (!(figures.gstPercent > 0)) return money(figures.amountOff);
  const beforeGst = figures.amountOffBeforeGst ?? round2(figures.amountOff / (1 + figures.gstPercent / 100));
  return `${money(beforeGst)} + GST`;
}

function figuresFrom(raw: Record<string, unknown>): QuoteDiscountFigures | null {
  const mode = isQuoteDiscountMode(raw.mode) ? raw.mode : "total";
  const originalTotal = num(raw.originalTotal);
  const amountOff = num(raw.amountOff);
  const newTotal = num(raw.newTotal);
  const amountOffBeforeGst = num(raw.amountOffBeforeGst);
  if (![originalTotal, amountOff, newTotal, amountOffBeforeGst].every(Number.isFinite) || amountOffBeforeGst <= 0) return null;
  const percent = num(raw.percent);
  return {
    mode,
    ...(Number.isFinite(percent) ? { percent } : {}),
    originalTotal,
    amountOff,
    newTotal,
    amountOffBeforeGst,
    gstPercent: Math.max(0, num(raw.gstPercent) || 0),
  };
}

// The project doc's quoteDiscount, checked — null for none (or one that doesn't make sense).
export function normalizeQuoteDiscount(raw: unknown): QuoteDiscount | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const status = row.status === "pending" || row.status === "countered" || row.status === "approved" ? row.status : null;
  const figures = figuresFrom(row);
  const requestId = String(row.requestId ?? "").trim();
  if (!status || !figures || !requestId) return null;
  const counterRaw = row.counter && typeof row.counter === "object" ? (row.counter as Record<string, unknown>) : null;
  const counterFigures = counterRaw ? figuresFrom(counterRaw) : null;
  const counter =
    counterRaw && counterFigures
      ? { ...counterFigures, byUid: String(counterRaw.byUid ?? ""), byName: String(counterRaw.byName ?? ""), atIso: String(counterRaw.atIso ?? "") }
      : undefined;
  if (status === "countered" && !counter) return null;
  return {
    ...figures,
    status,
    requestId,
    requestedByUid: String(row.requestedByUid ?? ""),
    requestedByName: String(row.requestedByName ?? ""),
    requestedAtIso: String(row.requestedAtIso ?? ""),
    ...(row.direct === true ? { direct: true } : {}),
    ...(counter ? { counter } : {}),
    ...(row.approvedByUid ? { approvedByUid: String(row.approvedByUid) } : {}),
    ...(row.approvedByName ? { approvedByName: String(row.approvedByName) } : {}),
    ...(row.approvedAtIso ? { approvedAtIso: String(row.approvedAtIso) } : {}),
  };
}

// What comes off the quote now (before GST): an accepted discount's — nothing while it's still being worked out.
export function approvedQuoteDiscountBeforeGst(discount: QuoteDiscount | null | undefined): number {
  return discount?.status === "approved" ? discount.amountOffBeforeGst : 0;
}

// A discount's notification's figures (users/{uid}/notifications/{id}.discountNotice), and how it was answered.
export type QuoteDiscountNotice = {
  requestId: string;
  requesterUid: string;
  requesterName: string;
  originalTotal: number;
  amountOff: number;
  newTotal: number;
  // What comes off before GST (worked out from amountOff for a notification from before it was noted).
  amountOffBeforeGst?: number;
  mode: QuoteDiscountMode;
  percent?: number;
  gstPercent: number;
  // A counter offer's: who made it.
  counterByName?: string;
  // Its project's name, for its box.
  projectName?: string;
};
export type QuoteDiscountAnswer = {
  decision: "approve" | "deny" | "counter" | "answered" | "withdrawn" | "client_accepted";
  byName?: string;
  // A counter offer's new total.
  counterTotal?: number;
};

export function normalizeQuoteDiscountNotice(raw: unknown): QuoteDiscountNotice | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const originalTotal = num(row.originalTotal);
  const amountOff = num(row.amountOff);
  const newTotal = num(row.newTotal);
  const requestId = String(row.requestId ?? "").trim();
  if (!requestId || ![originalTotal, amountOff, newTotal].every(Number.isFinite)) return undefined;
  const percent = num(row.percent);
  const amountOffBeforeGst = num(row.amountOffBeforeGst);
  return {
    requestId,
    requesterUid: String(row.requesterUid ?? ""),
    requesterName: String(row.requesterName ?? ""),
    originalTotal,
    amountOff,
    newTotal,
    ...(Number.isFinite(amountOffBeforeGst) ? { amountOffBeforeGst } : {}),
    mode: isQuoteDiscountMode(row.mode) ? row.mode : "total",
    ...(Number.isFinite(percent) ? { percent } : {}),
    gstPercent: Math.max(0, num(row.gstPercent) || 0),
    ...(row.counterByName ? { counterByName: String(row.counterByName) } : {}),
    ...(row.projectName ? { projectName: String(row.projectName) } : {}),
  };
}

export function quoteDiscountAnswerText(answer: QuoteDiscountAnswer, formatMoney: (value: number) => string): string {
  const by = answer.byName ? ` by ${answer.byName}` : "";
  switch (answer.decision) {
    case "approve":
      return `Accepted${by}`;
    case "deny":
      return `Declined${by}`;
    case "counter":
      return answer.counterTotal !== undefined ? `Counter offer of ${formatMoney(answer.counterTotal)}${by}` : `Counter offer sent${by}`;
    case "withdrawn":
      return "Withdrawn";
    case "client_accepted":
      return "The client accepted the quote first";
    default:
      return "Already answered";
  }
}

// The notification kinds (lib/push-notification-types.ts lists them for User Settings).
export const QUOTE_DISCOUNT_REQUEST_TYPE = "quote_discount_request";
export const QUOTE_DISCOUNT_COUNTER_TYPE = "quote_discount_counter";
export const QUOTE_DISCOUNT_RESPONSE_TYPE = "quote_discount_response";

// Where one opens: its project's Design tab, with the box to answer it (components/global-app-tabs-bar.tsx).
export const QUOTE_DISCOUNT_ADDRESS_PARAM = "discountRequest";
export function quoteDiscountRequestUrl(projectId: string, requestId: string): string {
  return `/projects/${encodeURIComponent(projectId)}?tab=sales&${QUOTE_DISCOUNT_ADDRESS_PARAM}=${encodeURIComponent(requestId)}`;
}

// The project page hears that a discount changed (answered from the top bar's notifications) — the project's new
// quoteDiscount, and whether the quote was taken off the client portal.
export const QUOTE_DISCOUNT_CHANGED_EVENT = "cutsmart:quote-discount-changed";
export type QuoteDiscountChangedDetail = { projectId: string; discount: QuoteDiscount | null; retracted?: boolean };
export function announceQuoteDiscountChanged(detail: QuoteDiscountChangedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<QuoteDiscountChangedDetail>(QUOTE_DISCOUNT_CHANGED_EVENT, { detail }));
}
