// A project's notes as HTML that's safe to put on the page (the notes cards, drawers, remedials, the New Project pop-up). Notes can
// come from anyone: a lead form, an email to the leads inbox, a teammate. Shown as they were stored, a <script> or an onerror in them
// would run as whoever is looking. So they're rebuilt from what the notes editor itself makes (components/quote-document-editor.tsx:
// paragraphs, bold, italic, underline, strikethrough, lists, alignment), plus headings and links older notes may have. Anything else
// is dropped: its tag (its text is kept), every attribute but a few known-safe ones, and scripts, styles, frames, images and other
// embeds whole. Nothing stored is changed; this is only how it's shown.

export function escapeNotesHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Plain text (a lead form's answer, an email) as notes: shown exactly as typed, never as page code.
export function plainTextToNotesHtml(value: unknown): string {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeNotesHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

// Kept as they are, their attributes dropped (bar the ones below).
const KEPT_TAGS = new Set([
  "p", "div", "br", "strong", "em", "u", "s", "ul", "ol", "li", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6", "sub", "sup", "code", "pre", "hr", "a", "span",
]);
// Written as the tag beside them.
const SAME_AS: Record<string, string> = { b: "strong", i: "em", strike: "s", del: "s" };
// Dropped with everything in them.
const DROPPED_WHOLE = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "img", "picture", "video", "audio", "source", "track",
  "svg", "math", "canvas", "form", "input", "button", "select", "textarea", "option", "link", "meta", "base", "template", "noscript",
  "title", "head", "portal", "param", "dialog",
]);
const NO_CLOSE = new Set(["br", "hr"]);
const ALIGNED = new Set(["p", "div", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"]);

// Only alignment, and plain colours, survive in a style.
function safeStyle(raw: string, tag: string): string {
  const out: string[] = [];
  for (const part of String(raw || "").split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    if (name === "text-align" && ALIGNED.has(tag) && /^(left|center|right|justify)$/i.test(value)) out.push(`text-align:${value.toLowerCase()}`);
    if ((name === "color" || name === "background-color") && /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\))$/i.test(value)) out.push(`${name}:${value}`);
  }
  return out.join(";");
}

// A link only to the web, an email address or a phone number.
function safeHref(raw: string): string {
  const href = String(raw || "").trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(href) ? href : "";
}

export function sanitizeNotesHtml(value: string): string {
  // (Without a page to read it with — rendering on the server — just its words.)
  if (typeof document === "undefined") {
    return escapeNotesHtml(String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  }
  // (A template's contents are inert: nothing in them loads or runs while they're read.)
  const template = document.createElement("template");
  template.innerHTML = String(value ?? "");

  const render = (node: Node): string => {
    if (node.nodeType === 3) return escapeNotesHtml(node.textContent ?? "");
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    const name = element.tagName.toLowerCase();
    if (DROPPED_WHOLE.has(name)) return "";
    const children = Array.from(element.childNodes).map(render).join("");
    const tag = SAME_AS[name] ?? name;
    if (!KEPT_TAGS.has(tag)) return children;
    const attrs: string[] = [];
    if (tag === "a") {
      const href = safeHref(element.getAttribute("href") ?? "");
      if (!href) return children;
      attrs.push(`href="${escapeNotesHtml(href)}"`, 'target="_blank"', 'rel="noopener noreferrer"');
    }
    const style = safeStyle(element.getAttribute("style") ?? "", tag);
    if (style) attrs.push(`style="${escapeNotesHtml(style)}"`);
    const open = `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
    return NO_CLOSE.has(tag) ? open : `${open}${children}</${tag}>`;
  };

  return Array.from(template.content.childNodes).map(render).join("");
}

// Notes as stored (the editor's HTML, or older plain text), ready to show.
export function notesToDisplayHtml(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw.trim()) return "";
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  if (looksLikeHtml) return sanitizeNotesHtml(raw);
  return escapeNotesHtml(raw).replace(/\n/g, "<br />");
}
