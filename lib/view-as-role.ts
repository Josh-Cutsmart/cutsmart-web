"use client";

import { useMemo, useSyncExternalStore } from "react";

// "View as this role" (Company Settings › Staff & Permissions › a role's pop-up): an owner or admin seeing the app as
// someone with that role would — useCompanyAccess (lib/use-company-access.ts) answers with the role's permissions instead
// of their own, so what the role can't see or do drops out of the sidebar, pages and buttons. A preview only: it changes
// what's shown to them, not what they're allowed (the database still knows who they are). This tab only (sessionStorage),
// until they press Exit on its banner (components/view-as-role-banner.tsx).

export type ViewAsRole = { companyId: string; roleId: string; roleName: string; roleColor: string; permissionKeys: string[] };

const STORAGE_KEY = "cutsmart_view_as_role";
const CHANGE_EVENT = "cutsmart-view-as-role-change";

function readRaw(): string {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// Start (a role) or stop (null) seeing the app as a role.
export function setViewAsRole(viewAs: ViewAsRole | null) {
  try {
    if (viewAs) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(viewAs));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // (Not allowed: nothing changes.)
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// The role being viewed as (null: none).
export function useViewAsRole(): ViewAsRole | null {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  return useMemo(() => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<ViewAsRole>;
      if (!parsed.companyId || !parsed.roleId || !Array.isArray(parsed.permissionKeys)) return null;
      return {
        companyId: String(parsed.companyId),
        roleId: String(parsed.roleId),
        roleName: String(parsed.roleName || parsed.roleId),
        roleColor: String(parsed.roleColor || "#7D99B3"),
        permissionKeys: parsed.permissionKeys.map(String),
      };
    } catch {
      return null;
    }
  }, [raw]);
}
