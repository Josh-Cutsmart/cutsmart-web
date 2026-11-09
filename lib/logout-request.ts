// Asking to log out from a page (User Settings' log out button): the app shell (components/app-shell.tsx) hears it and
// opens its own "Log out?" — the same one as the menus', growing out of the button pressed.

export const REQUEST_LOGOUT_EVENT = "cutsmart:request-logout";

export type LogoutRequestDetail = { origin: { left: number; top: number; width: number; height: number } | null; originEl: HTMLElement | null };

export function requestLogout(from?: HTMLElement | null) {
  if (typeof window === "undefined") return;
  const rect = from?.getBoundingClientRect();
  const detail: LogoutRequestDetail = {
    origin: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
    originEl: from ?? null,
  };
  window.dispatchEvent(new CustomEvent(REQUEST_LOGOUT_EVENT, { detail }));
}
