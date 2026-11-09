// A New Zealand mobile number, laid out as it's written: 021 066 4812 — or with the country code, 6421 066 4812 (+6421 066
// 4812 with its +). Three groups: the start (021, or 6421), the next three digits, then the rest — any extra digits always
// on the end group (021 066 48124354…). Only numbers that start as a mobile does (02…, 642…, +642…): anything else (a
// landline, 0800, letters) is left exactly as it was typed.

export function nzMobileDigitsStart(digits: string, plus: boolean): number {
  if (digits.startsWith("642")) return 4;
  if (!plus && digits.startsWith("02")) return 3;
  return 0;
}

// The digits laid out (the + kept in front if there was one). `null`: not a mobile — leave it as it is.
export function layOutNzMobile(digits: string, plus: boolean): string | null {
  const start = nzMobileDigitsStart(digits, plus);
  if (!start) return null;
  const groups = [digits.slice(0, start), digits.slice(start, start + 3), digits.slice(start + 3)].filter(Boolean);
  return `${plus ? "+" : ""}${groups.join(" ")}`;
}

// What's typed, split into its + and its digits — `null` if it has anything but digits and the spaces, dashes, dots and
// brackets people put between them.
export function phoneParts(value: string): { plus: boolean; digits: string } | null {
  const trimmed = value.trimStart();
  const plus = trimmed.startsWith("+");
  const body = plus ? trimmed.slice(1) : trimmed;
  if (!/^[\d\s\-().]*$/.test(body)) return null;
  return { plus, digits: body.replace(/\D/g, "") };
}

export function formatNzMobile(value: string): string {
  const parts = phoneParts(value);
  if (!parts) return value;
  return layOutNzMobile(parts.digits, parts.plus) ?? value;
}
