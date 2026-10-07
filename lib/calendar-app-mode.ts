"use client";

import { homeScreenApp, useHomeScreenApp } from "@/lib/home-screen-app";

// The Calendar's own home-screen app — see lib/home-screen-app.ts, which works out which of the
// home-screen icons (Calendar, Leads, Contacts) opened this session.

export function isCalendarAppMode(): boolean {
  return homeScreenApp() === "calendar";
}

// Whether this session is the Calendar home-screen app. False on the server and while hydrating.
export function useCalendarAppMode(): boolean {
  return useHomeScreenApp() === "calendar";
}
