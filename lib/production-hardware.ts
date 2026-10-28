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

// A drawer type's height: its letter, its back height, the runner lengths it comes in (the drawer type's, less any
// switched off for it in Company Settings) — each with the weights it comes in (Blum's M: 350–450 in 30 kg only, 500 and
// 550 in 30 or 65) and its supplier's ID numbers: one for the length (a drawer type with no weights), and one for each
// weight ("" — none) — and every weight it comes in at all.
export type DrawerHeightOption = {
  token: string;
  value: string;
  lengths: number[];
  byLength: Array<{ length: number; weights: number[]; itemNumber: string; weightItemNumbers: Array<{ weight: number; itemNumber: string }> }>;
  weights: number[];
};
export type HardwareDrawerType = {
  name: string;
  isDefault: boolean;
  heightLetters: string[];
  heightOptions: DrawerHeightOption[];
  bottomsWidthMinus: number | null;
  bottomsDepthMinus: number | null;
  backsWidthMinus: number | null;
  hardwareLengths: number[];
  // The runner weights it comes in, in kg (Blum's 30 and 65) — its heights may each come in only some — and the one its
  // drawers are, unless one's set its own (null — none chosen: the lightest each comes in).
  hardwareWeights: number[];
  defaultWeight: number | null;
  spaceRequirement: number | null;
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
  // How the order's "Copy for cart" writes each item (Company Settings › Hardware › Ordering) — see formatCartCopyLine.
  // "" — DEFAULT_CART_COPY_FORMAT.
  cartCopyFormat: string;
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
          hardwareWeights: [],
          defaultWeight: null,
          spaceRequirement: null,
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
    const positiveNumbers = (raw: unknown): number[] =>
      Array.isArray(raw) ? (raw as unknown[]).map((v) => toNum(v)).filter((v) => Number.isFinite(v) && v > 0) : [];
    const hardwareLengths = positiveNumbers(item.hardwareLengths);
    const hardwareWeights = positiveNumbers(item.hardwareWeights);
    // Each height's lengths switched off, its lengths' weights switched off ("500|65"), and its ID numbers — by length
    // ("500"), or length and weight ("500|65") — by its letter (lower case).
    const details = item.heightDetails && typeof item.heightDetails === "object" ? (item.heightDetails as Record<string, unknown>) : {};
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
      const own = details[key] && typeof details[key] === "object" ? (details[key] as Record<string, unknown>) : {};
      const lengthsOff = positiveNumbers(own.lengthsOff);
      const combosOff = (Array.isArray(own.combosOff) ? (own.combosOff as unknown[]) : []).map((combo) => {
        const [length, weight] = toStr(combo).split("|");
        return { length: toNum(length), weight: toNum(weight) };
      });
      const itemNumbers = own.itemNumbers && typeof own.itemNumbers === "object" ? (own.itemNumbers as Record<string, unknown>) : {};
      const itemNumberFor = (length: number, weight: number | null) =>
        toStr(
          Object.entries(itemNumbers).find(([key]) => {
            const [keyLength, keyWeight] = key.split("|");
            return toNum(keyLength) === length && (weight == null ? keyWeight == null : toNum(keyWeight) === weight);
          })?.[1],
        );
      const lengths = hardwareLengths.filter((length) => !lengthsOff.includes(length));
      const byLength = lengths.map((length) => {
        const weights = hardwareWeights.filter((weight) => !combosOff.some((combo) => combo.length === length && combo.weight === weight));
        return {
          length,
          weights,
          itemNumber: itemNumberFor(length, null),
          weightItemNumbers: weights.map((weight) => ({ weight, itemNumber: itemNumberFor(length, weight) })),
        };
      });
      heightOptions.push({
        token: label,
        value,
        lengths,
        byLength,
        weights: hardwareWeights.filter((weight) => byLength.some((entry) => entry.weights.includes(weight))),
      });
    }
    const bottomsWidthMinus = toNum(bottoms.widthMinus ?? item.widthMinus);
    const bottomsDepthMinus = toNum(bottoms.depthMinus ?? item.depthMinus);
    const backsWidthMinus = toNum(backs.widthMinus);
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
      hardwareWeights,
      defaultWeight: hardwareWeights.includes(toNum(item.defaultWeight)) ? toNum(item.defaultWeight) : null,
      spaceRequirement,
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
        cartCopyFormat: toStr(item.cartCopyFormat),
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

// A hardware brand's hinge's or other item's supplier ID number, by its name ("" — none, or not found).
export function hardwareItemNumber(row: HardwareTypeRow | null | undefined, kind: "hinge" | "other", name: string): string {
  if (!row) return "";
  const key = String(name || "").trim().toLowerCase();
  if (!key) return "";
  return (kind === "hinge" ? row.hingeItemNumbers : row.otherItemNumbers)[key] ?? "";
}

// A drawer's supplier ID number: its drawer type's height's, at its runner length — and weight, each having its own.
// No weight given (drawers don't have one chosen yet): the length's own, or its one weight's when it comes in just one;
// "" when there's more than one to choose from, none, or it's not found.
export function drawerHeightItemNumber(
  row: HardwareTypeRow | null | undefined,
  drawerType: string,
  height: string,
  length: number,
  weight?: number,
): string {
  const drawerKey = String(drawerType || "").trim().toLowerCase();
  const heightKey = String(height || "").trim().toLowerCase();
  if (!row || !drawerKey || !heightKey || !(length > 0)) return "";
  const drawer = row.drawers.find((item) => item.name.trim().toLowerCase() === drawerKey);
  const option = drawer?.heightOptions.find((item) => item.token.toLowerCase() === heightKey);
  const entry = option?.byLength.find((item) => item.length === length);
  if (!entry) return "";
  if (weight != null) return entry.weightItemNumbers.find((item) => item.weight === weight)?.itemNumber || entry.itemNumber;
  if (entry.itemNumber) return entry.itemNumber;
  return entry.weightItemNumbers.length === 1 ? entry.weightItemNumbers[0].itemNumber : "";
}

// The order's "Copy for cart": a line for each item on it, written the way the brand's supplier's quick order takes them —
// the brand's Copy format, set in Company Settings, its placeholders filled in ({id}: the item's ID number). Left blank,
// this: the item number, then how many, a space between (Blum's Quick order › Add items in bulk).
export const DEFAULT_CART_COPY_FORMAT = "{id} {quantity}";
export const CART_COPY_PLACEHOLDERS = [
  { token: "{id}", label: "ID number" },
  { token: "{quantity}", label: "Quantity" },
  { token: "{name}", label: "Item name" },
  { token: "{tab}", label: "Tab" },
] as const;
export function formatCartCopyLine(format: string, item: { id: string; quantity: number; name: string }): string {
  return (format.trim() || DEFAULT_CART_COPY_FORMAT).replace(/\{(id|quantity|name|tab)\}/gi, (_, key: string) => {
    const placeholder = key.toLowerCase();
    if (placeholder === "id") return item.id;
    if (placeholder === "quantity") return String(item.quantity);
    if (placeholder === "name") return item.name;
    return "\t";
  });
}
