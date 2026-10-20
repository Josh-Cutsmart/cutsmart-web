import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { sendPasswordResetEmail } from "@/lib/email";
import { PUBLIC_SITE_ORIGIN } from "@/lib/site-origin";

// "Forgot your password?" on the login screen: emails a link to set a new one (components/login/reset-password-screen.tsx).
// - The same answer whether or not there's an account for the email, so it can't be used to find out who has one — only an
//   account's own address ever gets anything.
// - At most one email a minute, and RESET_MAX_PER_HOUR an hour, per address (passwordResetRequests/{hash of the address},
//   server only — firestore.rules has no rule for it).
// - The link holds Firebase's own reset code (an hour, once), on CutSmart's own page: always the live site's, or — run on a
//   developer's computer (next dev) — that copy's, to try it out. Never an address taken from a live request.
export const maxDuration = 30;

const RESET_COOLDOWN_MS = 60 * 1000;
const RESET_WINDOW_MS = 60 * 60 * 1000;
const RESET_MAX_PER_HOUR = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  if (!adminDb || !adminAuth || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const db = adminDb;
  const authAdmin = adminAuth;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = String(body.email ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid-email" }, { status: 400 });
  }

  // How many have gone to this address lately (counted whether or not it has an account).
  const ref = db.collection("passwordResetRequests").doc(crypto.createHash("sha256").update(email).digest("hex"));
  const now = Date.now();
  let waitSeconds = 0;
  try {
    waitSeconds = await db.runTransaction(async (transaction) => {
      const data = ((await transaction.get(ref)).data() ?? {}) as Record<string, unknown>;
      const lastSentMs = Date.parse(String(data.lastSentAt || ""));
      if (Number.isFinite(lastSentMs) && now - lastSentMs < RESET_COOLDOWN_MS) {
        return Math.ceil((RESET_COOLDOWN_MS - (now - lastSentMs)) / 1000);
      }
      const windowStartMs = Date.parse(String(data.windowStartAt || ""));
      const inWindow = Number.isFinite(windowStartMs) && now - windowStartMs < RESET_WINDOW_MS;
      const count = inWindow ? Number(data.count) || 0 : 0;
      if (count >= RESET_MAX_PER_HOUR) {
        return Math.ceil((RESET_WINDOW_MS - (now - windowStartMs)) / 1000);
      }
      transaction.set(ref, {
        lastSentAt: new Date(now).toISOString(),
        windowStartAt: inWindow ? String(data.windowStartAt) : new Date(now).toISOString(),
        count: count + 1,
      });
      return 0;
    });
  } catch (error) {
    console.error("[auth/password-reset] rate limit check failed:", error);
    return NextResponse.json({ ok: false, error: "try-again" }, { status: 500 });
  }
  if (waitSeconds > 0) {
    return NextResponse.json({ ok: false, error: "cooldown", retryAfterSeconds: waitSeconds }, { status: 429 });
  }

  let accountEmail = "";
  try {
    const account = await authAdmin.getUserByEmail(email);
    if (!account.disabled) accountEmail = String(account.email || email);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code !== "auth/user-not-found") {
      console.error("[auth/password-reset] account lookup failed:", error);
      return NextResponse.json({ ok: false, error: "try-again" }, { status: 500 });
    }
  }
  // No account (or a disabled one): nothing sent, the same answer.
  if (!accountEmail) return NextResponse.json({ ok: true });

  let resetCode = "";
  try {
    resetCode = new URL(await authAdmin.generatePasswordResetLink(accountEmail)).searchParams.get("oobCode") || "";
  } catch (error) {
    console.error("[auth/password-reset] couldn't make the reset link:", error);
  }
  if (!resetCode) {
    return NextResponse.json({ ok: false, error: "try-again" }, { status: 500 });
  }
  const origin = process.env.NODE_ENV === "production" ? PUBLIC_SITE_ORIGIN : new URL(request.url).origin;
  const sent = await sendPasswordResetEmail({
    to: accountEmail,
    link: `${origin}/reset-password?oobCode=${encodeURIComponent(resetCode)}`,
  });
  if (!sent.ok) {
    console.error("[auth/password-reset] email failed:", sent.error);
    return NextResponse.json({ ok: false, error: "email-failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
