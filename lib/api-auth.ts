import type { NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

// Verifies the caller's Firebase ID token (Authorization: Bearer <idToken>) and returns the
// token's own uid — never trust a uid passed in a request body/query string instead, since that
// can be spoofed by anyone who can reach the route.
export async function verifyBearerUid(request: NextRequest): Promise<string | null> {
  return (await verifyBearerToken(request))?.uid || null;
}

// The same check, also giving the account's email (from the token itself) — e.g. for the Dev users
// listed in public/dev-emails.txt.
export async function verifyBearerUser(request: NextRequest): Promise<{ uid: string; email: string } | null> {
  const decoded = await verifyBearerToken(request);
  if (!decoded?.uid) return null;
  return { uid: decoded.uid, email: String(decoded.email || "").trim().toLowerCase() };
}

async function verifyBearerToken(request: NextRequest) {
  if (!adminAuth) return null;
  const header = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const idToken = match?.[1]?.trim();
  if (!idToken) return null;
  try {
    return await adminAuth.verifyIdToken(idToken);
  } catch {
    return null;
  }
}
