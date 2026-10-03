import { useSyncExternalStore } from "react";

// The company's regional formats — currency, measurement unit and date format — chosen in
// Company Settings > Company > Regional formats, and the helpers that apply them everywhere a price,
// length or date is shown. Values are stored on the company doc (defaultCurrency, measurementUnit,
// dateFormat); older docs hold free text ("NZD - New Zealand Dollar", "inches"), which the normalizers
// below still read.

export type CurrencyOption = { code: string; label: string; locale: string };
export type MeasurementUnit = "mm" | "in";

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: "NZD", label: "NZD — New Zealand Dollar", locale: "en-NZ" },
  { code: "AUD", label: "AUD — Australian Dollar", locale: "en-AU" },
  { code: "USD", label: "USD — US Dollar", locale: "en-US" },
  { code: "CAD", label: "CAD — Canadian Dollar", locale: "en-CA" },
  { code: "GBP", label: "GBP — British Pound", locale: "en-GB" },
  { code: "EUR", label: "EUR — Euro", locale: "en-IE" },
  { code: "ZAR", label: "ZAR — South African Rand", locale: "en-ZA" },
  { code: "SGD", label: "SGD — Singapore Dollar", locale: "en-SG" },
];

export const DATE_FORMAT_OPTIONS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "D MMM YYYY", "MMM D, YYYY"] as const;
export type DateFormat = (typeof DATE_FORMAT_OPTIONS)[number];

export const DEFAULT_CURRENCY = "NZD";
export const DEFAULT_UNIT: MeasurementUnit = "mm";
export const DEFAULT_DATE_FORMAT: DateFormat = "DD/MM/YYYY";

export function normalizeCurrencyCode(raw: unknown): string {
  const text = String(raw ?? "").trim().toUpperCase();
  const code = text.slice(0, 3);
  return CURRENCY_OPTIONS.some((c) => c.code === code) ? code : DEFAULT_CURRENCY;
}

export function normalizeMeasurementUnit(raw: unknown): MeasurementUnit {
  const text = String(raw ?? "").trim().toLowerCase();
  return text === "in" || text === "inch" || text === "inches" || text === '"' ? "in" : "mm";
}

export function normalizeDateFormat(raw: unknown): DateFormat {
  const text = String(raw ?? "").trim();
  return (DATE_FORMAT_OPTIONS as readonly string[]).includes(text) ? (text as DateFormat) : DEFAULT_DATE_FORMAT;
}

// Every currency is formatted with the same digit style (1,234.50) and only its symbol changes. Saved
// prices are stored as these strings and read back by stripping everything but digits, "." and "-",
// so a locale with a decimal comma or space grouping (e.g. en-ZA's "R 1 234,50") would be misread.
const MONEY_LOCALE = "en-NZ";

export function currencyOption(code: string): CurrencyOption {
  return CURRENCY_OPTIONS.find((c) => c.code === code) ?? CURRENCY_OPTIONS[0];
}

// The currency's symbol on its own (e.g. "$", "£", "€", "R"), for input prefixes.
export function currencySymbol(code: string): string {
  const opt = currencyOption(code);
  try {
    const part = new Intl.NumberFormat(MONEY_LOCALE, { style: "currency", currency: opt.code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value || "$";
  } catch {
    return "$";
  }
}

export function formatMoney(
  value: number | string | null | undefined,
  code: string = DEFAULT_CURRENCY,
  options?: { decimals?: number; showSymbol?: boolean },
): string {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  const safe = Number.isFinite(n) ? n : 0;
  const opt = currencyOption(code);
  const decimals = options?.decimals ?? 2;
  try {
    return new Intl.NumberFormat(MONEY_LOCALE, {
      style: options?.showSymbol === false ? "decimal" : "currency",
      currency: opt.code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(safe);
  } catch {
    return `$${safe.toFixed(decimals)}`;
  }
}

const MM_PER_INCH = 25.4;

// Lengths are always stored in millimetres; these convert for display/entry in the chosen unit.
export function mmToUnit(mm: number, unit: MeasurementUnit): number {
  return unit === "in" ? mm / MM_PER_INCH : mm;
}
export function unitToMm(value: number, unit: MeasurementUnit): number {
  return unit === "in" ? value * MM_PER_INCH : value;
}
export function unitLabel(unit: MeasurementUnit): string {
  return unit === "in" ? "in" : "mm";
}
export function formatLength(mm: number | string | null | undefined, unit: MeasurementUnit = DEFAULT_UNIT, options?: { withUnit?: boolean }): string {
  const n = typeof mm === "number" ? mm : Number(String(mm ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return String(mm ?? "");
  const value = mmToUnit(n, unit);
  const text = unit === "in" ? String(Math.round(value * 100) / 100) : String(Math.round(value * 10) / 10);
  return options?.withUnit === false ? text : `${text} ${unitLabel(unit)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Formats a date (Date, ISO string or timestamp) in the company's date format, in the viewer's own
// local time zone.
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

// ---------------------------------------------------------------------------------------------------
// The active company's formats, app-wide. The app shell fills this in from the company doc (and caches
// it on the device so the very first paint already uses the right formats); Company Settings updates
// it live as the settings change. Plain helpers (activeMoney/activeDate/...) read it directly, so
// module-level formatting functions don't need it passed in; components that show formatted values
// call useCompanyFormats() so they re-render when it changes.

export type CompanyFormats = { currency: string; unit: MeasurementUnit; dateFormat: DateFormat };
const FORMATS_STORAGE_KEY = "cutsmart_company_formats";
const DEFAULT_FORMATS: CompanyFormats = { currency: DEFAULT_CURRENCY, unit: DEFAULT_UNIT, dateFormat: DEFAULT_DATE_FORMAT };

function readCachedFormats(): CompanyFormats {
  if (typeof window === "undefined") return DEFAULT_FORMATS;
  try {
    const raw = window.localStorage.getItem(FORMATS_STORAGE_KEY);
    if (!raw) return DEFAULT_FORMATS;
    const parsed = JSON.parse(raw) as Partial<CompanyFormats>;
    return {
      currency: normalizeCurrencyCode(parsed.currency),
      unit: normalizeMeasurementUnit(parsed.unit),
      dateFormat: normalizeDateFormat(parsed.dateFormat),
    };
  } catch {
    return DEFAULT_FORMATS;
  }
}

let activeFormats: CompanyFormats | null = null;
const formatListeners = new Set<() => void>();

export function getActiveCompanyFormats(): CompanyFormats {
  if (!activeFormats) activeFormats = readCachedFormats();
  return activeFormats;
}

// Accepts raw company-doc values (old free-text values are normalized).
export function setActiveCompanyFormats(raw: { currency?: unknown; unit?: unknown; dateFormat?: unknown }) {
  const current = getActiveCompanyFormats();
  const next: CompanyFormats = {
    currency: raw.currency !== undefined ? normalizeCurrencyCode(raw.currency) : current.currency,
    unit: raw.unit !== undefined ? normalizeMeasurementUnit(raw.unit) : current.unit,
    dateFormat: raw.dateFormat !== undefined ? normalizeDateFormat(raw.dateFormat) : current.dateFormat,
  };
  if (next.currency === current.currency && next.unit === current.unit && next.dateFormat === current.dateFormat) return;
  activeFormats = next;
  try {
    window.localStorage.setItem(FORMATS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the in-memory value still applies for this session
  }
  formatListeners.forEach((listener) => listener());
}

function subscribeFormats(listener: () => void) {
  formatListeners.add(listener);
  return () => formatListeners.delete(listener);
}

export function useCompanyFormats(): CompanyFormats {
  return useSyncExternalStore(subscribeFormats, getActiveCompanyFormats, () => DEFAULT_FORMATS);
}

export function activeMoney(value: number | string | null | undefined, options?: { decimals?: number; showSymbol?: boolean }): string {
  return formatMoney(value, getActiveCompanyFormats().currency, options);
}
export function activeCurrencySymbol(): string {
  return currencySymbol(getActiveCompanyFormats().currency);
}
export function activeUnit(): MeasurementUnit {
  return getActiveCompanyFormats().unit;
}
export function activeUnitLabel(): string {
  return unitLabel(getActiveCompanyFormats().unit);
}
export function activeLength(mm: number | string | null | undefined, options?: { withUnit?: boolean }): string {
  return formatLength(mm, getActiveCompanyFormats().unit, options);
}
export function activeDate(value: Date | string | number | null | undefined): string {
  return formatDate(value, getActiveCompanyFormats().dateFormat);
}
// "<date> | 3:05pm" — the date in the company's format, the time in the viewer's own local time.
export function activeDateTime(value: Date | string | number | null | undefined, separator = " | "): string {
  const date = activeDate(value);
  if (!date) return "";
  const d = value instanceof Date ? value : new Date(value as string | number);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .format(d)
    .toLowerCase()
    .replace(/\s+/g, "");
  return `${date}${separator}${time}`;
}
