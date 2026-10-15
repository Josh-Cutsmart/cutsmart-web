// A company's leads email inbox address — shared by the browser and the server. Handed out by the server
// (lib/lead-inbox-server.ts) and saved on the company doc as `leadInbox` ({ localPart, code, … }); only the part
// before the @ is kept, the domain is added here.

export const LEAD_INBOX_DOMAIN = "leads.cutsmart.nz";
// No 0/o or 1/l/i, so an address read out over the phone or copied by hand comes out right.
export const LEAD_INBOX_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const LEAD_INBOX_CODE_LENGTH = 5;
// <name>_<code>: the company name's initials (or its one word), then its 5-character code.
export const LEAD_INBOX_LOCAL_PART_PATTERN = new RegExp(`^[a-z0-9]+_[${LEAD_INBOX_CODE_ALPHABET}]{${LEAD_INBOX_CODE_LENGTH}}$`);

export function leadInboxAddress(localPart: string) {
  return `${localPart}@${LEAD_INBOX_DOMAIN}`;
}

// The part before the @ saved on a company doc's leadInbox, when it's a valid one ("" otherwise).
export function savedLeadInboxLocalPart(leadInbox: unknown) {
  const raw = (leadInbox && typeof leadInbox === "object" ? leadInbox : {}) as Record<string, unknown>;
  const localPart = String(raw.localPart ?? "").trim().toLowerCase();
  return LEAD_INBOX_LOCAL_PART_PATTERN.test(localPart) ? localPart : "";
}

// The code in an address at the leads domain (its last 5 characters before the @), and the part before the @ —
// null for any other address.
export function leadInboxCodeFromAddress(address: string): { localPart: string; code: string } | null {
  const match = /^([^@\s]+)@([^@\s]+)$/.exec(String(address || "").trim().toLowerCase());
  if (!match || match[2] !== LEAD_INBOX_DOMAIN) return null;
  // Plus-addressing (akm_x7k2p+anything@…) still reaches the company.
  const localPart = match[1].split("+")[0];
  if (!LEAD_INBOX_LOCAL_PART_PATTERN.test(localPart)) return null;
  return { localPart, code: localPart.slice(-LEAD_INBOX_CODE_LENGTH) };
}
