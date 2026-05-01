import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL || "";
const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n");

const hasAdminConfig = Boolean(projectId && clientEmail && privateKey);

const adminApp = hasAdminConfig
  ? getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      })
  : null;

export const adminDb = adminApp ? getFirestore(adminApp) : null;
export const hasFirebaseAdminConfig = hasAdminConfig;
