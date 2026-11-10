// Reading notification-messages.txt (the wording of every notification, kept out of the code — lib/notification-messages.ts
// loads it), and filling a wording in. Its original wording is kept here too: any line missing from the file, or with a
// {word} that notification doesn't have, uses this instead, so a slip in the file can't send a blank notification or a raw
// {project}.

export type NotificationVars = Record<string, string | number>;
type Fields = Record<string, string>;

export const NOTIFICATION_DEFAULTS = {
  "project_access.added": { title: "Added to a project", message: '{person} added you to "{project}" as {role}.' },
  "project_access.changed": { title: "Project access changed", message: '{person} made you {role} on "{project}".' },
  project_assigned: { title: "Assigned to a project", message: 'You were assigned to "{project}".' },
  "project_assigned.automation": { title: "Assigned to a project", message: "\"{project}\" was assigned to you — {column}'s automation." },
  project_unassigned: { title: "Removed from a project", message: 'You were removed from "{project}".' },
  production_unlock_request: {
    title: "Production unlock request",
    message: '{person} asked to unlock production on "{project}".',
    button_accept: "Accept",
    button_decline: "Decline",
  },
  "production_unlock_response.accepted": {
    title: "Production unlocked",
    message: '{person} accepted your request — you can edit production on "{project}" for {hours}.',
  },
  "production_unlock_response.declined": {
    title: "Unlock request declined",
    message: '{person} declined your request to unlock production on "{project}".',
  },
  "production_unlock_tap.accepted": { title: "CutSmart", message: "Accepted — {person} can edit production for {hours}." },
  "production_unlock_tap.declined": { title: "CutSmart", message: "Declined — {person} has been told." },
  "production_unlock_tap.already_answered": { title: "CutSmart", message: "Someone has already answered this request." },
  quote_discount_request: {
    title: "Discount request",
    message: '{person} asked for {new_total} on "{project}" — {amount_off} off {old_total}.',
    button_accept: "Accept",
    button_decline: "Decline",
  },
  quote_discount_counter: {
    title: "Counter offer",
    message: '{person} offered {new_total} on "{project}" instead — {amount_off} off {old_total}.',
    button_accept: "Accept",
    button_decline: "Decline",
  },
  "quote_discount_response.approved": { title: "Discount accepted", message: '{person} accepted {new_total} on "{project}" — {amount_off} off.' },
  "quote_discount_response.approved_unsent": {
    title: "Discount accepted",
    message: '{person} accepted {new_total} on "{project}". The quote has been taken off the client portal — send the new one when you\'re ready.',
  },
  "quote_discount_response.declined": { title: "Discount declined", message: '{person} declined your discount on "{project}".' },
  "quote_discount_response.counter_accepted": { title: "Counter offer accepted", message: '{person} accepted {new_total} on "{project}".' },
  "quote_discount_response.counter_accepted_unsent": {
    title: "Counter offer accepted",
    message: '{person} accepted {new_total} on "{project}". The quote has been taken off the client portal.',
  },
  "quote_discount_response.counter_declined": { title: "Counter offer declined", message: '{person} declined your counter offer on "{project}".' },
  "quote_discount_tap.approved": { title: "CutSmart", message: "Accepted — {person} has been told." },
  "quote_discount_tap.declined": { title: "CutSmart", message: "Declined — {person} has been told." },
  "quote_discount_tap.counter_accepted": { title: "CutSmart", message: "Accepted — the quote's new total is {new_total}." },
  "quote_discount_tap.counter_declined": { title: "CutSmart", message: "Declined — {person} has been told." },
  "quote_discount_tap.already_answered": { title: "CutSmart", message: "This discount has already been answered." },
  "lead_new.email": { title: "New Lead", message: "From Email: {sender}" },
  "lead_new.form": { title: "New Lead", message: "From Form: {name}" },
  "lead_new.manual": { title: "New Lead", message: "From Create Lead: {name}" },
  "lead_new.other": { title: "New Lead", message: "From Zapier: {name}" },
  lead_access: { title: "Added to a lead", message: '{person} added you to the lead "{lead}".' },
  "lead_access.automation": { title: "Added to a lead", message: "The lead \"{lead}\" was assigned to you — {column}'s automation." },
  "column_automation.thing": { project: '"{name}"', lead: 'The lead "{name}"' },
  "column_automation.enters": { title: "Moved into {column}", message: "{thing} moved into {column}." },
  "column_automation.leaves": { title: "Moved out of {column}", message: "{thing} moved out of {column} — now in {new_column}." },
  "column_automation.leaves_unknown": { title: "Moved out of {column}", message: "{thing} moved out of {column}." },
  "column_automation.stays": { title: "Still in {column}", message: "{thing} has been in {column} for {time}." },
  "column_automation.moved_on": { title: "Moved into {column}", message: "{thing} moved into {column}." },
  "column_automation.became_project": { title: "Moved into {column}", message: "{thing} moved into {column} and became a project." },
  quote_accepted: { title: "Quote accepted for {project}", message: "{client} accepted your quote for {price}" },
  "quote_accepted.no_price": { title: "Quote accepted for {project}", message: "{client} accepted your quote" },
  "quote_accepted.on_behalf": { title: "Quote accepted for {project}", message: "Accepted on behalf of {client} by {staff} — {price}" },
  "quote_accepted.on_behalf_no_price": { title: "Quote accepted for {project}", message: "Accepted on behalf of {client} by {staff}" },
  quote_declined: { title: "Quote declined", message: '{client} declined quote for {project}: "{reason}"' },
  "quote_declined.no_reason": { title: "Quote declined", message: "{client} declined quote for {project}" },
  specs_submitted: { title: "Specifications Submitted for {project}", message: "{client} submitted the specifications ({accepted}/{total}) accepted" },
  "specs_submitted.no_confirmations": { title: "Specifications Submitted for {project}", message: "{client} submitted the specifications" },
  "specs_submitted.on_behalf": { title: "Specifications Submitted for {project}", message: "Submitted on behalf of {client} by {staff}" },
  quote_sent: { title: "Quote sent to client", message: '{person} sent a Quote for "{project}" to the client.' },
  specs_sent: { title: "Specifications sent to client", message: '{person} sent Specifications for "{project}" to the client.' },
  quote_pending: { title: "Quote not accepted yet", message: "{client} hasn't accepted the quote for {project} yet — sent {ago}." },
  specs_pending: { title: "Specifications not submitted yet", message: "{client} hasn't submitted the specifications for {project} yet — sent {ago}." },
  calendar_reminder: { title: "Upcoming: {event}", message: '"{event}" for {project} is {when}.' },
  "calendar_reminder.no_project": { title: "Upcoming: {event}", message: '"{event}" is {when}.' },
  // An event's line in a notification of several together — shorter than its own, without its project.
  "calendar_reminder.in_group": { message: '"{event}" is {when}.' },
  app_version: { title: "New version {version}", message: "CutSmart has been updated.", phone: "See what's new in CutSmart." },
  role_change: { title: "Role updated", message: 'Your role in {company} changed from "{old_role}" to "{new_role}".' },
  access_code_used: { title: "Access code used", message: "{person} joined with your access code {code}." },
  "access_code_used.with_label": { title: "Access code used", message: "{person} joined with your access code {code} ({label})." },
  group: { mixed_title: "{count} new notifications", more: "and {count} more" },
  group_phrases: {
    project_access: "project shared with you | projects shared with you",
    project_assigned: "project assigned to you | projects assigned to you",
    project_unassigned: "project reassigned | projects reassigned",
    production_unlock_request: "unlock request | unlock requests",
    production_unlock_response: "unlock request answered | unlock requests answered",
    quote_discount_request: "discount request | discount requests",
    quote_discount_counter: "counter offer | counter offers",
    quote_discount_response: "discount answered | discounts answered",
    lead_new: "new lead | new leads",
    lead_access: "lead assigned to you | leads assigned to you",
    quote_accepted: "quote accepted | quotes accepted",
    quote_declined: "quote declined | quotes declined",
    specs_submitted: "specification submitted | specifications submitted",
    quote_sent: "quote sent | quotes sent",
    specs_sent: "specification sent | specifications sent",
    calendar_reminder: "new event coming up | new events coming up",
    quote_pending: "quote waiting on a client | quotes waiting on clients",
    specs_pending: "specification waiting on a client | specifications waiting on clients",
    app_version: "new version | new versions",
    role_change: "role change | role changes",
    access_code_used: "access code used | access codes used",
    other: "notification | notifications",
  },
} as const;

export type NotificationKey = keyof typeof NOTIFICATION_DEFAULTS;

// The file's sections: `[name]`, then `field: words` on a line each. Lines starting with #, and blank ones, are skipped.
export function parseNotificationMessages(text: string): Record<string, Fields> {
  const sections: Record<string, Fields> = {};
  let current: Fields | null = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const heading = /^\[([\w.]+)\]$/.exec(line);
    if (heading) {
      current = sections[heading[1]] ?? {};
      sections[heading[1]] = current;
      continue;
    }
    const colon = line.indexOf(":");
    if (!current || colon < 1) continue;
    current[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return sections;
}

const wordsIn = (template: string) => Array.from(template.matchAll(/\{([^{}]*)\}/g), (match) => match[1]);

// The words a notification can use: every {word} in its original wording, across its lines.
function allowedWords(key: NotificationKey): Set<string> {
  const fields = NOTIFICATION_DEFAULTS[key] as Fields;
  return new Set(Object.values(fields).flatMap(wordsIn));
}

// Filled in once, so a {word} in a name someone typed is left alone.
const fill = (template: string, vars: NotificationVars) =>
  template.replace(/\{([^{}]*)\}/g, (_match, word: string) => (word in vars ? String(vars[word]) : ""));

export function notificationBook(fileText: string) {
  const sections = parseNotificationMessages(fileText);
  // A line as it stands, not filled in: the file's, if it's there and only uses that notification's own {words}.
  const template = (key: NotificationKey, field: string): string => {
    const fallback = (NOTIFICATION_DEFAULTS[key] as Fields)[field] ?? "";
    const fromFile = sections[key]?.[field];
    if (!fromFile) return fallback;
    const allowed = allowedWords(key);
    return wordsIn(fromFile).every((word) => allowed.has(word)) ? fromFile : fallback;
  };
  const words = (key: NotificationKey, field: string, vars: NotificationVars = {}) => fill(template(key, field), vars);
  return {
    template,
    words,
    // A notification's title and message.
    text: (key: NotificationKey, vars: NotificationVars = {}) => ({ title: words(key, "title", vars), message: words(key, "message", vars) }),
    // "3 new leads", "1 quote accepted".
    groupPhrase: (type: string, count: number) => {
      const fallback = (NOTIFICATION_DEFAULTS.group_phrases as Fields)[type] ?? NOTIFICATION_DEFAULTS.group_phrases.other;
      const [one, many] = (sections.group_phrases?.[type] || fallback).split("|").map((part) => part.trim());
      const [oneDefault, manyDefault] = fallback.split("|").map((part) => part.trim());
      return `${count} ${count === 1 ? one || oneDefault : many || manyDefault}`;
    },
  };
}
