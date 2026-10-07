import type { CompanyClientRow, CompanyMemberOption } from "@/lib/firestore-data";

// Everyone on the company's staff is in everyone's Contacts, under the "Staff" category — a built-in
// contact category (Company Settings > Contact categories) that can't be removed or renamed, only
// recoloured. Staff cards aren't stored as contacts: they're made from the company's members each
// time Contacts loads, so they're always current (someone joining, leaving or changing their number
// shows straight away) and never doubled up.

export const STAFF_CONTACT_CATEGORY = "Staff";
export const STAFF_CONTACT_CATEGORY_DEFAULT_COLOR = "#3B82F6";
const STAFF_CONTACT_ID_PREFIX = "staff:";

export function isStaffContactCategory(name: unknown): boolean {
  return String(name ?? "").trim().toLowerCase() === STAFF_CONTACT_CATEGORY.toLowerCase();
}

// A staff card made from a member (not a stored contact — nothing on it can be edited or archived).
export function isStaffContactId(id: unknown): boolean {
  return String(id ?? "").startsWith(STAFF_CONTACT_ID_PREFIX);
}

// The category list with exactly one "Staff" row: kept where it is (with its colour) if it's there,
// otherwise added first.
export function withStaffContactCategory<T extends { name: string; color: string }>(rows: T[], makeRow: (name: string, color: string) => T): T[] {
  let seen = false;
  const out = rows.filter((row) => {
    if (!isStaffContactCategory(row.name)) return true;
    if (seen) return false;
    seen = true;
    return true;
  });
  return seen
    ? out.map((row) => (isStaffContactCategory(row.name) ? { ...row, name: STAFF_CONTACT_CATEGORY } : row))
    : [makeRow(STAFF_CONTACT_CATEGORY, STAFF_CONTACT_CATEGORY_DEFAULT_COLOR), ...out];
}

function emailKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

// Phone numbers compared on their last 9 digits, so "+61 412 345 678" and "0412 345 678" match.
function phoneKey(value: unknown): string {
  const digits = String(value ?? "").replace(/\D+/g, "");
  return digits.length >= 6 ? digits.slice(-9) : "";
}

// The contacts list with every staff member in it. A staff member who's already a contact (same email
// or phone) isn't added again — that contact shows under Staff instead (keeping its projects and notes),
// with their number/email filled in if it had none.
export function withStaffContacts(contacts: CompanyClientRow[], members: CompanyMemberOption[], companyId: string): CompanyClientRow[] {
  const out = contacts.slice();
  for (const member of members) {
    const uid = String(member.uid || "").trim();
    if (!uid) continue;
    const name = String(member.displayName || member.email || "").trim();
    const email = String(member.email || "").trim();
    const phone = String(member.mobile || "").trim();
    const memberEmail = emailKey(email);
    const memberPhone = phoneKey(phone);
    const existingIndex = out.findIndex(
      (contact) =>
        !contact.archived &&
        ((memberEmail && emailKey(contact.email) === memberEmail) || (memberPhone && phoneKey(contact.phone) === memberPhone)),
    );
    if (existingIndex >= 0) {
      const existing = out[existingIndex];
      out[existingIndex] = {
        ...existing,
        category: STAFF_CONTACT_CATEGORY,
        email: existing.email || email,
        phone: existing.phone || phone,
      };
      continue;
    }
    out.push({
      id: `${STAFF_CONTACT_ID_PREFIX}${uid}`,
      companyId,
      name,
      email,
      emailNormalized: memberEmail,
      phone,
      address: "",
      notes: "",
      category: STAFF_CONTACT_CATEGORY,
      archived: false,
      createdAtIso: "",
      updatedAtIso: "",
      firstProjectAtIso: "",
      lastProjectAtIso: "",
      lastProjectId: "",
      projectCount: 0,
      createdByUids: [],
      assignedToUids: [],
      history: [],
    });
  }
  return out;
}
