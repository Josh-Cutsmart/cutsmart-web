// Contacts that look like the same person (Contacts › the "possible duplicates" notice — merged only when someone says so,
// never on their own): the same email, the same phone number (its last 8 digits — so 021 … and +64 21 … match), or the
// same name at the same address. A name alone isn't enough (two people can share one). Staff and archived cards are left
// out. Each group: everyone linked to everyone else by one of those, and why (the first thing found).

import type { CompanyClientRow } from "@/lib/firestore-data";
import { isStaffContactId } from "@/lib/staff-contacts";

export type DuplicateReason = "email" | "phone" | "name";
export type DuplicateContactGroup = {
  // Its contacts' ids, sorted and joined — what "Not duplicates" remembers.
  key: string;
  reason: DuplicateReason;
  // What they share: the email, the phone number, or the name.
  shared: string;
  contacts: CompanyClientRow[];
};

const norm = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const phoneKey = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D+/g, "");
  return digits.length >= 7 ? digits.slice(-8) : "";
};

export function findDuplicateContacts(rows: CompanyClientRow[]): DuplicateContactGroup[] {
  const live = rows.filter((row) => row.id && !row.archived && !row.deleted && !isStaffContactId(row.id));
  // Joined up: each contact's group (union-find), and why it was first joined.
  const parent = new Map<string, string>(live.map((row) => [row.id, row.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const reasons = new Map<string, { reason: DuplicateReason; shared: string }>();
  const join = (a: string, b: string, reason: DuplicateReason, shared: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    parent.set(rb, ra);
    const kept = reasons.get(ra) ?? reasons.get(rb);
    reasons.set(ra, kept ?? { reason, shared });
  };
  const byKey = (key: (row: CompanyClientRow) => string, reason: DuplicateReason, shared: (row: CompanyClientRow) => string) => {
    const seen = new Map<string, CompanyClientRow>();
    for (const row of live) {
      const value = key(row);
      if (!value) continue;
      const first = seen.get(value);
      if (first) join(first.id, row.id, reason, shared(first));
      else seen.set(value, row);
    }
  };
  byKey((row) => norm(row.emailNormalized || row.email), "email", (row) => row.email.trim());
  byKey((row) => phoneKey(row.phone), "phone", (row) => row.phone.trim());
  byKey((row) => (norm(row.name) && norm(row.address) ? `${norm(row.name)}|${norm(row.address)}` : ""), "name", (row) => row.name.trim());

  const groups = new Map<string, CompanyClientRow[]>();
  for (const row of live) {
    const root = find(row.id);
    groups.set(root, [...(groups.get(root) ?? []), row]);
  }
  return Array.from(groups.entries())
    .filter(([, contacts]) => contacts.length > 1)
    .map(([root, contacts]) => {
      const why = reasons.get(root) ?? { reason: "email" as const, shared: "" };
      return {
        key: contacts.map((row) => row.id).sort().join("|"),
        reason: why.reason,
        shared: why.shared,
        // The one with the most projects first (the likeliest to keep).
        contacts: [...contacts].sort((a, b) => b.projectCount - a.projectCount || a.name.localeCompare(b.name)),
      };
    });
}

// "Not duplicates" — remembered on this device, per company.
const DISMISSED_KEY = "cutsmart_contact_duplicates_dismissed:";
export function readDismissedDuplicateKeys(companyId: string): string[] {
  if (!companyId || typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_KEY + companyId) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
export function saveDismissedDuplicateKeys(companyId: string, keys: string[]) {
  if (!companyId) return;
  try {
    window.localStorage.setItem(DISMISSED_KEY + companyId, JSON.stringify(Array.from(new Set(keys))));
  } catch {
    // (No room / not allowed: it's just shown again next time.)
  }
}
