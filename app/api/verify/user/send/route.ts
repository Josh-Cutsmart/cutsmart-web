import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { sendVerificationEmail } from "@/lib/email";
import {
  VERIFICATION_CODE_TTL_MS,
  generateVerificationCode,
  hashVerificationCode,
  resendCooldownRemainingMs,
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

  const userSnap = await adminDb.collection("users").doc(uid).get();
  const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
  const email = String(userData.email ?? "").trim();
  if (Boolean(userData.verified)) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }
  if (!email) {
    return NextResponse.json({ ok: false, error: "missing-email" }, { status: 400 });
  }

  const codeRef = adminDb.collection("verificationCodes").doc(`user_${uid}`);
  const codeSnap = await codeRef.get();
  const existing = codeSnap.exists ? (codeSnap.data() as VerificationCodeDoc) : null;
  const cooldownRemainingMs = resendCooldownRemainingMs(existing);
  if (cooldownRemainingMs > 0) {
    return NextResponse.json(
      { ok: false, error: "cooldown", retryAfterSeconds: Math.ceil(cooldownRemainingMs / 1000) },
      { status: 429 },
    );
  }

  const code = generateVerificationCode();
  const nowIso = new Date().toISOString();
  const emailResult = await sendVerificationEmail({ to: email, code });
  if (!emailResult.ok) {
    return NextResponse.json({ ok: false, error: emailResult.error }, { status: 502 });
  }

  const doc: VerificationCodeDoc = {
    type: "user",
    subjectId: uid,
    codeHash: hashVerificationCode(code),
    email,
    expiresAt: new Date(Date.now() + VERIFICATION_CODE_TTL_MS).toISOString(),
    attempts: 0,
    lastSentAt: nowIso,
    createdAt: existing?.createdAt ?? nowIso,
  };
  await codeRef.set(doc);

  return NextResponse.json({ ok: true });
}
