"use client";

import { useSyncExternalStore } from "react";
import { browserLocalPersistence, setPersistence } from "firebase/auth";
import { doc, getDoc, setDoc } from "@/lib/firestore-client";
import { auth, db } from "@/lib/firebase";

// A 4-digit PIN for getting back in quickly. It's saved on the account (users/{uid}, which only the
// account itself can read — see firestore.rules) as a salted PBKDF2 hash, never the digits.
//
// "Remember me" keeps someone signed in on the device and lets them straight in. Without it, a
// sign-in normally ends with the browser session — unless the account has a PIN: then the device
// remembers them anyway, but asks for the PIN when they come back (after PIN_IDLE_LOCK_MS with the
// app closed). The lock is checked by the login screen and ProtectedRoute.

export const PIN_LENGTH = 4;
export const PIN_MAX_ATTEMPTS = 5;
// How long the app can be closed before the PIN is asked for again.
const PIN_IDLE_LOCK_MS = 30 * 60 * 1000;
const PIN_ITERATIONS = 150_000;

const LOCK_KEY = "cutsmart_pin_lock";
const UNLOCKED_KEY = "cutsmart_pin_unlocked";
const ATTEMPTS_KEY = "cutsmart_pin_attempts";
const LOCK_CHANGED_EVENT = "cutsmart:pin-lock-changed";

export type PinLock = { uid: string; email: string; name: string };
type PinRecord = { hash: string; salt: string; iterations: number };

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function derivePinHash(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return toBase64(new Uint8Array(bits));
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

export async function savePin(uid: string, pin: string): Promise<void> {
  if (!db || !uid || !isValidPin(pin)) throw new Error("bad-pin");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt, PIN_ITERATIONS);
  await setDoc(
    doc(db, "users", uid),
    { pin: { hash, salt: toBase64(salt), iterations: PIN_ITERATIONS, updatedAtIso: new Date().toISOString() } },
    { merge: true },
  );
}

async function readPinRecord(uid: string): Promise<PinRecord | null> {
  if (!db || !uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  const pin = (snap.exists() ? (snap.data() as Record<string, unknown>).pin : null) as Partial<PinRecord> | null;
  if (!pin || typeof pin.hash !== "string" || typeof pin.salt !== "string") return null;
  return { hash: pin.hash, salt: pin.salt, iterations: Number(pin.iterations) || PIN_ITERATIONS };
}

export async function accountHasPin(uid: string): Promise<boolean> {
  try {
    return Boolean(await readPinRecord(uid));
  } catch {
    return false;
  }
}

export async function checkPin(uid: string, pin: string): Promise<boolean> {
  const record = await readPinRecord(uid);
  if (!record || !isValidPin(pin)) return false;
  const hash = await derivePinHash(pin, fromBase64(record.salt), record.iterations);
  if (hash.length !== record.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i += 1) diff |= hash.charCodeAt(i) ^ record.hash.charCodeAt(i);
  return diff === 0;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable
  }
}

function emitLockChanged() {
  window.dispatchEvent(new Event(LOCK_CHANGED_EVENT));
}

export function readPinLock(): PinLock | null {
  if (typeof window === "undefined") return null;
  const lock = readJson<PinLock>(LOCK_KEY);
  return lock && typeof lock.uid === "string" && lock.uid ? lock : null;
}

// This device remembers the account and asks for its PIN next time. Keeps the sign-in past the end of
// the browser session (it would otherwise end with it — see auth-context's signIn).
export async function rememberWithPin(lock: PinLock): Promise<void> {
  if (auth) await setPersistence(auth, browserLocalPersistence).catch(() => undefined);
  writeJson(LOCK_KEY, lock);
  markPinUnlocked(lock.uid);
}

export function forgetPinLock() {
  if (typeof window === "undefined") return;
  writeJson(LOCK_KEY, null);
  writeJson(UNLOCKED_KEY, null);
  writeJson(ATTEMPTS_KEY, null);
  emitLockChanged();
}

export function markPinUnlocked(uid: string) {
  writeJson(UNLOCKED_KEY, { uid, at: Date.now() });
  writeJson(ATTEMPTS_KEY, null);
  emitLockChanged();
}

// Called while the app is open, so the PIN is only asked for after it's been closed a while.
export function keepPinUnlocked(uid: string) {
  const unlocked = readJson<{ uid: string; at: number }>(UNLOCKED_KEY);
  if (unlocked?.uid === uid) writeJson(UNLOCKED_KEY, { uid, at: Date.now() });
}

// A wrong PIN. Returns how many tries are left.
export function recordWrongPin(): number {
  const used = (Number(readJson<number>(ATTEMPTS_KEY)) || 0) + 1;
  writeJson(ATTEMPTS_KEY, used);
  return Math.max(0, PIN_MAX_ATTEMPTS - used);
}

function isPinLocked(uid: string): boolean {
  const lock = readPinLock();
  if (!uid || !lock || lock.uid !== uid) return false;
  const unlocked = readJson<{ uid: string; at: number }>(UNLOCKED_KEY);
  return !(unlocked?.uid === uid && Date.now() - Number(unlocked.at) < PIN_IDLE_LOCK_MS);
}

function subscribe(onChange: () => void) {
  window.addEventListener(LOCK_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener(LOCK_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

// Whether this device is waiting for the signed-in account's PIN.
export function usePinLocked(uid: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isPinLocked(String(uid || "")),
    () => false,
  );
}
