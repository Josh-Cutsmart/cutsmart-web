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
