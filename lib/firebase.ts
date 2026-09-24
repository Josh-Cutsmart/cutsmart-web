import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, setLogLevel } from "firebase/firestore";
import { getStorage } from "firebase/storage";

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

const app = hasFirebaseConfig
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
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
