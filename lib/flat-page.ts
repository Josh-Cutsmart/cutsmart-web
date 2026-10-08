// Pages drawn on one flat colour — the page itself, its toolbar, its list and the top tab bar above
// it all the same, with no lines between them: a light grey, or in dark mode the app's own dark
// background (--bg-app). Used by the app shell and the top tab bar; the page draws its own parts in it.

export const FLAT_PAGE_BG = "#F5F7FA";
export const FLAT_PAGE_BG_DARK = "#0b0d12";

export function flatPageBg(isDark: boolean): string {
  return isDark ? FLAT_PAGE_BG_DARK : FLAT_PAGE_BG;
}

export function isFlatPage(pathname: string | null | undefined): boolean {
  return String(pathname || "").replace(/\/+$/, "") === "/dashboard";
}
