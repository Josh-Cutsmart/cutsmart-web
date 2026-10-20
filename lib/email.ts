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

export type SendStaffEmailInput = {
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments: Array<{ filename: string; content: Buffer }>;
};

// An email to the company's own staff, with files attached — e.g. a project's copy as it's deleted
// (app/api/projects/email-copy). The recipients are checked by the caller; they all go on the one email.
export async function sendStaffEmail({ to, subject, text, html, attachments }: SendStaffEmailInput): Promise<SendVerificationEmailResult> {
  const apiKey = readEnvValue(process.env.RESEND_API_KEY);
  const from = senderFromEnv(process.env.RESEND_FROM_EMAIL);
  if (!apiKey || !from) {
    return { ok: false, error: "missing-resend-config" };
  }
  const recipients = Array.from(new Set(to.map((address) => String(address || "").trim()).filter(Boolean)));
  if (!recipients.length) {
    return { ok: false, error: "missing-recipient" };
  }
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to: recipients, subject, text, html, attachments });
    if (error) {
      return { ok: false, error: error.message || "resend-send-failed" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "resend-send-failed" };
  }
}

// "Forgot your password?" (app/api/auth/password-reset): a link to set a new one. The link is only ever to
// CutSmart's own reset page (the caller makes it); it works for an hour, once.
export async function sendPasswordResetEmail({ to, link }: { to: string; link: string }): Promise<SendVerificationEmailResult> {
  const apiKey = readEnvValue(process.env.RESEND_API_KEY);
  const from = senderFromEnv(process.env.RESEND_FROM_EMAIL);
  if (!apiKey || !from) {
    return { ok: false, error: "missing-resend-config" };
  }
  const cleanTo = String(to || "").trim();
  if (!cleanTo) {
    return { ok: false, error: "missing-recipient" };
  }
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const text = [
    "We got a request to reset the password for your CutSmart account.",
    "",
    "Set a new password here:",
    link,
    "",
    "This link works for 1 hour, and only once. If you didn't ask for this, you can ignore this email — your password won't change.",
  ].join("\n");
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111111">
  <h1 style="margin:0 0 12px;font-size:20px;font-weight:600">Reset your password</h1>
  <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#374151">We got a request to reset the password for your CutSmart account (${escape(cleanTo)}).</p>
  <a href="${escape(link)}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#2F6BFF;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">Set a new password</a>
  <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#6b7280">This link works for 1 hour, and only once. If you didn't ask for this, you can ignore this email — your password won't change.</p>
</div>`;
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to: cleanTo, subject: "Reset your CutSmart password", text, html });
    if (error) {
      return { ok: false, error: error.message || "resend-send-failed" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "resend-send-failed" };
  }
}
