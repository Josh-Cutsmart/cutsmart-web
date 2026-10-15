import { randomInt } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { LEAD_INBOX_CODE_ALPHABET as CODE_ALPHABET, LEAD_INBOX_CODE_LENGTH as CODE_LENGTH, LEAD_INBOX_LOCAL_PART_PATTERN as LOCAL_PART_PATTERN } from "@/lib/lead-inbox";

// Each company's leads email inbox — <company>_<5 letters/digits>@leads.cutsmart.nz, where <company> is the company
// name's initials when it's more than one word (Auckland Kitchen Makeovers → akm), else the name itself
// (Cabinetry → cabinetry). Anything sent or forwarded there becomes a lead (once receiving is set up).
//
// The 5-character code is what makes an address the company's own: every code ever handed out has a doc of its own
// in leadInboxCodes (which company, which address), created in the same transaction that gives it to the company,
// and never deleted — so no two companies ever share a code, and a code that's been used is never handed out again,
// even if its company goes. That registry, not the company doc (which the company's own admins can edit), is what
// says which company an address belongs to.
//
// Only the part before the @ is kept; the domain is added when the address is shown (lib/lead-inbox.ts), so it can
// change in one place.

export const LEAD_INBOX_CODES_COLLECTION = "leadInboxCodes";
const CODES_COLLECTION = LEAD_INBOX_CODES_COLLECTION;
const MAX_NAME_PART_LENGTH = 24;
const MAX_ATTEMPTS = 12;

export type LeadInbox = { localPart: string; code: string; createdAtIso: string };

function toStr(value: unknown) {
  return String(value ?? "").trim();
}

// The company part: the initials of a name of more than one word, else the one word — lower case letters and digits
// only (accents dropped); "company" when there's nothing to go on.
export function leadInboxNamePart(companyName: string) {
  const words = toStr(companyName)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const part = words.length > 1 ? words.map((word) => word[0]).join("") : (words[0] ?? "");
  return part.slice(0, MAX_NAME_PART_LENGTH) || "company";
}

function randomCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function readLeadInbox(companyData: Record<string, unknown> | undefined): LeadInbox | null {
  const raw = (companyData?.leadInbox ?? null) as Record<string, unknown> | null;
  const localPart = toStr(raw?.localPart).toLowerCase();
  const code = toStr(raw?.code).toLowerCase();
  if (!LOCAL_PART_PATTERN.test(localPart) || !localPart.endsWith(`_${code}`)) return null;
  return { localPart, code, createdAtIso: toStr(raw?.createdAtIso) };
}

// The company's inbox — handed out the first time it's asked for, then the same one every time after.
export async function ensureLeadInbox(companyId: string): Promise<LeadInbox> {
  if (!adminDb) throw new Error("missing-firebase-admin-config");
  const db = adminDb;
  const companyRef = db.collection("companies").doc(companyId);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = randomCode();
    const inbox = await db.runTransaction(async (tx) => {
      const companySnap = await tx.get(companyRef);
      if (!companySnap.exists) throw new Error("company-not-found");
      const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
      const existing = readLeadInbox(companyData);
      // Already has one — so long as the registry agrees it's theirs.
      if (existing) {
        const registered = await tx.get(db.collection(CODES_COLLECTION).doc(existing.code));
        if (registered.exists && toStr(registered.data()?.companyId) === companyId && toStr(registered.data()?.localPart) === existing.localPart) {
          return existing;
        }
      }
      const codeRef = db.collection(CODES_COLLECTION).doc(candidate);
      if ((await tx.get(codeRef)).exists) return null;
      const createdAtIso = new Date().toISOString();
      const localPart = `${leadInboxNamePart(toStr(companyData.name ?? companyData.companyName))}_${candidate}`;
      const next: LeadInbox = { localPart, code: candidate, createdAtIso };
      tx.create(codeRef, { code: candidate, companyId, localPart, createdAt: FieldValue.serverTimestamp(), createdAtIso });
      tx.set(companyRef, { leadInbox: next }, { merge: true });
      return next;
    });
    if (inbox) return inbox;
  }
  throw new Error("lead-inbox-no-free-code");
}
