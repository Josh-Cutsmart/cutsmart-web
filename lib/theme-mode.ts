"use client";

export type ThemeMode = "light" | "dark";

export const THEME_MODE_STORAGE_KEY = "cutsmart_theme_mode";
export const THEME_MODE_UPDATED_EVENT = "cutsmart:theme-mode-updated";

export function normalizeThemeMode(value: unknown): ThemeMode {
  return String(value || "").trim().toLowerCase() === "dark" ? "dark" : "light";
}

export function readThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return normalizeThemeMode(window.localStorage.getItem(THEME_MODE_STORAGE_KEY));
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const next = normalizeThemeMode(mode);
  document.documentElement.setAttribute("data-theme", next);
  document.body.setAttribute("data-theme", next);
  document.documentElement.style.colorScheme = next;
  document.body.style.colorScheme = next;
}

export function saveThemeMode(mode: ThemeMode) {
  const next = normalizeThemeMode(mode);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, next);
  }
  applyThemeMode(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<{ mode: ThemeMode }>(THEME_MODE_UPDATED_EVENT, { detail: { mode: next } }));
  }
}
