// A company's lead forms (Company Settings → Leads): the questions people answer — on the company's website
// (each form's public page / embed), or by staff with Create Lead on the Leads page. Saved on the company doc
// (`leadForms`). Shared by the browser and the server, so both read, check and file answers the same way.
//
// A lead made from a form keeps its answers in rawFields — the same place a Zapier lead keeps its fields, so the
// Leads page shows both the same way — each under its question's label (answerKeys), with formFieldKeys saying
// which question each one answered (a question renamed later still finds its answers). A question's settings
// stand in for the Zapier field layout (Company Settings → Integrations): whether it shows on the lead's card or
// in its pop-up, and what it fills in when the lead becomes a project.

export type LeadFormFieldTarget =
  | ""
  | "clientName"
  | "clientFirstName"
  | "clientLastName"
  | "clientPhone"
  | "clientEmail"
  | "projectAddress"
  | "projectNotes";

export type LeadFormQuestionType =
  | "shortText"
  | "longText"
  | "email"
  | "phone"
  | "address"
  | "number"
  | "date"
  | "dropdown"
  | "choice"
  | "checkboxes";

export type LeadFormQuestion = {
  id: string;
  type: LeadFormQuestionType;
  label: string;
  placeholder: string;
  help: string;
  required: boolean;
  // The choices — dropdown, choice (pick one) and checkboxes (pick any).
  options: string[];
  // What it fills in when the lead becomes a project ("" — nothing).
  mapsTo: LeadFormFieldTarget;
  // On the lead's card on the Leads board / list.
  showOnCard: boolean;
  // In the lead's pop-up.
  showInDetail: boolean;
};

export type LeadForm = {
  id: string;
  // What the company calls it (e.g. "Website enquiry") — the lead's "came in from".
  name: string;
  // Shown at the top of the form, and the intro under it.
  title: string;
  intro: string;
  submitLabel: string;
  thankYouMessage: string;
  questions: LeadFormQuestion[];
  createdAtIso: string;
  updatedAtIso: string;
};

// An answer as typed: text, or the boxes ticked (checkboxes).
export type LeadFormAnswerValue = string | string[];
export type LeadFormAnswers = Record<string, LeadFormAnswerValue>;

export const LEAD_FORM_QUESTION_TYPES: Array<{ type: LeadFormQuestionType; label: string; hasOptions: boolean }> = [
  { type: "shortText", label: "Short answer", hasOptions: false },
  { type: "longText", label: "Paragraph", hasOptions: false },
  { type: "email", label: "Email", hasOptions: false },
  { type: "phone", label: "Phone", hasOptions: false },
  { type: "address", label: "Address", hasOptions: false },
  { type: "number", label: "Number", hasOptions: false },
  { type: "date", label: "Date", hasOptions: false },
  { type: "dropdown", label: "Dropdown", hasOptions: true },
  { type: "choice", label: "Pick one", hasOptions: true },
  { type: "checkboxes", label: "Tick boxes", hasOptions: true },
];

export const LEAD_FORM_FIELD_TARGETS: Array<{ value: LeadFormFieldTarget; label: string }> = [
  { value: "", label: "Nothing" },
  { value: "clientName", label: "Client name" },
  { value: "clientFirstName", label: "Client first name" },
  { value: "clientLastName", label: "Client last name" },
  { value: "clientPhone", label: "Client phone" },
  { value: "clientEmail", label: "Client email" },
  { value: "projectAddress", label: "Project address" },
  { value: "projectNotes", label: "Project notes" },
];

// How a lead made with Create Lead came in (the lead's sourceDetail).
export const MANUAL_LEAD_SOURCES = ["Phone call", "Walk-in", "Email", "Referral", "Social media", "Expo / event", "Website", "Other"] as const;

const QUESTION_TYPES = new Set<string>(LEAD_FORM_QUESTION_TYPES.map((row) => row.type));
const FIELD_TARGETS = new Set<string>(LEAD_FORM_FIELD_TARGETS.map((row) => row.value));
// rawFields keys the Leads page treats as the lead's own (lib/lead-name.ts, the Leads page) — never an answer's.
const RESERVED_ANSWER_KEYS = new Set(["companyid", "source", "status"]);
const MAX_SHORT_ANSWER = 500;
const MAX_LONG_ANSWER = 5000;
const MAX_QUESTIONS = 60;
const MAX_OPTIONS = 40;

export function leadFormQuestionHasOptions(type: LeadFormQuestionType) {
  return type === "dropdown" || type === "choice" || type === "checkboxes";
}

export function leadFormQuestionTypeLabel(type: LeadFormQuestionType) {
  return LEAD_FORM_QUESTION_TYPES.find((row) => row.type === type)?.label ?? "Short answer";
}

function toStr(value: unknown) {
  return String(value ?? "").trim();
}

// A random id — crypto's where there is one (the browser and the server both have it).
export function randomLeadFormId(prefix: string, length = 10) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `${prefix}${out}`;
}

export function newLeadFormQuestion(type: LeadFormQuestionType = "shortText", label = ""): LeadFormQuestion {
  return {
    id: randomLeadFormId("q_", 8),
    type,
    label,
    placeholder: "",
    help: "",
    required: false,
    options: leadFormQuestionHasOptions(type) ? ["Option 1", "Option 2"] : [],
    mapsTo: "",
    showOnCard: false,
    showInDetail: true,
  };
}

// A new form, with the questions most enquiry forms start from.
export function newLeadForm(name = "Website enquiry"): LeadForm {
  const now = new Date().toISOString();
  const question = (type: LeadFormQuestionType, label: string, extra: Partial<LeadFormQuestion>): LeadFormQuestion => ({
    ...newLeadFormQuestion(type, label),
    ...extra,
  });
  return {
    id: randomLeadFormId("f_", 10),
    name,
    title: "Get in touch",
    intro: "Tell us a little about your project and we'll be in touch.",
    submitLabel: "Send",
    thankYouMessage: "Thanks! We've got your details and we'll be in touch soon.",
    questions: [
      question("shortText", "First name", { required: true, mapsTo: "clientFirstName" }),
      question("shortText", "Last name", { mapsTo: "clientLastName" }),
      question("phone", "Phone", { required: true, mapsTo: "clientPhone", showOnCard: true }),
      question("email", "Email", { mapsTo: "clientEmail" }),
      question("address", "Address", { mapsTo: "projectAddress", showOnCard: true }),
      question("longText", "Tell us about your project", { mapsTo: "projectNotes" }),
    ],
    createdAtIso: now,
    updatedAtIso: now,
  };
}

// A copy of a form, with new ids (its own link, its own questions).
export function duplicateLeadForm(form: LeadForm): LeadForm {
  const now = new Date().toISOString();
  return {
    ...form,
    id: randomLeadFormId("f_", 10),
    name: `${form.name || "Form"} (copy)`,
    questions: form.questions.map((question) => ({ ...question, id: randomLeadFormId("q_", 8), options: [...question.options] })),
    createdAtIso: now,
    updatedAtIso: now,
  };
}

function normalizeQuestion(raw: unknown, index: number): LeadFormQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const type = QUESTION_TYPES.has(toStr(row.type)) ? (toStr(row.type) as LeadFormQuestionType) : "shortText";
  const mapsTo = FIELD_TARGETS.has(toStr(row.mapsTo)) ? (toStr(row.mapsTo) as LeadFormFieldTarget) : "";
  const options = Array.isArray(row.options)
    ? row.options.map((option) => String(option ?? "").slice(0, 200)).slice(0, MAX_OPTIONS)
    : [];
  return {
    id: toStr(row.id) || `q_${index + 1}`,
    type,
    label: String(row.label ?? "").slice(0, 200),
    placeholder: String(row.placeholder ?? "").slice(0, 200),
    help: String(row.help ?? "").slice(0, 500),
    required: Boolean(row.required),
    options,
    mapsTo,
    showOnCard: Boolean(row.showOnCard),
    showInDetail: row.showInDetail == null ? true : Boolean(row.showInDetail),
  };
}

export function normalizeLeadForm(raw: unknown, index = 0): LeadForm | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = toStr(row.id);
  if (!id) return null;
  const seenQuestionIds = new Set<string>();
  const questions = (Array.isArray(row.questions) ? row.questions : [])
    .map((question, questionIndex) => normalizeQuestion(question, questionIndex))
    .filter((question): question is LeadFormQuestion => {
      if (!question || seenQuestionIds.has(question.id)) return false;
      seenQuestionIds.add(question.id);
      return true;
    })
    .slice(0, MAX_QUESTIONS);
  return {
    id,
    name: String(row.name ?? "").slice(0, 120) || `Form ${index + 1}`,
    title: String(row.title ?? "").slice(0, 200),
    intro: String(row.intro ?? "").slice(0, 2000),
    submitLabel: String(row.submitLabel ?? "").slice(0, 60),
    thankYouMessage: String(row.thankYouMessage ?? "").slice(0, 2000),
    questions,
    createdAtIso: toStr(row.createdAtIso),
    updatedAtIso: toStr(row.updatedAtIso),
  };
}

export function normalizeLeadForms(raw: unknown): LeadForm[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .map((form, index) => normalizeLeadForm(form, index))
    .filter((form): form is LeadForm => {
      if (!form || seen.has(form.id)) return false;
      seen.add(form.id);
      return true;
    });
}

// The key each question's answer is filed under in a lead's rawFields: its label (what the Leads page shows),
// made unique within the form — a second "Notes" is "Notes 2" — and never one of the lead's own field names.
export function leadFormAnswerKeys(form: LeadForm): Record<string, string> {
  const keys: Record<string, string> = {};
  const used = new Set<string>();
  form.questions.forEach((question, index) => {
    const base = question.label.trim() || `Question ${index + 1}`;
    let key = RESERVED_ANSWER_KEYS.has(base.toLowerCase().replace(/[^a-z0-9]+/g, "")) ? `${base} (answer)` : base;
    let n = 2;
    while (used.has(key.toLowerCase())) {
      key = `${base} ${n}`;
      n += 1;
    }
    used.add(key.toLowerCase());
    keys[question.id] = key;
  });
  return keys;
}

// The Leads page's field layout for a lead made from this form (its questions, in order), so its card and pop-up
// show that form's questions — with each answer found under the key it was saved with (the lead's formFieldKeys),
// else the key it'd be saved under now.
export function leadFormFieldLayout(form: LeadForm, savedKeys?: Record<string, string>) {
  const currentKeys = leadFormAnswerKeys(form);
  return form.questions.map((question, index) => ({
    key: toStr(savedKeys?.[question.id]) || currentKeys[question.id],
    label: question.label.trim() || `Question ${index + 1}`,
    showInRow: question.showOnCard,
    showInDetail: question.showInDetail,
    order: index,
    projectFieldTarget: question.mapsTo,
  }));
}

function digitCount(value: string) {
  return (value.match(/\d/g) || []).length;
}

export type LeadFormSubmission = {
  // Per question id: what's wrong with its answer ("" — nothing).
  errors: Record<string, string>;
  // The answers, filed for the lead (see leadFormAnswerKeys).
  rawFields: Record<string, string>;
  formFieldKeys: Record<string, string>;
  // The lead's own name/email/phone/message, from the questions that fill those in (else the first email /
  // phone question).
  contact: { name: string; email: string; phone: string; message: string };
  answeredCount: number;
};

// Checks a form's answers and files them for a lead. skipRequired: staff entering a lead by hand may not have
// everything a customer must give.
export function collectLeadFormAnswers(form: LeadForm, answers: LeadFormAnswers, options: { skipRequired?: boolean } = {}): LeadFormSubmission {
  const keys = leadFormAnswerKeys(form);
  const errors: Record<string, string> = {};
  const rawFields: Record<string, string> = {};
  const formFieldKeys: Record<string, string> = {};
  const byTarget: Partial<Record<LeadFormFieldTarget, string>> = {};
  let firstEmail = "";
  let firstPhone = "";
  let answeredCount = 0;

  for (const question of form.questions) {
    const raw = answers[question.id];
    let text = "";
    if (question.type === "checkboxes") {
      const ticked = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((value) => String(value).trim()).filter((value) => question.options.includes(value));
      text = ticked.join(", ");
    } else {
      text = String(Array.isArray(raw) ? raw.join(", ") : (raw ?? "")).trim();
      if ((question.type === "dropdown" || question.type === "choice") && text && !question.options.includes(text)) text = "";
      text = text.slice(0, question.type === "longText" ? MAX_LONG_ANSWER : MAX_SHORT_ANSWER);
    }

    if (!text) {
      if (question.required && !options.skipRequired) errors[question.id] = "Please fill this in.";
      continue;
    }
    if (question.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      errors[question.id] = "That doesn't look like an email address.";
      continue;
    }
    if (question.type === "phone" && digitCount(text) < 6) {
      errors[question.id] = "That doesn't look like a phone number.";
      continue;
    }
    if (question.type === "number" && !Number.isFinite(Number(text.replace(/,/g, "")))) {
      errors[question.id] = "Please enter a number.";
      continue;
    }

    answeredCount += 1;
    rawFields[keys[question.id]] = text;
    formFieldKeys[question.id] = keys[question.id];
    if (question.mapsTo && !byTarget[question.mapsTo]) byTarget[question.mapsTo] = text;
    if (question.type === "email" && !firstEmail) firstEmail = text;
    if (question.type === "phone" && !firstPhone) firstPhone = text;
  }

  const name = byTarget.clientName || [byTarget.clientFirstName, byTarget.clientLastName].filter(Boolean).join(" ");
  return {
    errors,
    rawFields,
    formFieldKeys,
    contact: {
      name,
      email: byTarget.clientEmail || firstEmail,
      phone: byTarget.clientPhone || firstPhone,
      message: byTarget.projectNotes || "",
    },
    answeredCount,
  };
}
