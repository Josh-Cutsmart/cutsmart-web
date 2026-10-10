// Pages drawn on one flat colour — the page itself, its toolbar, its list and the top tab bar above
// it all the same, with no lines between them: a light grey, or in dark mode the app's own dark
// background (--bg-app). Used by the app shell and the top tab bar; the page draws its own parts in it.

export const FLAT_PAGE_BG = "#F5F7FA";
export const FLAT_PAGE_BG_DARK = "#0b0d12";

export function flatPageBg(isDark: boolean): string {
  return isDark ? FLAT_PAGE_BG_DARK : FLAT_PAGE_BG;
}

const FLAT_PAGES = new Set(["/dashboard", "/calendar"]);

export function isFlatPage(pathname: string | null | undefined): boolean {
  return FLAT_PAGES.has(String(pathname || "").replace(/\/+$/, ""));
}

// Phones/tablets, where <main> is the page's scroller: pages where it starts at the very top of the
// screen, under the see-through top tab bar, instead of below it (app-shell.tsx, globals.css) —
// otherwise it cuts off the shadows of the cards at the top of the page in a hard line along the bar.
// The flat pages, Company Settings and Project details (its header bars still pin just under the bar
// — a sticky bar pins inside <main>'s top padding, which is the bar's height then — and the page
// scrolls under the bar's glass above them). Not Archived or Changelog: their own bars aren't set up
// for it. Not User Settings: on a phone its own bar is fixed right under the top tab bar, covering
// where anything would show.
const UNDER_BAR_PAGES = new Set(["/company-settings"]);

export function startsUnderTopBar(pathname: string | null | undefined): boolean {
  const path = String(pathname || "").replace(/\/+$/, "");
  return isFlatPage(path) || UNDER_BAR_PAGES.has(path) || /^\/projects\/[^/]+$/.test(path);
}
