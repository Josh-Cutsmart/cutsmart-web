// Sums typed in the cutlists' Height / Width / Depth boxes ("50-16"): what can be typed in one, and the sum worked out —
// as the box is left (the project page), or with = on a phone's bar over the keyboard
// (components/cutlist-mobile/dimension-math-bar.tsx).

function numericDecimalText(value: unknown, maxDecimals?: number): string {
  const raw = String(value ?? "").replace(/[^\d.]/g, "");
  const firstDot = raw.indexOf(".");
  if (firstDot === -1) return raw;
  const integerPart = raw.slice(0, firstDot + 1);
  const decimalPart = raw.slice(firstDot + 1).replace(/[.]/g, "");
  const limitedDecimals = typeof maxDecimals === "number" && maxDecimals >= 0 ? decimalPart.slice(0, maxDecimals) : decimalPart;
  return `${integerPart}${limitedDecimals}`;
}

// What can be typed in a Height / Width / Depth box: numbers (a decimal place each) and, for a sum, + - * x / between them
// ("50-16") — worked out as the box is left (evaluateDimensionMath).
export function dimensionMathText(value: unknown): string {
  const raw = String(value ?? "")
    .replace(/[×X]/g, "x")
    .replace(/[^\d.+\-*/x]/g, "");
  return raw
    .split(/([+\-*/x])/)
    .map((part, index) => (index % 2 ? part : numericDecimalText(part, 1)))
    .join("");
}
// As dimensionMathText, for a box of whole numbers (a quantity, a shelf count, a hinge position): digits and + - * x /. An
// answer with a decimal place (what a sum came to, put in as the box is left) goes to the nearest whole number.
export function wholeMathText(value: unknown): string {
  const text = String(value ?? "").replace(/[×X]/g, "x");
  if (/^\d*\.\d+$/.test(text)) return String(Math.round(Number.parseFloat(text)));
  return text.replace(/[^\d+\-*/x]/g, "");
}
// A sum typed in one of those boxes, worked out as a calculator does: left to right, each step on the total so far
// ("300-2-2-2/2" is 147, not 295) — * and x multiply, / divides — to 1 decimal place, never below 0. null when it isn't a
// whole sum (just a number, one still being typed, or a divide by 0).
export function evaluateDimensionMath(text: string): string | null {
  const t = String(text ?? "").replace(/\s/g, "").replace(/[×X]/g, "x");
  if (!/^\d*\.?\d+(?:[+\-*/x]\d*\.?\d+)+$/.test(t)) return null;
  const tokens = t.split(/([+\-*/x])/);
  let total = Number.parseFloat(tokens[0]);
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const n = Number.parseFloat(tokens[i + 1]);
    if (op === "+") total += n;
    else if (op === "-") total -= n;
    else if (op === "*" || op === "x") total *= n;
    else {
      if (n === 0) return null;
      total /= n;
    }
  }
  if (!Number.isFinite(total)) return null;
  return String(Math.max(0, Math.round(total * 10) / 10));
}

// A row's sums kept by field (CutlistRow.sums): only the ones that are whole sums in the boxes that take them.
export const SUM_FIELDS = ["height", "width", "depth", "quantity"] as const;
export type SumField = (typeof SUM_FIELDS)[number];
export function normalizeRowSums(raw: unknown): Partial<Record<SumField, string>> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Partial<Record<SumField, string>> = {};
  for (const field of SUM_FIELDS) {
    const sum = String((raw as Record<string, unknown>)[field] ?? "").replace(/\s/g, "");
    if (sum && evaluateDimensionMath(sum) !== null) out[field] = sum;
  }
  return Object.keys(out).length ? out : undefined;
}
// The sum that came to what's in a box now — none once the box holds anything else (a quantity's answer to the nearest
// whole number, as its box takes it).
export function sumShownFor(sums: Partial<Record<string, string>> | undefined, field: string, value: unknown): string | undefined {
  const sum = sums?.[field];
  if (!sum) return undefined;
  const answer = evaluateDimensionMath(sum);
  const shown = Number.parseFloat(String(value ?? "").trim());
  if (answer === null || !Number.isFinite(shown)) return undefined;
  const worked = Number.parseFloat(answer);
  return Math.abs(worked - shown) < 1e-9 || (Number.isInteger(shown) && Math.round(worked) === shown) ? sum : undefined;
}
// A sum laid out to read: its numbers with × ÷ − in place of * / -, each step on the total so far (it's worked out left to
// right, as a calculator does — "720 − 18 = 702", then the next step from 702), and what it came to.
export function dimensionSumSteps(sum: string): { text: string; steps: string[]; answer: string } | null {
  const t = String(sum ?? "").replace(/\s/g, "").replace(/[×X]/g, "x");
  const answer = evaluateDimensionMath(t);
  if (answer === null) return null;
  const tokens = t.split(/([+\-*/x])/);
  const symbol = (op: string) => (op === "+" ? "+" : op === "-" ? "−" : op === "/" ? "÷" : "×");
  const shown = (n: number) => String(Math.round(n * 10) / 10);
  const text = tokens.map((part, i) => (i % 2 ? ` ${symbol(part)} ` : part)).join("");
  const steps: string[] = [];
  let total = Number.parseFloat(tokens[0]);
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const n = Number.parseFloat(tokens[i + 1]);
    const before = total;
    if (op === "+") total += n;
    else if (op === "-") total -= n;
    else if (op === "/") total /= n;
    else total *= n;
    steps.push(`${shown(before)} ${symbol(op)} ${tokens[i + 1]} = ${shown(total)}`);
  }
  return { text, steps, answer };
}
