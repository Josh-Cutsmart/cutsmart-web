"use client";

// Per-device UI preferences (User Settings) — deliberately localStorage-only, not synced to the
// account like the profile fields in lib/membership.ts. Both only affect how THIS browser renders
// the app, not any shared/team-visible data, so there's no reason to round-trip them through
// Firestore — same reasoning as lib/theme-mode.ts, which this mirrors (including the
// storage-key-plus-CustomEvent shape, so a change in one tab/component is picked up immediately by
// every other mounted component reading the same preference, without a page reload).

export const MOBILE_TOP_BAR_STORAGE_KEY = "cutsmart_mobile_top_bar_enabled";
export const MOBILE_TOP_BAR_UPDATED_EVENT = "cutsmart:mobile-top-bar-updated";
export const DASHBOARD_STAT_CARDS_STORAGE_KEY = "cutsmart_dashboard_stat_cards_enabled";
export const DASHBOARD_STAT_CARDS_UPDATED_EVENT = "cutsmart:dashboard-stat-cards-updated";

// Absent key = existing behavior = enabled. Only an explicit "0" turns either off.
function readBooleanPref(key: string): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(key);
  return raw === null ? true : raw === "1";
}

function saveBooleanPref(key: string, event: string, enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, enabled ? "1" : "0");
  window.dispatchEvent(new CustomEvent<{ enabled: boolean }>(event, { detail: { enabled } }));
}

export function readMobileTopBarEnabled(): boolean {
  return readBooleanPref(MOBILE_TOP_BAR_STORAGE_KEY);
}

export function saveMobileTopBarEnabled(enabled: boolean) {
  saveBooleanPref(MOBILE_TOP_BAR_STORAGE_KEY, MOBILE_TOP_BAR_UPDATED_EVENT, enabled);
}

export function readDashboardStatCardsEnabled(): boolean {
  return readBooleanPref(DASHBOARD_STAT_CARDS_STORAGE_KEY);
}

export function saveDashboardStatCardsEnabled(enabled: boolean) {
  saveBooleanPref(DASHBOARD_STAT_CARDS_STORAGE_KEY, DASHBOARD_STAT_CARDS_UPDATED_EVENT, enabled);
}
