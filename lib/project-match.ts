// The projects a piece of free text — a Calendar event's title as it's typed — is most likely about: its words against
// each project's name and client (and, counting for less, its address). Words that only say what's happening ("Site
// measure", "Install", "Meeting") or join others ("the", "and") don't count; words most projects share ("kitchen",
// "vanity", "road") count for little; numbers don't count; a word matches whole, by its start ("Pat" → Patel), or — a
// longer one — with one letter wrong ("Smyth" → Smith, but not "Best" → Test). The whole of a project's name in the text
// counts most of all.

type MatchableProject = {
  id: string;
  name: string;
  customer?: string;
  clientFirstName?: string;
  clientLastName?: string;
  clientAddress?: string;
  updatedAt?: string;
};

// What's happening, or joining words — never matched on.
const SKIP_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with", "re", "w",
  "site", "measure", "measures", "measuring", "remeasure", "install", "installs", "installing", "installation",
  "meeting", "meet", "dryfit", "dry", "fit", "delivery", "deliver", "pickup", "pick", "up", "template", "templating",
  "check", "checkup", "quote", "quoting", "design", "call", "phone", "visit", "appointment", "appt", "followup",
  "follow", "day", "days", "job", "project", "am", "pm", "morning", "afternoon", "start", "finish", "remedial",
  "remedials", "service", "fix", "repair", "consult", "consultation", "showroom", "drop", "off",
]);
// In most projects' names or addresses — a match on one of these alone means little.
const COMMON_WORDS = new Set([
  "kitchen", "kitchens", "laundry", "bathroom", "bathrooms", "vanity", "vanities", "wardrobe", "wardrobes", "scullery",
  "pantry", "office", "renovation", "reno", "new", "unit", "units", "entertainment", "living", "bedroom", "ensuite",
  "cabinet", "cabinets", "cabinetry", "joinery", "house", "home", "build", "fitout", "fit-out",
  "road", "rd", "street", "st", "avenue", "ave", "lane", "ln", "drive", "dr", "crescent", "cres", "place", "pl", "way",
  "terrace", "tce", "court", "ct", "close", "grove", "level", "east", "west", "north", "south",
]);

const wordsOf = (text: string) =>
  String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);

// Whether two words are the same with one letter changed, added or taken out.
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// How well one typed word matches one of a project's: whole, by its start, or a letter out (5 letters or more — in a
// short word, a letter out is another word: "Best", "Rest" and "Text" aren't "Test").
function wordMatch(typed: string, word: string): number {
  if (typed === word) return 1;
  if (typed.length >= 3 && word.length >= 3 && (word.startsWith(typed) || typed.startsWith(word))) return 0.75;
  if (typed.length >= 5 && word.length >= 5 && oneEditApart(typed, word)) return 0.6;
  return 0;
}

const isNumber = (word: string) => /^\d+$/.test(word);

// Whether a calendar event's title names a project — stricter than matchProjectsToText (the Calendar lifts these while
// the project's dragged to it): one of its words is one of the project's name's or its client's surname, whole — or with
// an "s" or two more ("Patels") — leaving out what's happening, common words and numbers; not its address, not a letter
// out, not the client's first name (first names are shared — the staff's own are all through the calendar's titles).
// `ignore`: words never to count (the company's staff's first names), lower case.
export function titleNamesProject(title: string, project: MatchableProject, ignore?: Set<string>): boolean {
  const counts = (word: string) =>
    word.length >= 3 && !SKIP_WORDS.has(word) && !COMMON_WORDS.has(word) && !isNumber(word) && !ignore?.has(word);
  const typed = wordsOf(title).filter(counts);
  if (!typed.length) return false;
  // The client's surname: their last name, or the last word of their name (all of it, when it's one word — a business).
  const clientWords = wordsOf(String(project.customer || ""));
  const surname = wordsOf(String(project.clientLastName || "")).at(-1) || clientWords.at(-1) || "";
  const names = [...wordsOf(project.name), surname].filter(counts);
  const same = (a: string, b: string) =>
    a === b || (Math.min(a.length, b.length) >= 4 && Math.abs(a.length - b.length) <= 2 && (a.startsWith(b) || b.startsWith(a)));
  return typed.some((word) => names.some((name) => same(word, name)));
}

export type ProjectMatch<T> = { project: T; score: number };

// The best matches for `text`, best first (as likely, the one changed most recently first) — none that only share a
// common word.
export function matchProjectsToText<T extends MatchableProject>(text: string, projects: T[], limit = 3): Array<ProjectMatch<T>> {
  const typed = wordsOf(text).filter((word) => !SKIP_WORDS.has(word) && !isNumber(word));
  if (!typed.length) return [];
  const typedText = ` ${wordsOf(text).join(" ")} `;
  const out: Array<ProjectMatch<T>> = [];
  for (const project of projects) {
    const nameWords = wordsOf(project.name);
    const clientWords = wordsOf([project.customer, project.clientFirstName, project.clientLastName].filter(Boolean).join(" "));
    const addressWords = wordsOf(String(project.clientAddress || ""));
    const fields: Array<{ words: string[]; weight: number }> = [
      { words: nameWords, weight: 1 },
      { words: clientWords, weight: 1 },
      { words: addressWords, weight: 0.6 },
    ];
    let score = 0;
    let strong = false;
    for (const word of typed) {
      let best = 0;
      for (const field of fields) {
        for (const candidate of field.words) {
          const match = wordMatch(word, candidate) * field.weight;
          if (match > best) best = match;
        }
      }
      if (!best) continue;
      const common = COMMON_WORDS.has(word);
      score += common ? best * 0.35 : best;
      if (!common && best >= 0.6) strong = true;
    }
    // The whole of its name, as it is, in the text.
    const nameText = nameWords.join(" ");
    if (nameWords.length > 1 && typedText.includes(` ${nameText} `)) {
      score += 2;
      strong = true;
    }
    if (strong && score >= 0.6) out.push({ project, score });
  }
  return out
    .sort((a, b) => b.score - a.score || String(b.project.updatedAt || "").localeCompare(String(a.project.updatedAt || "")))
    .slice(0, limit);
}
