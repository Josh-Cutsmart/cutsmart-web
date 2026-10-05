// Last-known data saved on this device (the signed-in account, its access, the dashboard), so the next
// visit can show the app straight away and refresh it in the background, instead of waiting on the
// database first.
//
// - Only ever written after a successful load, and always tagged with the user it belongs to — a
//   different account signed in on the same browser never sees it.
// - Cleared on sign-in and sign-out.
// - Kept for the browser session only (sessionStorage) when the user chose not to stay signed in on
//   this device, so nothing is left behind on a shared computer once the browser is closed.
// - The database's own rules still decide what can be read or changed; this only affects what's shown
//   for the moment before fresh data arrives.

const PREFIX = "cutsmart_last_";
// Same key lib/auth-context.tsx sets at sign-in ("0" = don't stay signed in on this device).
const REMEMBER_DEVICE_STORAGE_KEY = "cutsmart_web_remember_device";
// Anything larger isn't worth keeping (and storage space is limited).
const MAX_SAVED_LENGTH = 2_000_000;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(REMEMBER_DEVICE_STORAGE_KEY) === "0" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

// The saved value for `name`, if it belongs to `uid`; otherwise null.
export function readLastKnown<T>(name: string, uid: string): T | null {
  if (!uid) return null;
  try {
    const raw = storage()?.getItem(PREFIX + name);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { uid?: unknown; value?: T } | null;
    return parsed && parsed.uid === uid && parsed.value !== undefined ? parsed.value : null;
  } catch {
    return null;
  }
}

export function saveLastKnown(name: string, uid: string, value: unknown): void {
  if (!uid) return;
  try {
    const raw = JSON.stringify({ uid, value });
    if (raw.length > MAX_SAVED_LENGTH) return;
    storage()?.setItem(PREFIX + name, raw);
  } catch {
    // storage full or unavailable — the next visit just loads normally
  }
}

// Clears everything saved, or only the entries whose name starts with `namePrefix` (e.g. "access:").
export function clearLastKnown(namePrefix = ""): void {
  if (typeof window === "undefined") return;
  const prefix = PREFIX + namePrefix;
  for (const getStore of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const store = getStore();
      const keys: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key && key.startsWith(prefix)) keys.push(key);
      }
      keys.forEach((key) => store.removeItem(key));
    } catch {
      // storage unavailable
    }
  }
}
