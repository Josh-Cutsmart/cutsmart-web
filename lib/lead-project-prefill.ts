// A lead's fields, and what they fill in on a project made from it — Leads › Create Project (the New Project pop-up,
// filled in: buildLeadProjectPrefill), and a column automation moving a lead on to the Dashboard (the server makes the
// project: lib/column-automations-server.ts). Its client's name, phone, email and address, the notes, the photos, who
// it's assigned to, and its other answers — first from the fields the company mapped to each (Company Settings' lead
// fields, "Use for"), else from fields that look like them. Shared by the app and the server.

import type { CompanyLeadRow } from "@/lib/firestore-data";
import { leadFormFieldLayout, type LeadForm } from "@/lib/lead-forms";
import type { NewProjectPrefillPayload } from "@/lib/new-project-bridge";

export const RESERVED_LEAD_FIELD_KEYS = new Set([
  "companyid",
  "source",
  "status",
]);

export type LeadProjectFieldTarget =
  | ""
  | "clientName"
  | "clientFirstName"
  | "clientLastName"
  | "clientPhone"
  | "clientEmail"
  | "projectAddress"
  | "projectNotes";
export type LeadFieldLayoutRow = {
  key: string;
  label: string;
  showInRow: boolean;
  showInDetail: boolean;
  order: number;
  projectFieldTarget: LeadProjectFieldTarget;
};

export type LeadDynamicField = {
  key: string;
  label: string;
  value: string;
};

export function formatLeadFieldLabel(key: string) {
  const raw = String(key || "").trim();
  if (!raw) return "Field";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function normalizeLeadFieldKey(key: string) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function normalizeLeadFieldLayout(raw: unknown): LeadFieldLayoutRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const key = String(row.key || "").trim();
      if (!key) return null;
      const label = String(row.label || "").trim() || formatLeadFieldLabel(key);
        return {
          key,
          label,
          showInRow: Boolean(row.showInRow),
          showInDetail: row.showInDetail == null ? true : Boolean(row.showInDetail),
          order: Number.isFinite(Number(row.order)) ? Number(row.order) : idx,
          projectFieldTarget: ([
            "",
            "clientName",
            "clientFirstName",
            "clientLastName",
            "clientPhone",
            "clientEmail",
            "projectAddress",
            "projectNotes",
        ] as LeadProjectFieldTarget[]).includes(String(row.projectFieldTarget || "").trim() as LeadProjectFieldTarget)
          ? (String(row.projectFieldTarget || "").trim() as LeadProjectFieldTarget)
          : "",
      } satisfies LeadFieldLayoutRow;
    })
    .filter((row): row is LeadFieldLayoutRow => Boolean(row));
}

export function mergeLeadFieldLayout(
  availableFields: Array<{ key: string; label: string }>,
  savedLayout: LeadFieldLayoutRow[],
): LeadFieldLayoutRow[] {
  const byKey = new Map(
    savedLayout.map((row) => [normalizeLeadFieldKey(row.key), row] as const),
  );
  return availableFields
    .map((field, idx) => {
      const existing = byKey.get(normalizeLeadFieldKey(field.key));
      return {
        key: existing?.key || field.key,
        label: existing?.label || field.label,
        showInRow: existing?.showInRow ?? idx < 3,
        showInDetail: existing?.showInDetail ?? true,
        order: Number.isFinite(Number(existing?.order)) ? Number(existing?.order) : idx,
        projectFieldTarget: existing?.projectFieldTarget ?? "",
      } satisfies LeadFieldLayoutRow;
    })
    .sort((a, b) => {
      const orderDiff = Number(a.order) - Number(b.order);
      if (orderDiff !== 0) return orderDiff;
      return a.label.localeCompare(b.label);
    });
}

export function isInternalTestLead(lead: CompanyLeadRow) {
  const raw = lead.rawFields ?? {};
  return (
    raw.__cutsmartTest === true ||
    String(raw.__cutsmartTest || "").trim().toLowerCase() === "true" ||
    String(raw.FullName || "").trim() === "CutSmart Test Lead" ||
    String(raw.Source || "").trim() === "CutSmart Integration Test"
  );
}

export function leadValueToText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => leadValueToText(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${formatLeadFieldLabel(key)}: ${leadValueToText(item)}`)
      .filter((item) => item.endsWith(": ") === false)
      .join(" | ");
  }
  return String(value).trim();
}

export function normalizeLeadImageItems(
  lead: CompanyLeadRow,
): Array<{ url: string; name: string; annotations: Array<{ id: string; x: number; y: number; xPx?: number; yPx?: number; note: string; createdByName?: string; createdByColor?: string }> }> {
  if (Array.isArray(lead.imageItems) && lead.imageItems.length > 0) {
    return lead.imageItems
      .map((item) => ({
        url: String(item?.url || "").trim(),
        name: String(item?.name || "").trim(),
        annotations: Array.isArray(item?.annotations)
          ? item.annotations
              .map((annotation) => ({
                id: String(annotation?.id || "").trim(),
                x: Number(annotation?.x ?? 0),
                y: Number(annotation?.y ?? 0),
                xPx: Number(annotation?.xPx),
                yPx: Number(annotation?.yPx),
                note: String(annotation?.note || "").trim(),
                createdByName: String(annotation?.createdByName || "").trim(),
                createdByColor: String(annotation?.createdByColor || "").trim(),
              }))
              .filter(
                (annotation) =>
                  annotation.id &&
                  annotation.note &&
                  Number.isFinite(annotation.x) &&
                  Number.isFinite(annotation.y),
              )
          : [],
      }))
      .filter((item) => item.url)
      .slice(0, 10);
  }
  return (Array.isArray(lead.imageUrls) ? lead.imageUrls : [])
    .map((url) => ({ url: String(url || "").trim(), name: "", annotations: [] }))
    .filter((item) => item.url)
    .slice(0, 10);
}

export function getLeadDynamicFields(lead: CompanyLeadRow): LeadDynamicField[] {
  if (isInternalTestLead(lead)) return [];
  const raw = lead.rawFields ?? {};
  return Object.entries(raw)
    .filter(([key]) => {
      const normalized = normalizeLeadFieldKey(key);
      return !RESERVED_LEAD_FIELD_KEYS.has(normalized) && !String(key || "").startsWith("__");
    })
    .map(([key, value]) => ({
      key,
      label: formatLeadFieldLabel(key),
      value: leadValueToText(value),
    }))
    .filter((field) => field.value);
}

export function scoreLeadFieldKey(field: LeadDynamicField, patterns: RegExp[]) {
  const haystack = `${field.key} ${field.label}`.toLowerCase();
  return patterns.reduce((best, pattern) => (pattern.test(haystack) ? best + 1 : best), 0);
}

export function findBestLeadField(
  fields: LeadDynamicField[],
  patterns: RegExp[],
  predicate?: (field: LeadDynamicField) => boolean,
) {
  let bestField: LeadDynamicField | null = null;
  let bestScore = -1;
  for (const field of fields) {
    if (predicate && !predicate(field)) continue;
    const score = scoreLeadFieldKey(field, patterns);
    if (score <= 0) continue;
    // Tie-break alphabetically by key, not by array order — `fields` comes
    // from Object.entries() on data fetched fresh on every poll, and if the
    // server doesn't guarantee stable key order, a plain `score > bestScore`
    // check lets the winner among tied candidates flip between requests,
    // which reads as a field's value randomly flickering between two leads'
    // worth of otherwise-identical data.
    if (score > bestScore || (score === bestScore && bestField && field.key.localeCompare(bestField.key) < 0)) {
      bestField = field;
      bestScore = score;
    }
  }
  return bestScore > 0 ? bestField : null;
}

export function isLikelyEmailValue(value: string) {
  return /\S+@\S+\.\S+/.test(String(value || "").trim());
}

export function isLikelyPhoneValue(value: string) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  return /^[+\d()\s-]+$/.test(raw) || /^\d+$/.test(raw);
}

// Returns consumedKeys alongside the built value — whichever raw field(s) fed into it — so
// buildLeadProjectPrefill can exclude them from the project's own "leadCustomFields" list; without
// that, an address already folded into projectAddress would also show up a second time as a
// generic custom field.
export function buildLeadAddress(fields: LeadDynamicField[]): { value: string; consumedKeys: string[] } {
  const directAddress = findBestLeadField(fields, [/address/, /street/, /location/]);
  if (directAddress?.value) return { value: directAddress.value, consumedKeys: [directAddress.key] };
  const matched = fields.filter((field) =>
    [/(^|[^a-z])suburb([^a-z]|$)/, /city/, /region/, /postcode/, /zip/, /state/, /country/].some((pattern) =>
      pattern.test(`${field.key} ${field.label}`.toLowerCase()),
    ),
  );
  const parts = matched.map((field) => field.value.trim()).filter(Boolean);
  return { value: Array.from(new Set(parts)).join(", "), consumedKeys: matched.map((field) => field.key) };
}

// Project name = whichever field is mapped to "Client Name" + whichever field is mapped to
// "Client Last Name" (the "Use For" column in the lead field Customise settings), combined in
// that order — e.g. a form with separate first/last name fields mapped to these two targets
// produces "John Smith" as the new project's name, rather than guessing at a surname from a
// single full-name field.
export function buildLeadProjectName(clientName: string, clientLastName: string) {
  const name = String(clientName || "").trim();
  const lastName = String(clientLastName || "").trim();
  // A full name in the "Client Name" field may already end with the surname — don't repeat it.
  if (name && lastName && name.toLowerCase().endsWith(lastName.toLowerCase())) return name;
  return [name, lastName].filter(Boolean).join(" ");
}

export function splitClientName(fullName: string) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) {
    return { firstName: "", lastName: "" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

export function buildLeadClientNameParts(fields: LeadDynamicField[], fieldLayout: LeadFieldLayoutRow[]) {
  const findMappedField = (target: LeadProjectFieldTarget) => {
    const mapped = fieldLayout.find((row) => row.projectFieldTarget === target);
    if (!mapped) return null;
    return fields.find((field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(mapped.key)) || null;
  };

  const explicitNameField =
    findMappedField("clientName") ||
    findBestLeadField(fields, [/client\s*name/, /full\s*name/, /(^|[^a-z])name([^a-z]|$)/], (field) => {
      const haystack = `${field.key} ${field.label}`.toLowerCase();
      return !/company|business|organisation|organization/.test(haystack);
    }) ||
    fields.find((field) => {
      const words = field.value.trim().split(/\s+/).filter(Boolean);
      return words.length >= 2 && /^[a-z ,.'-]+$/i.test(field.value.trim());
    }) ||
    null;

  const firstNameField =
    findMappedField("clientFirstName") ||
    findBestLeadField(fields, [/(^|[^a-z])first([^a-z]|$)/, /first\s*name/, /given\s*name/]) ||
    null;
  const lastNameField =
    findMappedField("clientLastName") ||
    findBestLeadField(fields, [/(^|[^a-z])last([^a-z]|$)/, /last\s*name/, /surname/, /family\s*name/]) ||
    null;

  if (explicitNameField?.value) {
    const split = splitClientName(explicitNameField.value);
    return {
      fullName: explicitNameField.value.trim(),
      firstName: firstNameField?.value?.trim() || split.firstName,
      lastName: lastNameField?.value?.trim() || split.lastName,
      consumedKeys: [explicitNameField.key, firstNameField?.key, lastNameField?.key].filter(
        (key): key is string => Boolean(key),
      ),
    };
  }

  const firstName = String(firstNameField?.value || "").trim();
  const lastName = String(lastNameField?.value || "").trim();
  return {
    fullName: [firstName, lastName].filter(Boolean).join(" ").trim(),
    firstName,
    lastName,
    consumedKeys: [firstNameField?.key, lastNameField?.key].filter((key): key is string => Boolean(key)),
  };
}

// The lead's name everywhere on this page — its card, drag preview, details, pop-ups and sorting:
// "Client Name" + "Client Last Name", the same name a project created from the lead gets (it used to
// be the "Client Name" field on its own, so a card read "John" while its project became "John Smith").
export function leadClientName(fields: LeadDynamicField[], fieldLayout: LeadFieldLayoutRow[]) {
  const parts = buildLeadClientNameParts(fields, fieldLayout);
  return buildLeadProjectName(parts.fullName || parts.firstName, parts.lastName);
}

export function buildLeadProjectPrefill(lead: CompanyLeadRow, fieldLayout: LeadFieldLayoutRow[]): NewProjectPrefillPayload {
  const fields = getLeadDynamicFields(lead);
  const findMappedField = (target: LeadProjectFieldTarget) => {
    const mapped = fieldLayout.find((row) => row.projectFieldTarget === target);
    if (!mapped) return null;
    return (
      fields.find((field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(mapped.key)) || null
    );
  };
  // Tracks every raw field key that ends up folded into one of the fixed fields below, so the
  // custom-fields list further down can exclude them — otherwise a field already surfaced as the
  // project's real clientEmail/clientAddress/etc. would ALSO show up a second time as a generic
  // "custom field," duplicating the same data under two labels.
  const consumedKeys = new Set<string>();
  const emailField =
    findMappedField("clientEmail") ||
    findBestLeadField(fields, [/email/, /e-mail/], (field) => isLikelyEmailValue(field.value)) ||
    fields.find((field) => isLikelyEmailValue(field.value)) ||
    null;
  if (emailField) consumedKeys.add(emailField.key);
  const phoneField =
    findMappedField("clientPhone") ||
    findBestLeadField(fields, [/phone/, /mobile/, /cell/, /contact/], (field) => isLikelyPhoneValue(field.value)) ||
    fields.find((field) => isLikelyPhoneValue(field.value)) ||
    null;
  if (phoneField) consumedKeys.add(phoneField.key);
  const {
    fullName: clientName,
    firstName: clientFirstName,
    lastName: clientLastName,
    consumedKeys: nameConsumedKeys,
  } = buildLeadClientNameParts(fields, fieldLayout);
  nameConsumedKeys.forEach((key) => consumedKeys.add(key));
  const notesField = findMappedField("projectNotes");
  if (notesField) consumedKeys.add(notesField.key);
  const mappedAddressField = findMappedField("projectAddress");
  let projectAddress: string;
  if (mappedAddressField?.value) {
    projectAddress = mappedAddressField.value.trim();
    consumedKeys.add(mappedAddressField.key);
  } else {
    const builtAddress = buildLeadAddress(fields);
    projectAddress = builtAddress.value.trim();
    builtAddress.consumedKeys.forEach((key) => consumedKeys.add(key));
  }
  const leadCustomFields = fields
    .filter((field) => !consumedKeys.has(field.key))
    .map((field) => ({ key: field.key, label: field.label, value: field.value }));
  return {
    projectName: buildLeadProjectName(clientName, clientLastName),
    clientFirstName,
    clientLastName,
    clientName,
    clientPhone: String(phoneField?.value || "").trim(),
    clientEmail: String(emailField?.value || "").trim(),
    projectAddress,
    projectNotes: String(notesField?.value || "").trim(),
    projectImages: normalizeLeadImageItems(lead).map((item) => item.url),
    projectImageItems: normalizeLeadImageItems(lead).map((item) => ({
      url: item.url,
      name: item.name,
      annotations: Array.isArray(item.annotations)
        ? item.annotations.map((annotation) => ({
            id: annotation.id,
            x: annotation.x,
            y: annotation.y,
            xPx: annotation.xPx,
            yPx: annotation.yPx,
            note: annotation.note,
            createdByName: annotation.createdByName,
            createdByColor: annotation.createdByColor,
          }))
        : [],
    })),
    assignedToUid: String(lead.assignedToUid || "").trim(),
    assignedToName: String(lead.assignedToName || lead.assignedTo || "").trim(),
    leadCustomFields: leadCustomFields.length > 0 ? leadCustomFields : undefined,
  };
}

// How a lead's fields are laid out — its card, its pop-up, its name, what it fills in on a project. A lead from one of
// the company's lead forms: that form's questions (lib/lead-forms.ts), then any answers it has to questions since taken
// out; one whose form has since been deleted: its own answers, as they were filed. A lead from the leads email inbox
// (app/api/leads/email-inbound): who it's from and how to reach them, the subject, anything else the email said, then
// the message — its phone and subject on its card. Any other lead: `defaultLayout` (the company's Zapier field layout).
// The Leads page's, and the server's as a lead's converted to a project by a column automation.
export function leadFieldLayoutFor(
  lead: CompanyLeadRow | null | undefined,
  formsById: Map<string, LeadForm>,
  defaultLayout: LeadFieldLayoutRow[],
): LeadFieldLayoutRow[] {
  const formId = String(lead?.formId || "").trim();
  if (lead && !formId && lead.source === "email") {
    const order = ["name", "email", "phone", "address", "subject"];
    const last = ["attachments", "message"];
    const rank = (key: string) => {
      const normalized = normalizeLeadFieldKey(key);
      if (order.includes(normalized)) return order.indexOf(normalized);
      if (last.includes(normalized)) return 100 + last.indexOf(normalized);
      return 50;
    };
    const targets: Record<string, LeadProjectFieldTarget> = {
      name: "clientName",
      email: "clientEmail",
      phone: "clientPhone",
      address: "projectAddress",
      message: "projectNotes",
    };
    return getLeadDynamicFields(lead)
      .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key))
      .map((field, index) => ({
        key: field.key,
        label: field.label,
        showInRow: ["phone", "subject"].includes(normalizeLeadFieldKey(field.key)),
        showInDetail: true,
        order: index,
        projectFieldTarget: targets[normalizeLeadFieldKey(field.key)] ?? "",
      }));
  }
  if (!lead || !formId) return defaultLayout;
  const form = formsById.get(formId);
  const rows: LeadFieldLayoutRow[] = form ? leadFormFieldLayout(form, lead.formFieldKeys) : [];
  const known = new Set(rows.map((row) => normalizeLeadFieldKey(row.key)));
  for (const field of getLeadDynamicFields(lead)) {
    const normalized = normalizeLeadFieldKey(field.key);
    if (known.has(normalized)) continue;
    known.add(normalized);
    rows.push({ key: field.key, label: field.label, showInRow: !form && rows.length < 2, showInDetail: true, order: rows.length, projectFieldTarget: "" });
  }
  return rows;
}

// A field's answer on a lead, as its pop-up shows it — a name field mapped to Client Name (or First / Last Name) from the
// name it's put together from.
export function resolveLeadColumnValue(
  fields: LeadDynamicField[],
  column: LeadFieldLayoutRow,
  fieldLayout: LeadFieldLayoutRow[],
) {
  const match = fields.find((field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(column.key));
  if (match?.value) return match.value;

  const nameParts = buildLeadClientNameParts(fields, fieldLayout);
  if (column.projectFieldTarget === "clientName") return nameParts.fullName;
  if (column.projectFieldTarget === "clientFirstName") return nameParts.firstName;
  if (column.projectFieldTarget === "clientLastName") return nameParts.lastName;

  const normalizedKey = normalizeLeadFieldKey(column.key);
  if (["name", "fullname", "clientname"].includes(normalizedKey)) {
    return nameParts.fullName;
  }
  return "";
}

// The fields its pop-up shows (none chosen: all of them).
export function leadDetailFields(layout: LeadFieldLayoutRow[]) {
  const configured = layout.filter((field) => field.showInDetail);
  return configured.length > 0 ? configured : layout;
}
