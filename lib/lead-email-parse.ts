// Reading an email sent to a company's leads inbox (app/api/leads/email-inbound) into a lead: who it's from, their
// phone and address when the email has them, and what they wrote. Three kinds of email come in:
// - An enquiry straight from the customer — the sender is the customer.
// - One a staff member forwarded ("Fwd:", or a "Forwarded message" block) — the customer is the original sender,
//   from the forwarded block, not the staff member.
// - A website contact form's notification — "Name: …", "Phone: …" lines (or a table of them); the customer is in
//   those lines, or the email's Reply-To.
// Plus what's never a lead: auto-replies, newsletters, bounces — and Gmail's "confirm forwarding" email, which the
// company needs to see (it's shown in Company Settings → Leads).

export type EmailAddress = { name: string; email: string };

export type InboundEmail = {
  from: string;
  replyTo: string[];
  subject: string;
  text: string | null;
  html: string | null;
  headers: Record<string, string> | null;
};

export type EmailLeadDraft = {
  name: string;
  email: string;
  phone: string;
  address: string;
  message: string;
  // What's shown on the lead, in this order.
  rawFields: Record<string, string>;
  forwarded: boolean;
};

const MAX_MESSAGE = 5000;
const MAX_VALUE = 500;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

// "Jane Smith <jane@example.com>", "<jane@example.com>", "jane@example.com" → name and address.
export function parseEmailAddress(raw: string): EmailAddress {
  const text = String(raw || "").trim();
  const email = (text.match(EMAIL_PATTERN)?.[0] ?? "").toLowerCase();
  let name = text.replace(/<[^>]*>/, "").replace(EMAIL_PATTERN, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
  if (!name || name.includes("@")) name = "";
  return { name: clean(name), email };
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

// An HTML email as plain text: line breaks where the paragraphs, rows and breaks were, a table row's cells as
// "Label: value" (how most contact form emails lay out their answers).
export function htmlToText(html: string) {
  return String(html || "")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/t[hd]>\s*<t[hd][^>]*>/gi, ": ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (whole, name: string) => {
      const key = name.toLowerCase();
      if (ENTITIES[key] != null) return ENTITIES[key];
      if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(Number(key.slice(1)));
      return whole;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function header(headers: Record<string, string> | null, name: string) {
  if (!headers) return "";
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return String(value ?? "").trim();
  }
  return "";
}

// Why this email isn't a lead (an auto-reply, a newsletter or list, a bounce) — "" when it might be.
export function automatedEmailReason(email: InboundEmail): string {
  const from = parseEmailAddress(email.from).email;
  const subject = email.subject.trim().toLowerCase();
  const autoSubmitted = header(email.headers, "auto-submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return "auto-submitted";
  if (header(email.headers, "x-autoreply") || header(email.headers, "x-autorespond")) return "auto-reply";
  if (/^(bulk|junk|list|auto_reply)$/i.test(header(email.headers, "precedence"))) return "bulk";
  if (header(email.headers, "list-id")) return "mailing-list";
  if (/^(mailer-daemon|postmaster)@/.test(from)) return "bounce";
  if (/^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|autoreply|undeliverable|delivery status notification)/.test(subject)) return "auto-reply";
  return "";
}

// Gmail's "confirm you want to forward to this address" email: its confirmation code and link, and which Gmail
// address is asking.
export function gmailForwardingConfirmation(email: InboundEmail): { code: string; link: string; requestedBy: string } | null {
  if (parseEmailAddress(email.from).email !== "forwarding-noreply@google.com") return null;
  const text = email.text || htmlToText(email.html || "");
  const code = email.subject.match(/#(\d{6,})/)?.[1] ?? text.match(/confirmation code:\s*(\d{6,})/i)?.[1] ?? "";
  const link = text.match(/https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s<>"')]+/i)?.[0] ?? "";
  const requestedBy = email.subject.match(/from\s+(\S+@\S+)/i)?.[1]?.replace(/[)>.,]+$/, "") ?? "";
  return code || link ? { code, link, requestedBy } : null;
}

// A staff member's forward: the original sender, from the forwarded block's "From:" line.
export function forwardedSender(subject: string, text: string): EmailAddress | null {
  const looksForwarded =
    /^\s*(fwd?|fw)\s*:/i.test(subject) || /-{2,}\s*(forwarded message|original message)\s*-{2,}/i.test(text) || /^begin forwarded message:/im.test(text);
  if (!looksForwarded) return null;
  const match = text.match(/^\s*\*?from\*?\s*:\s*(.+)$/im);
  if (!match) return null;
  const sender = parseEmailAddress(match[1]);
  return sender.email ? sender : null;
}

// "Label: value" lines — a contact form's answers. Lines from a forwarded block's header (From, To, Subject, …)
// aren't answers.
const NOT_ANSWER_LABELS = new Set(["from", "to", "cc", "bcc", "sent", "date", "subject", "reply-to", "reply to"]);

export function labelledAnswers(text: string): Array<{ label: string; value: string }> {
  const answers: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*\*{0,2}([A-Za-z][A-Za-z0-9 /&'()?.-]{0,40}?)\*{0,2}\s*[:：]\s*(.+?)\s*$/);
    if (!match) continue;
    const label = clean(match[1]).replace(/[?.]+$/, "");
    const value = clean(match[2]).slice(0, MAX_VALUE);
    const key = label.toLowerCase();
    if (!label || !value || NOT_ANSWER_LABELS.has(key) || seen.has(key) || /^https?$/i.test(label)) continue;
    seen.add(key);
    answers.push({ label, value });
    if (answers.length >= 30) break;
  }
  return answers;
}

function findAnswer(answers: Array<{ label: string; value: string }>, pattern: RegExp, reject?: RegExp) {
  return answers.find((answer) => pattern.test(answer.label.toLowerCase()) && !(reject && reject.test(answer.label.toLowerCase())));
}

// A phone number written anywhere in the text (at least 8 digits, so not a date or an amount).
export function findPhoneNumber(text: string) {
  const candidates = text.match(/(?:\+?\d[\d\s().-]{6,}\d)/g) ?? [];
  return candidates.map((value) => clean(value)).find((value) => (value.match(/\d/g) || []).length >= 8 && (value.match(/\d/g) || []).length <= 15) ?? "";
}

export function buildEmailLead(email: InboundEmail): EmailLeadDraft {
  const text = (email.text && email.text.trim()) || htmlToText(email.html || "");
  const subject = clean(email.subject || "").replace(/^\s*((fwd?|fw|re)\s*:\s*)+/i, "");
  const sender = parseEmailAddress(email.from);
  const replyTo = email.replyTo.map(parseEmailAddress).find((address) => address.email && address.email !== sender.email) ?? null;
  const original = forwardedSender(email.subject, text);
  const answers = labelledAnswers(text);

  // A contact form's own answers come first, then the forwarded customer, the Reply-To, and the sender.
  const nameAnswer =
    findAnswer(answers, /(^|\b)(full )?name\b/, /(company|business|file|user|project|first|last|sur|given|family)/) ||
    null;
  const firstAnswer = findAnswer(answers, /first\s*name|given/);
  const lastAnswer = findAnswer(answers, /last\s*name|surname|family/);
  const emailAnswer = answers.find((answer) => EMAIL_PATTERN.test(answer.value) && /e-?mail/.test(answer.label.toLowerCase()));
  const phoneAnswer = findAnswer(answers, /phone|mobile|cell|contact number|tel/);
  const addressAnswer = findAnswer(answers, /address|suburb|location|street/, /e-?mail/);
  const messageAnswer = findAnswer(
    answers,
    /message|enquiry|inquiry|comment|details|description|question|notes|tell us|about (your |the )?project/,
    /type|budget|date|time|size|subject/,
  );

  const contact = original ?? replyTo ?? sender;
  const name =
    nameAnswer?.value ||
    [firstAnswer?.value, lastAnswer?.value].filter(Boolean).join(" ") ||
    contact.name ||
    "";
  const emailAddress = (emailAnswer?.value.match(EMAIL_PATTERN)?.[0] ?? contact.email ?? "").toLowerCase();
  const phone = phoneAnswer?.value || findPhoneNumber(text);
  const address = addressAnswer?.value || "";
  // A contact form's answers are all shown as they are — its whole text again as the message would just repeat them.
  const message = (messageAnswer?.value || (answers.length >= 3 ? "" : text)).slice(0, MAX_MESSAGE);

  // Shown on the lead: who and how to reach them, the subject, the form's other answers, and what they wrote.
  const rawFields: Record<string, string> = {};
  if (name) rawFields.Name = name;
  if (emailAddress) rawFields.Email = emailAddress;
  if (phone) rawFields.Phone = phone;
  if (address) rawFields.Address = address;
  if (subject) rawFields.Subject = subject.slice(0, MAX_VALUE);
  const used = new Set([nameAnswer, firstAnswer, lastAnswer, emailAnswer, phoneAnswer, addressAnswer, messageAnswer].filter(Boolean));
  for (const answer of answers) {
    if (used.has(answer)) continue;
    const key = rawFields[answer.label] == null && !["companyid", "source", "status"].includes(answer.label.toLowerCase()) ? answer.label : `${answer.label} (email)`;
    if (rawFields[key] == null) rawFields[key] = answer.value;
  }
  if (message) rawFields.Message = message;

  return { name, email: emailAddress, phone, address, message, rawFields, forwarded: Boolean(original) };
}
