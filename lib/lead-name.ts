// A lead's client name — "Client Name" + "Client Last Name" — worked out the same way the Leads page
// builds a new project's name from a lead (buildLeadClientNameParts / buildLeadProjectName in
// app/(staff)/(app)/leads/page.tsx): first the lead fields the company mapped to those two in
// Company Settings → Integrations → lead fields ("Use for"), otherwise fields whose names look like a
// name. "" when there's nothing to go on.

type LeadNameField = { key: string; label: string; value: string };

// Fields every lead carries that are never a client's name.
const RESERVED_FIELD_KEYS = new Set(["companyid", "source", "status"]);

function normalizeKey(key: string): string {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function labelFor(key: string): string {
  return String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function valueText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(" ");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function fieldsOf(rawFields: unknown): LeadNameField[] {
  if (!rawFields || typeof rawFields !== "object") return [];
  return Object.entries(rawFields as Record<string, unknown>)
    .filter(([key]) => !RESERVED_FIELD_KEYS.has(normalizeKey(key)) && !key.startsWith("__"))
    .map(([key, value]) => ({ key, label: labelFor(key), value: valueText(value) }))
    .filter((field) => field.value);
}

// The field whose key/label matches the most of `patterns` (ties broken by key, so the pick is stable).
function bestField(fields: LeadNameField[], patterns: RegExp[], allow?: (field: LeadNameField) => boolean) {
  let best: LeadNameField | null = null;
  let bestScore = 0;
  for (const field of fields) {
    if (allow && !allow(field)) continue;
    const haystack = `${field.key} ${field.label}`.toLowerCase();
    const score = patterns.reduce((sum, pattern) => (pattern.test(haystack) ? sum + 1 : sum), 0);
    if (score > bestScore || (score > 0 && score === bestScore && best && field.key.localeCompare(best.key) < 0)) {
      best = field;
      bestScore = score;
    }
  }
  return best;
}

export function leadClientDisplayName(rawFields: unknown, fieldLayout: unknown): string {
  const fields = fieldsOf(rawFields);
  if (!fields.length) return "";
  const layout = Array.isArray(fieldLayout) ? (fieldLayout as Array<Record<string, unknown>>) : [];
  const mapped = (target: string) => {
    const row = layout.find((item) => item && String(item.projectFieldTarget || "").trim() === target);
    if (!row) return null;
    const key = normalizeKey(String(row.key || ""));
    return fields.find((field) => normalizeKey(field.key) === key) ?? null;
  };

  const nameField =
    mapped("clientName") ||
    bestField(fields, [/client\s*name/, /full\s*name/, /(^|[^a-z])name([^a-z]|$)/], (field) => {
      const haystack = `${field.key} ${field.label}`.toLowerCase();
      // Not "first name"/"last name" (those are the parts below), and not a business name.
      return !/company|business|organisation|organization|first|last|surname|given|family/.test(haystack);
    });
  const firstField = mapped("clientFirstName") || bestField(fields, [/(^|[^a-z])first([^a-z]|$)/, /first\s*name/, /given\s*name/]);
  const lastField = mapped("clientLastName") || bestField(fields, [/(^|[^a-z])last([^a-z]|$)/, /last\s*name/, /surname/, /family\s*name/]);

  const name = (nameField?.value || firstField?.value || "").trim();
  const lastName = (lastField?.value || "").trim();
  // A full name mapped to "Client Name" may already end with the surname — don't repeat it.
  if (name && lastName && name.toLowerCase().endsWith(lastName.toLowerCase())) return name;
  return [name, lastName].filter(Boolean).join(" ");
}
