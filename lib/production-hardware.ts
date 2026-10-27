// Company Settings › Production / Materials & Boards / Hardware, as the app reads them: board thicknesses, finishes and
// sheet sizes, and each hardware brand's drawer types (their height letters and sizes, and maths), hinges and other
// items. Shared by a project's Production tab and the production cutlist template (lib/production-cutlist-download.ts).

function toStr(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toNum(value: unknown): number {
  const n = Number.parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export type DrawerHeightOption = { token: string; value: string };
export type HardwareDrawerType = {
  name: string;
  isDefault: boolean;
  heightLetters: string[];
  heightOptions: DrawerHeightOption[];
  bottomsWidthMinus: number | null;
  bottomsDepthMinus: number | null;
  backsWidthMinus: number | null;
  hardwareLengths: number[];
  spaceRequirement: number | null;
  // Its supplier's item number (Company Settings › Hardware) — copied from the order, to find it in their cart. "" — none.
  itemNumber: string;
};
export type HardwareTypeRow = {
  name: string;
  color: string;
  isDefault: boolean;
  drawers: HardwareDrawerType[];
  hinges: string[];
  other: string[];
  // Each hinge's and other item's supplier item number, by its name (lower case) — those that have one.
  hingeItemNumbers: Record<string, string>;
  otherItemNumbers: Record<string, string>;
};
export type SheetSizeOption = { h: string; w: string; isDefault: boolean };

export function normalizeMmOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v ?? "").replace(/mm$/i, "").trim())
    .filter(Boolean);
}

export function normalizeBoardFinishes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v ?? "").trim()).filter(Boolean);
}

export function normalizeSheetSizes(raw: unknown): SheetSizeOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      const h = toStr(item.h ?? item.height);
      const w = toStr(item.w ?? item.width);
      const isDefault = Boolean(item.isDefault ?? item.default);
      return { h, w, isDefault };
    })
    .filter((row) => row.h && row.w);
}

export function normalizeDrawerTypes(raw: unknown): HardwareDrawerType[] {
  if (!Array.isArray(raw)) return [];
  const out: HardwareDrawerType[] = [];
  const extractDrawerHeightLabel = (value: unknown): string => {
    if (value == null) return "";
    const rawText =
      typeof value === "string"
        ? value
        : toStr(
            (value as Record<string, unknown>)?.letter ??
            (value as Record<string, unknown>)?.label ??
            (value as Record<string, unknown>)?.code ??
            (value as Record<string, unknown>)?.name ??
            (value as Record<string, unknown>)?.value,
          );
    const raw = toStr(rawText);
    if (!raw) return "";
    const withoutTrailingNumber = raw.replace(/\s*\d+(\.\d+)?\s*$/g, "").trim();
    const cleaned = withoutTrailingNumber.replace(/[:|,\-]+$/g, "").trim();
    return cleaned || raw;
  };
  const extractDrawerHeightValue = (value: unknown, label: string): string => {
    if (value == null) return "";
    if (typeof value === "string") {
      const raw = toStr(value);
      if (!raw) return "";
      const prefix = String(label || "").trim();
      if (!prefix) return "";
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const remaining = raw.replace(new RegExp(`^\\s*${escaped}\\s*`, "i"), "").trim();
      return remaining;
    }
    return toStr(
      (value as Record<string, unknown>)?.value ??
      (value as Record<string, unknown>)?.height ??
      (value as Record<string, unknown>)?.mm ??
      (value as Record<string, unknown>)?.size,
    );
  };
  for (const row of raw) {
    if (typeof row === "string") {
      const name = row.trim();
      if (name) {
        out.push({
          name,
          isDefault: false,
          heightLetters: [],
          heightOptions: [],
          bottomsWidthMinus: null,
          bottomsDepthMinus: null,
          backsWidthMinus: null,
          hardwareLengths: [],
          spaceRequirement: null,
          itemNumber: "",
        });
      }
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const name = toStr(item.name ?? item.type ?? item.label);
    if (!name) continue;
    const bottoms = item.bottoms && typeof item.bottoms === "object" ? (item.bottoms as Record<string, unknown>) : {};
    const backs = item.backs && typeof item.backs === "object" ? (item.backs as Record<string, unknown>) : {};
    const heightRows = Array.isArray(backs.heights)
      ? backs.heights
      : Array.isArray(backs.letters)
        ? backs.letters
        : [];
    const heightLetters: string[] = [];
    const heightOptions: DrawerHeightOption[] = [];
    const seen = new Set<string>();
    for (const rawHeight of heightRows) {
      const label = extractDrawerHeightLabel(rawHeight);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      heightLetters.push(label);
      const value = extractDrawerHeightValue(rawHeight, label);
      heightOptions.push({ token: label, value });
    }
    const bottomsWidthMinus = toNum(bottoms.widthMinus ?? item.widthMinus);
    const bottomsDepthMinus = toNum(bottoms.depthMinus ?? item.depthMinus);
    const backsWidthMinus = toNum(backs.widthMinus);
    const hardwareLengths = Array.isArray(item.hardwareLengths)
      ? (item.hardwareLengths as unknown[])
          .map((v) => toNum(v))
          .filter((v) => Number.isFinite(v) && v > 0)
      : [];
    const spaceParsed = toNum(item.spaceRequirement ?? item.clearance);
    const spaceRequirement = Number.isFinite(spaceParsed) && spaceParsed > 0 ? spaceParsed : null;
    out.push({
      name,
      isDefault: Boolean(item.default ?? item.isDefault),
      heightLetters,
      heightOptions,
      bottomsWidthMinus: bottomsWidthMinus > 0 ? bottomsWidthMinus : null,
      bottomsDepthMinus: bottomsDepthMinus > 0 ? bottomsDepthMinus : null,
      backsWidthMinus: backsWidthMinus > 0 ? backsWidthMinus : null,
      hardwareLengths,
      spaceRequirement,
      itemNumber: toStr(item.itemNumber),
    });
  }
  return out;
}

export function normalizeHardwareRows(raw: unknown): HardwareTypeRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      const name = toStr(item.name);
      const hingesRaw = Array.isArray(item.hinges) ? item.hinges : [];
      const hinges = hingesRaw
        .map((entry) => {
          if (typeof entry === "string") return entry.trim();
          if (entry && typeof entry === "object") {
            return toStr((entry as Record<string, unknown>).name ?? (entry as Record<string, unknown>).label);
          }
          return "";
        })
        .filter(Boolean);
      const otherRaw = Array.isArray(item.other) ? item.other : [];
      const other = otherRaw
        .map((entry) => {
          if (typeof entry === "string") return entry.trim();
          if (entry && typeof entry === "object") {
            return toStr((entry as Record<string, unknown>).name ?? (entry as Record<string, unknown>).label);
          }
          return "";
        })
        .filter(Boolean);
      return {
        name,
        color: toStr(item.color),
        isDefault: Boolean(item.default),
        drawers: normalizeDrawerTypes(item.drawers),
        hinges,
        other,
        hingeItemNumbers: itemNumbersByName(hingesRaw),
        otherItemNumbers: itemNumbersByName(otherRaw),
      };
    })
    .filter((row) => row.name);
}

// Hinges' or other items' supplier item numbers, by name (lower case) — those saved with one.
function itemNumbersByName(raw: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = toStr(row.name ?? row.label).toLowerCase();
    const itemNumber = toStr(row.itemNumber);
    if (name && itemNumber) out[name] = itemNumber;
  }
  return out;
}

// A hardware brand's item's supplier item number, by its kind and name ("" — none, or not found).
export function hardwareItemNumber(row: HardwareTypeRow | null | undefined, kind: "drawer" | "hinge" | "other", name: string): string {
  if (!row) return "";
  const key = String(name || "").trim().toLowerCase();
  if (!key) return "";
  if (kind === "drawer") return row.drawers.find((drawer) => drawer.name.trim().toLowerCase() === key)?.itemNumber ?? "";
  return (kind === "hinge" ? row.hingeItemNumbers : row.otherItemNumbers)[key] ?? "";
}
