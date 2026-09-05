import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import {
  VERIFICATION_MAX_ATTEMPTS,
  isVerificationCodeExpired,
  verificationCodesMatch,
  type VerificationCodeDoc,
} from "@/lib/verification";

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const uid = await verifyBearerUid(request);
  if (!uid) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const code = String(body.code ?? "").trim();
  if (!code) {
    return NextResponse.json({ ok: false, error: "missing-code" }, { status: 400 });
  }

  const codeRef = adminDb.collection("verificationCodes").doc(`user_${uid}`);
  const codeSnap = await codeRef.get();
  if (!codeSnap.exists) {
    return NextResponse.json({ ok: false, error: "no-pending-code" }, { status: 400 });
  }
  const codeDoc = codeSnap.data() as VerificationCodeDoc;

  if (codeDoc.attempts >= VERIFICATION_MAX_ATTEMPTS) {
    return NextResponse.json({ ok: false, error: "too-many-attempts" }, { status: 429 });
  }
  if (isVerificationCodeExpired(codeDoc)) {
    return NextResponse.json({ ok: false, error: "expired" }, { status: 400 });
  }
  if (!verificationCodesMatch(code, codeDoc.codeHash)) {
    const attempts = codeDoc.attempts + 1;
    await codeRef.set({ attempts }, { merge: true });
    return NextResponse.json(
      { ok: false, error: "invalid-code", attemptsRemaining: Math.max(0, VERIFICATION_MAX_ATTEMPTS - attempts) },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();
  await adminDb.collection("users").doc(uid).set({ verified: true, verifiedAt: nowIso }, { merge: true });
  await codeRef.delete();

  return NextResponse.json({ ok: true });
}
