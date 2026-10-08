import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, inMemoryPersistence, initializeAuth, type Auth } from "firebase/auth";
import { disableNetwork, getFirestore, initializeFirestore, memoryLocalCache, setLogLevel, type Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { isPreviewMode } from "@/lib/preview-mode";
import { installPreviewRuntime } from "@/lib/preview-runtime";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const hasFirebaseConfig =
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.authDomain &&
  !!firebaseConfig.projectId &&
  !!firebaseConfig.storageBucket &&
  !!firebaseConfig.messagingSenderId &&
  !!firebaseConfig.appId;

// CutSmart Preview (lib/preview-mode.ts) runs on its own Firebase app: no one signed in, and a database
// that's offline from the start and kept only in memory — what the preview seeds into it
// (lib/preview-seed.ts) and anything changed there never reaches the real database, and it's gone when
// the tab closes. lib/firestore-client.ts makes the app's reads and writes work against it.
const previewMode = hasFirebaseConfig && isPreviewMode();
const PREVIEW_APP_NAME = "cutsmart-preview";

if (previewMode) installPreviewRuntime();

const app = hasFirebaseConfig
  ? previewMode
    ? (getApps().find((existing) => existing.name === PREVIEW_APP_NAME) ?? initializeApp(firebaseConfig, PREVIEW_APP_NAME))
    : getApps().some((existing) => existing.name === "[DEFAULT]")
      ? getApp()
      : initializeApp(firebaseConfig)
  : null;

function previewAuth(): Auth | null {
  if (!app) return null;
  try {
    return initializeAuth(app, { persistence: inMemoryPersistence });
  } catch {
    return getAuth(app); // already set up (hot reload)
  }
}

function previewDb(): Firestore | null {
  if (!app) return null;
  let previewFirestore: Firestore;
  try {
    previewFirestore = initializeFirestore(app, { localCache: memoryLocalCache() });
  } catch {
    previewFirestore = getFirestore(app); // already set up (hot reload)
  }
  // Before anything else is asked of it, so nothing is ever sent.
  void disableNetwork(previewFirestore);
  return previewFirestore;
}

export const auth = previewMode ? previewAuth() : app ? getAuth(app) : null;
export const db = previewMode ? previewDb() : app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;

// TEMPORARY mobile loading-speed diagnostic — remove once done. Piggybacks on the same debug flag
// as the on-page log panel in app/layout.tsx: when active, the Firestore SDK's own verbose
// connection/stream/RPC-level logging is captured by that same panel (it goes through
// console.debug/console.log, which that panel already hooks), giving real network-level timing
// instead of just "when did our own code's promise resolve" — needed to tell apart "the first
// query after a cold start is genuinely slow" from "the SDK's own connection/stream needs several
// seconds to become ready regardless of which query is first."
if (db && typeof window !== "undefined") {
  try {
    if (window.localStorage.getItem("cutsmart_debug_console") === "1") {
      setLogLevel("debug");
    }
  } catch {
    // ignore localStorage access errors (e.g. private browsing)
  }
}

export const collections = {
  companies: "companies",
  projects: "projects",
  members: "members",
  quotes: "quotes",
  cutlists: "cutlists",
  changelog: "changelog",
} as const;
