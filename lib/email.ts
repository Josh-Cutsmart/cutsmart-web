import { Resend } from "resend";
import { buildSpecsConfirmationEmailText } from "@/lib/specs-share";

export type SendVerificationEmailInput = {
  to: string;
  code: string;
};

export type SendVerificationEmailResult = { ok: true } | { ok: false; error: string };

// A setting as entered in the host's dashboard, without the stray spaces, line breaks or wrapping quote
// marks that easily come along when pasting it in.
function readEnvValue(value: string | undefined): string {
  return String(value || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

// The sender for Resend, which rejects anything but "address" or "Name <address>". The address is picked
// out of whatever the setting holds, so a pasting slip (quote marks, the setting's own name in front, an
// invisible character) can't stop the emails going; it's sent as "CutSmart <address>" unless the setting
// gives its own name. "" when there's no address in it at all.
function senderFromEnv(value: string | undefined): string {
  const raw = readEnvValue(value);
  const address = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? "";
  if (!address) {
    if (raw) console.error("[email] RESEND_FROM_EMAIL doesn't contain an email address:", JSON.stringify(raw));
    return "";
  }
  const name = raw.match(/^\s*([A-Za-z0-9][^<>="'@]*?)\s*</)?.[1]?.trim() || "CutSmart";
  return `${name} <${address}>`;
}

export async function sendVerificationEmail({
  to,
  code,
}: SendVerificationEmailInput): Promise<SendVerificationEmailResult> {
  const apiKey = readEnvValue(process.env.RESEND_API_KEY);
  const from = senderFromEnv(process.env.RESEND_FROM_EMAIL);
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
};

export async function sendSpecsConfirmationEmail({
  to,
  projectName,
  link,
}: SendSpecsConfirmationEmailInput): Promise<SendVerificationEmailResult> {
  const apiKey = readEnvValue(process.env.RESEND_API_KEY);
  const from = senderFromEnv(process.env.RESEND_FROM_EMAIL);
  if (!apiKey || !from) {
    return { ok: false, error: "missing-resend-config" };
  }
  const cleanTo = String(to || "").trim();
  if (!cleanTo) {
    return { ok: false, error: "missing-recipient" };
  }
  const { subject, body } = buildSpecsConfirmationEmailText({ projectName, link });
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
