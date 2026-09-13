import { fetchCompanyStatsDoc, saveCompanyStatsDocPatch, type CompanyStatsDoc } from "@/lib/firestore-data";

// Sheets/edge tape/lacquer m² are NOT delta-tracked here — see ProjectStatsContribution in
// lib/firestore-data.ts for why (they're continuous nesting-engine outputs with no discrete save
// moment, so a client-side delta could double-count across tabs; they're tracked as an idempotent
// per-project current-value snapshot instead).
type CompanyStatCounterField = "doorsQuantity" | "drawersQuantity" | "panelsQuantity";

type CompanyStatLeaderboardMapField = "materialUsage" | "hingeUsage";
type CompanyStatLeaderboardDisplayField = "materialUsageDisplay" | "hingeUsageDisplay";

const currentStatsYear = () => new Date().getFullYear();

// Fetches the fresh doc, adds `delta` to a single numeric field, and merges it back — the same
// "re-fetch fresh, compute delta, merge" shape already used by syncBoardColourMemorySingleChange
// in the project page (an accepted, non-transactional race-safety pattern for this kind of
// aggregate counter, kept consistent here rather than introducing Firestore transactions).
export async function bumpCompanyStatCounter(
  companyId: string,
  field: CompanyStatCounterField,
  delta: number,
  year: number = currentStatsYear(),
): Promise<void> {
  if (!companyId || !delta || !Number.isFinite(delta)) return;
  const fresh = await fetchCompanyStatsDoc(companyId, year);
  const current = fresh?.[field] ?? 0;
  const next = Math.max(0, current + delta);
  await saveCompanyStatsDocPatch(companyId, year, { [field]: next });
}

// Same idea, for a leaderboard map (materialUsage / hingeUsage): bumps usage[key] by delta and
// keeps an original-cased display label alongside the lowercased tally key. Removes the key
// entirely once its count reaches zero so a renamed/one-off entry doesn't linger forever at 0.
export async function bumpCompanyStatLeaderboard(
  companyId: string,
  mapField: CompanyStatLeaderboardMapField,
  displayField: CompanyStatLeaderboardDisplayField,
  key: string,
  displayValue: string,
  delta: number,
  year: number = currentStatsYear(),
): Promise<void> {
  const normalizedKey = String(key || "").trim().toLowerCase();
  if (!companyId || !normalizedKey || !delta || !Number.isFinite(delta)) return;
  const fresh = await fetchCompanyStatsDoc(companyId, year);
  const usage: Record<string, number> = { ...(fresh?.[mapField] ?? {}) };
  const display: Record<string, string> = { ...(fresh?.[displayField] ?? {}) };
  const nextCount = Math.max(0, (usage[normalizedKey] ?? 0) + delta);
  if (nextCount <= 0) {
    delete usage[normalizedKey];
    delete display[normalizedKey];
  } else {
    usage[normalizedKey] = nextCount;
    display[normalizedKey] = displayValue || normalizedKey;
  }
  await saveCompanyStatsDocPatch(companyId, year, { [mapField]: usage, [displayField]: display });
}

export type { CompanyStatsDoc };
