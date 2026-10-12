// A company's calendar categories (Company Settings > Calendar — Teamup's "sub-calendars"): their names, colours
// and who can see them. Plain values and rules only (no Firestore), so the app (lib/calendar-data.ts, which
// re-exports these) and the server (lib/calendar-reminders-server.ts) work them out the same way.

// Per-category access, keyed by normalized role id (normalizeRoleKey). A role with no entry gets View;
// owners and admins can always edit everything.
export type CalendarAccessLevel = "edit" | "view" | "none";
export type CalendarCategory = { id: string; name: string; color: string; access?: Record<string, CalendarAccessLevel> };

export function isCalendarAccessLevel(value: unknown): value is CalendarAccessLevel {
  return value === "edit" || value === "view" || value === "none";
}

export const DEFAULT_CALENDAR_CATEGORIES: CalendarCategory[] = [
  { id: "installs", name: "Installs", color: "#16A34A" },
  { id: "measures", name: "Measures", color: "#2F6BFF" },
  { id: "deliveries", name: "Deliveries", color: "#F2A33C" },
  { id: "meetings", name: "Meetings", color: "#8B5CF6" },
  { id: "leave", name: "Leave", color: "#DC2626" },
];

export function normalizeCalendarCategories(raw: unknown): CalendarCategory[] {
  if (!Array.isArray(raw)) return DEFAULT_CALENDAR_CATEGORIES;
  const seen = new Set<string>();
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      let id = String(row.id ?? "").trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      while (id && seen.has(id)) id = `${id}_2`;
      if (id) seen.add(id);
      const access: Record<string, CalendarAccessLevel> = {};
      if (row.access && typeof row.access === "object") {
        for (const [roleKey, level] of Object.entries(row.access as Record<string, unknown>)) {
          if (roleKey && isCalendarAccessLevel(level)) access[roleKey] = level;
        }
      }
      return { id, name, color: String(row.color ?? "").trim() || "#7D99B3", ...(Object.keys(access).length ? { access } : {}) };
    })
    .filter((row) => row.id && row.name);
}

// Who's looking: an owner or admin, their role (normalized — normalizeRoleKey), and whether they can open the
// Calendar at all (calendar.view).
export type CalendarViewer = { isAdmin: boolean; roleKey: string; canViewCalendar: boolean };

// What they can do with a category's events: owners and admins edit everything; anyone else gets the category's
// setting for their role, or View when it hasn't been set (None if they can't open the Calendar). An event whose
// category has since been deleted: View at most (only owners and admins change those).
export function calendarCategoryLevel(category: CalendarCategory | undefined, viewer: CalendarViewer): CalendarAccessLevel {
  if (viewer.isAdmin) return "edit";
  const fallback: CalendarAccessLevel = viewer.canViewCalendar ? "view" : "none";
  if (!category) return fallback;
  return category.access?.[viewer.roleKey] ?? fallback;
}
