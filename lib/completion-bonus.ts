// Company Settings › Dashboard › Completion bonus (seen only with dashboard.complete.bonus — owners and admins have it),
// and what the Dashboard's Completed pop-up (components/completed-projects-modal.tsx) works the bonus out from:
// - the bonus period: how many months it is (bonusPeriodMonths), starting in which month (completedPeriodStartMonth,
//   0–11) — a job completed within one counts towards that period's pay;
// - when it's paid: how many months after the period ends (bonusPaidMonthsAfter — Dec–Feb paid in March: 1);
// - the least a job's quote can be to qualify (bonusMinimumQuote) — a job quoted under it is flagged in the pop-up.
// No Firebase in here, so the settings page and the pop-up read the company doc the same way.

export type CompletionBonusSettings = {
  periodMonths: number;
  startMonth: number;
  paidMonthsAfter: number;
  // null: no minimum.
  minimumQuote: number | null;
};

export const BONUS_PERIOD_MONTH_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Every month" },
  { value: 2, label: "Every 2 months" },
  { value: 3, label: "Every 3 months (quarterly)" },
  { value: 4, label: "Every 4 months" },
  { value: 6, label: "Every 6 months" },
  { value: 12, label: "Every year" },
];
export const BONUS_PAID_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "In the period's last month" },
  { value: 1, label: "The month after it ends" },
  { value: 2, label: "2 months after it ends" },
  { value: 3, label: "3 months after it ends" },
];

export function completionBonusSettingsFrom(companyDoc: unknown): CompletionBonusSettings {
  const doc = (companyDoc ?? {}) as Record<string, unknown>;
  const months = Number(doc.bonusPeriodMonths);
  const start = Number(doc.completedPeriodStartMonth);
  const paid = Number(doc.bonusPaidMonthsAfter);
  const minimum = Number(doc.bonusMinimumQuote);
  return {
    periodMonths: BONUS_PERIOD_MONTH_OPTIONS.some((option) => option.value === months) ? months : 3,
    startMonth: Number.isInteger(start) && start >= 0 && start < 12 ? start : 0,
    paidMonthsAfter: BONUS_PAID_OPTIONS.some((option) => option.value === paid) ? paid : 1,
    minimumQuote: doc.bonusMinimumQuote !== null && doc.bonusMinimumQuote !== "" && Number.isFinite(minimum) && minimum > 0 ? minimum : null,
  };
}

// A quote's total as its grid shows it ("$18,450.00", "NZ$ 1 234,50") — as a number; NaN when there's none.
export function quoteAmountFrom(text: string): number {
  const cleaned = String(text || "").replace(/[^\d.,]/g, "");
  if (!cleaned) return Number.NaN;
  // A comma before the last two digits, and no point: a decimal comma ("1.234,50" / "1234,50").
  const decimalComma = /,\d{1,2}$/.test(cleaned) && !/\.\d{1,2}$/.test(cleaned);
  const normal = decimalComma ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  const value = Number.parseFloat(normal);
  return Number.isFinite(value) ? value : Number.NaN;
}

// A bonus period's name, by how long they are: "Quarter 1 2026", "Half 2 2026", "Period 3 2026", "October 2026",
// "2026" — numbered within the year it ends in — and its short one ("Q1 2026"…).
export function bonusPeriodNames(periodMonths: number) {
  const word = periodMonths === 3 ? "Quarter" : periodMonths === 6 ? "Half" : "Period";
  const letter = periodMonths === 3 ? "Q" : periodMonths === 6 ? "H" : "P";
  return { word, letter, plural: periodMonths === 3 ? "quarters" : "periods" };
}

// A bonus period's key — its first month, "2026-09", as kept on a job locked into it (not "nq": non qualified).
export function isBonusPeriodKey(value: unknown): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value ?? ""));
}

const MONTH_SHORT = Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(2024, m, 1)));
const MONTH_LONG = Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2024, m, 1)));

// A bonus period's name from its key, by the company's settings: "Quarter 4 2026" (short: "Q4 2026") — numbered within
// the year it ends in; a month's "October 2026" ("Oct 2026"); a year's "Year to Aug 2027" ("2027"). "" for no key.
export function bonusPeriodLabel(key: string, settings: Pick<CompletionBonusSettings, "periodMonths" | "startMonth">, short = false): string {
  const match = String(key || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const start = Number(match[1]) * 12 + Number(match[2]) - 1;
  const length = settings.periodMonths;
  const monthOf = (index: number) => ((index % 12) + 12) % 12;
  const yearOf = (index: number) => Math.floor(index / 12);
  if (length === 1) return `${(short ? MONTH_SHORT : MONTH_LONG)[monthOf(start)]} ${yearOf(start)}`;
  if (length === 12) return short ? `${yearOf(start + 11)}` : `Year to ${MONTH_SHORT[monthOf(start + 11)]} ${yearOf(start + 11)}`;
  const names = bonusPeriodNames(length);
  const number = Math.floor((((monthOf(start) - settings.startMonth) % 12) + 12) % 12 / length) + 1;
  return `${short ? names.letter : `${names.word} `}${number} ${yearOf(start + length - 1)}`;
}
