import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// A short-lived, shared cache for the few documents nearly every page reads on load — the company doc,
// the signed-in user's own users/{uid} doc and their membership doc. Without it, one page load read
// the company doc ~10 times, users/{uid} ~6 times and the membership ~4 times (sign-in, the app shell,
// each page's access check, project loading…), all competing for the same connection.
//
// - Requests already in flight are shared: two callers asking at once trigger one read.
// - Results are reused for CACHE_TTL_MS, then read fresh again.
// - Failed reads are never cached (the next caller retries); "document doesn't exist" is (null).
// - Anything that writes one of these documents must call the matching invalidate*() so the next read
//   is fresh — see lib/firestore-data.ts / lib/membership.ts writers.

const CACHE_TTL_MS = 60_000;

type Entry = { at: number; promise: Promise<unknown> };
const entries = new Map<string, Entry>();

function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise as Promise<T>;
  const promise: Promise<T> = load().catch((error) => {
    if (entries.get(key)?.promise === promise) entries.delete(key);
    throw error;
  });
  entries.set(key, { at: Date.now(), promise });
  return promise;
}

function invalidatePrefix(prefix: string) {
  for (const key of Array.from(entries.keys())) {
    if (key === prefix || key.startsWith(`${prefix}:`)) entries.delete(key);
  }
}

async function readDocData(path: [string, ...string[]]): Promise<Record<string, unknown> | null> {
  if (!db) return null;
  const snap = await getDoc(doc(db, ...path));
  return snap.exists() ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
}

// companies/{companyId} — null if it doesn't exist. Throws on a failed read.
export function readCompanyDocCached(companyId: string): Promise<Record<string, unknown> | null> {
  const cid = String(companyId || "").trim();
  if (!cid) return Promise.resolve(null);
  return cachedRead(`company:${cid}`, () => readDocData(["companies", cid]));
}

// users/{uid} — null if it doesn't exist. Throws on a failed read.
export function readUserDocCached(uid: string): Promise<Record<string, unknown> | null> {
  const userId = String(uid || "").trim();
  if (!userId) return Promise.resolve(null);
  return cachedRead(`user:${userId}`, () => readDocData(["users", userId]));
}

// companies/{companyId}/memberships/{uid} — null if it doesn't exist. Throws on a failed read.
export function readMembershipDocCached(companyId: string, uid: string): Promise<Record<string, unknown> | null> {
  const cid = String(companyId || "").trim();
  const userId = String(uid || "").trim();
  if (!cid || !userId) return Promise.resolve(null);
  return cachedRead(`membership:${cid}:${userId}`, () => readDocData(["companies", cid, "memberships", userId]));
}

// Derived values worth sharing too (e.g. a resolved company access check), keyed by the caller.
export function cachedValue<T>(key: string, load: () => Promise<T>): Promise<T> {
  return cachedRead(`value:${key}`, load);
}

// Call after writing the company doc (settings, roles, staff names, tags…) or its memberships.
export function invalidateCompanyCache(companyId?: string) {
  const cid = String(companyId || "").trim();
  if (!cid) {
    invalidatePrefix("company");
    invalidatePrefix("membership");
    invalidatePrefix("value");
    return;
  }
  invalidatePrefix(`company:${cid}`);
  invalidatePrefix(`membership:${cid}`);
  // Derived values (access checks…) may depend on the company doc; clear them all — they're cheap to redo.
  invalidatePrefix("value");
}

// Call after writing a users/{uid} doc (profile, colour, notification settings…).
export function invalidateUserCache(uid?: string) {
  const userId = String(uid || "").trim();
  invalidatePrefix(userId ? `user:${userId}` : "user");
  invalidatePrefix("value");
}
