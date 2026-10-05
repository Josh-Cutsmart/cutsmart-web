"use client";

import { auth } from "@/lib/firebase";

// fetch() for the app's own API routes that check who's asking (e.g. /api/leads, /api/clients): adds
// the signed-in user's Firebase ID token as `Authorization: Bearer …`, which the route verifies
// server-side (lib/api-auth.ts / lib/api-company-access.ts). Without a signed-in user it sends the
// request as-is, and the route answers 401.
export async function authorizedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await auth?.currentUser?.getIdToken().catch(() => "");
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
