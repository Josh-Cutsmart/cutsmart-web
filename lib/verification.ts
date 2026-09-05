import crypto from "crypto";

export const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000;
export const VERIFICATION_RESEND_COOLDOWN_MS = 30 * 1000;
export const VERIFICATION_MAX_ATTEMPTS = 5;

export function generateVerificationCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashVerificationCode(code: string): string {
  return crypto.createHash("sha256").update(String(code || "").trim()).digest("hex");
}

export function verificationCodesMatch(submittedCode: string, storedHash: string): boolean {
  const submittedHash = Buffer.from(hashVerificationCode(submittedCode), "hex");
  const stored = Buffer.from(String(storedHash || ""), "hex");
  if (submittedHash.length !== stored.length) return false;
  return crypto.timingSafeEqual(submittedHash, stored);
}

export type VerificationCodeDoc = {
  type: "user";
  subjectId: string;
  codeHash: string;
  email: string;
  expiresAt: string;
  attempts: number;
  lastSentAt: string;
  createdAt: string;
};

export function isVerificationCodeExpired(doc: Pick<VerificationCodeDoc, "expiresAt">): boolean {
  const expiry = Date.parse(doc.expiresAt);
  return !Number.isFinite(expiry) || Date.now() > expiry;
}

export function resendCooldownRemainingMs(doc: Pick<VerificationCodeDoc, "lastSentAt"> | null | undefined): number {
  if (!doc) return 0;
  const lastSent = Date.parse(doc.lastSentAt);
  if (!Number.isFinite(lastSent)) return 0;
  return Math.max(0, VERIFICATION_RESEND_COOLDOWN_MS - (Date.now() - lastSent));
}
