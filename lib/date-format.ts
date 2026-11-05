// The company's date formats (Company Settings > Company > Regional formats), on their own: plain functions the server can
// use too, as lib/company-formats.ts — which passes these on — has React in it, which it can't.

export const DATE_FORMAT_OPTIONS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "D MMM YYYY", "MMM D, YYYY"] as const;
export type DateFormat = (typeof DATE_FORMAT_OPTIONS)[number];

export const DEFAULT_DATE_FORMAT: DateFormat = "DD/MM/YYYY";

export function normalizeDateFormat(raw: unknown): DateFormat {
  const text = String(raw ?? "").trim();
  return (DATE_FORMAT_OPTIONS as readonly string[]).includes(text) ? (text as DateFormat) : DEFAULT_DATE_FORMAT;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Formats a date (Date, ISO string or timestamp) in the company's date format, in the local time zone of wherever it's run.
export function formatDate(value: Date | string | number | null | undefined, format: DateFormat = DEFAULT_DATE_FORMAT): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  switch (format) {
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${y}`;
    case "YYYY-MM-DD":
      return `${y}-${mm}-${dd}`;
    case "D MMM YYYY":
      return `${d.getDate()} ${MONTHS[d.getMonth()]} ${y}`;
    case "MMM D, YYYY":
      return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${y}`;
    default:
      return `${dd}/${mm}/${y}`;
  }
}
