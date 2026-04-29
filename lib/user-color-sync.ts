"use client";

export const USER_COLOR_UPDATED_EVENT = "cutsmart:user-color-updated";

export type UserColorUpdatedDetail = {
  uid: string;
  color: string;
  companyId?: string;
};

export function dispatchUserColorUpdated(detail: UserColorUpdatedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<UserColorUpdatedDetail>(USER_COLOR_UPDATED_EVENT, { detail }));
}
