export function normalizeRoleKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function labelFromRoleKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

// threshold defaults to 0.62 (the original, more "balanced" cutoff — used for role colors etc.,
// unchanged). Callers that want white to stay the default text color for longer (only flipping to
// dark once a fill is genuinely too light, e.g. status pills) pass a higher value explicitly.
export function contrastTextForFill(fill: string, threshold = 0.62): string {
  const clean = String(fill || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "#0F172A";
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > threshold ? "#0F172A" : "#FFFFFF";
}
