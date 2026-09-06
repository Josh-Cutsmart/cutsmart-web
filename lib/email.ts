import { Resend } from "resend";
import { buildSpecsConfirmationEmailText } from "@/lib/specs-share";

export type SendVerificationEmailInput = {
  to: string;
  code: string;
};

export type SendVerificationEmailResult = { ok: true } | { ok: false; error: string };

export async function sendVerificationEmail({
  to,
  code,
}: SendVerificationEmailInput): Promise<SendVerificationEmailResult> {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.RESEND_FROM_EMAIL || "";
  if (!apiKey || !from) {
    return { ok: false, error: "missing-resend-config" };
  }
  const cleanTo = String(to || "").trim();
  if (!cleanTo) {
    return { ok: false, error: "missing-recipient" };
  }
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: cleanTo,
      subject: "Verify your CutSmart account",
      text: `Use this code to verify your account: ${code}\n\nThis code expires in 15 minutes. If you didn't request this, you can ignore this email.`,
    });
    if (error) {
      return { ok: false, error: error.message || "resend-send-failed" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "resend-send-failed" };
  }
}

export type SendSpecsConfirmationEmailInput = {
  to: string;
  projectName: string;
  link: string;
  expiresInDays: number;
};

export async function sendSpecsConfirmationEmail({
  to,
  projectName,
  link,
  expiresInDays,
}: SendSpecsConfirmationEmailInput): Promise<SendVerificationEmailResult> {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.RESEND_FROM_EMAIL || "";
  if (!apiKey || !from) {
    return { ok: false, error: "missing-resend-config" };
  }
  const cleanTo = String(to || "").trim();
  if (!cleanTo) {
    return { ok: false, error: "missing-recipient" };
  }
  const { subject, body } = buildSpecsConfirmationEmailText({ projectName, link, expiresInDays });
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: cleanTo,
      subject,
      text: body,
    });
    if (error) {
      return { ok: false, error: error.message || "resend-send-failed" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "resend-send-failed" };
  }
}
