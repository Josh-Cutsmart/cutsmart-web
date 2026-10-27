// New Zealand's public holidays, worked out for any year (Holidays Act 2003; Te Kāhui o Matariki Public Holiday Act 2022)
// — the calendar shows them on their days: the national ones, and the company's region's anniversary day (Company
// Settings > Calendar > Public holidays — or none at all).
//
// Mondayised (Sat / Sun → the Monday after; a pair both on a weekend → the Monday and Tuesday): Waitangi Day and ANZAC
// Day, New Year's Day and the day after, Christmas Day and Boxing Day. A holiday that's moved shows on its own day too,
// with "(observed)" on the day it's taken.

// Matariki's Fridays, as the Act's schedule sets them (the Matariki Advisory Committee's dates) — months 0-based. Later
// years are set by Order in Council, at least 4 years ahead: add them here as they're set.
const MATARIKI: Record<number, [number, number]> = {
  2022: [5, 24], 2023: [6, 14], 2024: [5, 28], 2025: [5, 20], 2026: [6, 10], 2027: [5, 25], 2028: [6, 14],
  2029: [6, 6], 2030: [5, 21], 2031: [6, 11], 2032: [6, 2], 2033: [5, 24], 2034: [6, 7], 2035: [5, 29],
  2036: [6, 18], 2037: [6, 10], 2038: [5, 25], 2039: [6, 15], 2040: [6, 6], 2041: [6, 19], 2042: [6, 11],
  2043: [6, 3], 2044: [5, 24], 2045: [6, 7], 2046: [5, 29], 2047: [6, 19], 2048: [6, 3], 2049: [5, 25],
  2050: [6, 15], 2051: [5, 30], 2052: [5, 21],
};

// One-off holidays.
const ONE_OFF: Array<{ y: number; m: number; d: number; name: string }> = [
  { y: 2022, m: 8, d: 26, name: "Queen Elizabeth II Memorial Day" },
];

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Easter Sunday (the Gregorian computus — the anonymous algorithm).
function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// The Monday nearest a date (how most anniversary days are observed).
function nearestMonday(date: Date) {
  const ahead = (8 - date.getDay()) % 7;
  return addDays(date, ahead <= 3 ? ahead : ahead - 7);
}

// The nth Monday of a month (n from 1).
function nthMonday(year: number, month: number, n: number) {
  const first = new Date(year, month, 1);
  return addDays(first, ((8 - first.getDay()) % 7) + (n - 1) * 7);
}

export type Holiday = { date: Date; name: string };

// A holiday that moves to the Monday when it's on a weekend.
function mondayised(date: Date, name: string): Holiday[] {
  const dow = date.getDay();
  if (dow !== 0 && dow !== 6) return [{ date, name }];
  return [
    { date, name },
    { date: addDays(date, dow === 6 ? 2 : 1), name: `${name} (observed)` },
  ];
}

// A pair of days (New Year's, Christmas): either on a weekend is taken on the next weekday the other isn't.
function mondayisedPair(first: Date, firstName: string, secondName: string): Holiday[] {
  const second = addDays(first, 1);
  const dow = first.getDay();
  const out: Holiday[] = [
    { date: first, name: firstName },
    { date: second, name: secondName },
  ];
  // Sat + Sun → Mon + Tue.
  if (dow === 6) {
    out.push({ date: addDays(first, 2), name: `${firstName} (observed)` }, { date: addDays(first, 3), name: `${secondName} (observed)` });
  }
  // Sun + Mon → the first on Tue.
  if (dow === 0) out.push({ date: addDays(first, 2), name: `${firstName} (observed)` });
  // Fri + Sat → the second on Mon.
  if (dow === 5) out.push({ date: addDays(first, 3), name: `${secondName} (observed)` });
  return out;
}

// Company Settings > Calendar > Public holidays: which to show — none, the national ones, or those and a region's
// anniversary day (employment.govt.nz's rules for each).
export type NzHolidayRegion =
  | "none"
  | "nz"
  | "auckland"
  | "wellington"
  | "nelson"
  | "taranaki"
  | "hawkesBay"
  | "marlborough"
  | "canterbury"
  | "southCanterbury"
  | "westland"
  | "otago"
  | "southland"
  | "chatham";

export const NZ_HOLIDAY_REGION_OPTIONS: Array<{ value: NzHolidayRegion; label: string }> = [
  { value: "nz", label: "National holidays only" },
  { value: "auckland", label: "Auckland" },
  { value: "wellington", label: "Wellington" },
  { value: "nelson", label: "Nelson" },
  { value: "taranaki", label: "Taranaki" },
  { value: "hawkesBay", label: "Hawke's Bay" },
  { value: "marlborough", label: "Marlborough" },
  { value: "canterbury", label: "Canterbury" },
  { value: "southCanterbury", label: "South Canterbury" },
  { value: "westland", label: "Westland" },
  { value: "otago", label: "Otago" },
  { value: "southland", label: "Southland" },
  { value: "chatham", label: "Chatham Islands" },
  { value: "none", label: "Don't show public holidays" },
];

// A saved region (anything else — or nothing saved yet — is the national holidays only).
export function normalizeNzHolidayRegion(raw: unknown): NzHolidayRegion {
  return NZ_HOLIDAY_REGION_OPTIONS.some((o) => o.value === raw) ? (raw as NzHolidayRegion) : "nz";
}

// A region's anniversary day in a year.
function anniversaryDay(year: number, region: NzHolidayRegion, easter: Date, labourDay: Date): Holiday | null {
  switch (region) {
    case "auckland":
      return { date: nearestMonday(new Date(year, 0, 29)), name: "Auckland Anniversary Day" };
    case "wellington":
      return { date: nearestMonday(new Date(year, 0, 22)), name: "Wellington Anniversary Day" };
    case "nelson":
      return { date: nearestMonday(new Date(year, 1, 1)), name: "Nelson Anniversary Day" };
    case "taranaki":
      return { date: nthMonday(year, 2, 2), name: "Taranaki Anniversary Day" };
    case "hawkesBay":
      return { date: addDays(labourDay, -3), name: "Hawke's Bay Anniversary Day" };
    case "marlborough":
      return { date: addDays(labourDay, 7), name: "Marlborough Anniversary Day" };
    case "canterbury": {
      // Show Day: the second Friday after the first Tuesday in November.
      const nov1 = new Date(year, 10, 1);
      const firstTuesday = addDays(nov1, (9 - nov1.getDay()) % 7);
      return { date: addDays(firstTuesday, 10), name: "Canterbury Anniversary Day (Show Day)" };
    }
    case "southCanterbury":
      return { date: nthMonday(year, 8, 4), name: "South Canterbury Anniversary Day" };
    case "westland":
      return { date: nearestMonday(new Date(year, 11, 1)), name: "Westland Anniversary Day" };
    case "otago": {
      // The Monday nearest 23 March — Easter Tuesday when that's Easter Monday.
      const monday = nearestMonday(new Date(year, 2, 23));
      const easterMonday = addDays(easter, 1);
      return { date: monday.getTime() === easterMonday.getTime() ? addDays(easter, 2) : monday, name: "Otago Anniversary Day" };
    }
    case "southland":
      return { date: addDays(easter, 2), name: "Southland Anniversary Day" };
    case "chatham":
      return { date: nearestMonday(new Date(year, 10, 30)), name: "Chatham Islands Anniversary Day" };
    default:
      return null;
  }
}

// Every public holiday in a year, by date — the national ones, and the region's anniversary day.
export function nzPublicHolidays(year: number, region: NzHolidayRegion = "nz"): Holiday[] {
  if (region === "none") return [];
  const easter = easterSunday(year);
  const matariki = MATARIKI[year];
  const labourDay = nthMonday(year, 9, 4);
  const anniversary = anniversaryDay(year, region, easter, labourDay);
  return [
    ...mondayisedPair(new Date(year, 0, 1), "New Year's Day", "Day after New Year's Day"),
    ...mondayised(new Date(year, 1, 6), "Waitangi Day"),
    { date: addDays(easter, -2), name: "Good Friday" },
    { date: addDays(easter, 1), name: "Easter Monday" },
    ...mondayised(new Date(year, 3, 25), "ANZAC Day"),
    { date: nthMonday(year, 5, 1), name: year >= 2023 ? "King's Birthday" : "Queen's Birthday" },
    ...(matariki ? [{ date: new Date(year, matariki[0], matariki[1]), name: "Matariki" }] : []),
    { date: labourDay, name: "Labour Day" },
    ...mondayisedPair(new Date(year, 11, 25), "Christmas Day", "Boxing Day"),
    ...ONE_OFF.filter((h) => h.y === year).map((h) => ({ date: new Date(h.y, h.m, h.d), name: h.name })),
    ...(anniversary ? [anniversary] : []),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
}

// Each region's year's holidays by day ("y-m-d"), worked out once.
const byYear = new Map<string, Map<string, string>>();

// The public holiday on a day ("" if none) — two on one day are joined with " · ".
export function nzPublicHolidayName(day: Date, region: NzHolidayRegion = "nz"): string {
  const year = day.getFullYear();
  let days = byYear.get(`${region}:${year}`);
  if (!days) {
    days = new Map();
    for (const h of nzPublicHolidays(year, region)) {
      const key = `${h.date.getFullYear()}-${h.date.getMonth()}-${h.date.getDate()}`;
      days.set(key, days.has(key) ? `${days.get(key)} · ${h.name}` : h.name);
    }
    byYear.set(`${region}:${year}`, days);
  }
  return days.get(`${year}-${day.getMonth()}-${day.getDate()}`) ?? "";
}
