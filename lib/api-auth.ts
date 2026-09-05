import type { NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

// Verifies the caller's Firebase ID token (Authorization: Bearer <idToken>) and returns the
// token's own uid — never trust a uid passed in a request body/query string instead, since that
// can be spoofed by anyone who can reach the route.
export async function verifyBearerUid(request: NextRequest): Promise<string | null> {
  if (!adminAuth) return null;
  const header = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const idToken = match?.[1]?.trim();
  if (!idToken) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    return decoded.uid || null;
  } catch {
    return null;
  }
}
