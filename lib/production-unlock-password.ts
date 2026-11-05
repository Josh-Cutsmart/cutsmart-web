// The Unlock Edit password (a project's Production): its first part, as the company picks in Company Settings › Production
// access, then the company's code. Spaces never count and neither do capitals, so "Smith Kitchen" and code 1234 is
// smithkitchen1234.

export type UnlockPrefixMode = "project" | "client" | "custom" | "none";

export const UNLOCK_PREFIX_OPTIONS: Array<{ value: UnlockPrefixMode; label: string }> = [
  { value: "project", label: "Project name" },
  { value: "client", label: "Client name" },
  { value: "custom", label: "A word you choose" },
  { value: "none", label: "Nothing (just the code)" },
];

// What a project with no client has for one (lib/firestore-data.ts).
const NO_CLIENT = "unknowncustomer";

export function normalizeUnlockPrefixMode(value: unknown): UnlockPrefixMode {
  return UNLOCK_PREFIX_OPTIONS.some((option) => option.value === value) ? (value as UnlockPrefixMode) : "project";
}

// No spaces, no capitals: what's typed and what it's checked against both go through this.
export function cleanUnlockPassword(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

export function unlockPasswordFor(
  settings: { mode: unknown; word: unknown; code: unknown },
  project: { name?: unknown; customer?: unknown },
): string {
  const mode = normalizeUnlockPrefixMode(settings.mode);
  const name = String(project.name ?? "");
  const client = String(project.customer ?? "");
  // (A project with no client: its name, so it still has a first part.)
  const first =
    mode === "none" ? "" : mode === "custom" ? String(settings.word ?? "") : mode === "client" && cleanUnlockPassword(client) && cleanUnlockPassword(client) !== NO_CLIENT ? client : name;
  return cleanUnlockPassword(`${first}${String(settings.code ?? "")}`);
}
