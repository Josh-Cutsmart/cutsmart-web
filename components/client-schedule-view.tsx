"use client";

import { useState } from "react";
import type { ClientScheduleEvent } from "@/lib/calendar-data";

// The client portal's Schedule tab: the project's shared events as a list, one heading per day —
// the same layout as the staff calendar's List view. Days still to come first, then what's already
// happened under "Done". Uses the portal's own fixed light palette (no app theme on this public page).

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number | Date): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
const time = (ms: number) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(ms)).toLowerCase().replace(" ", "");
const dayHeading = (d: Date) => new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);

type DayGroup = { day: Date; items: ClientScheduleEvent[] };

// Every day each event covers (a multi-day event is listed under each of its days, like the staff List).
function groupByDay(events: ClientScheduleEvent[]): DayGroup[] {
  const byDay = new Map<number, ClientScheduleEvent[]>();
  for (const e of events) {
    const last = startOfDay(e.allDay ? e.endMs - DAY_MS : Math.max(e.startMs, e.endMs - 1));
    for (let d = startOfDay(e.startMs), n = 0; d <= last && n < 366; d = addDays(d, 1), n += 1) {
      const key = d.getTime();
      byDay.set(key, [...(byDay.get(key) ?? []), e]);
    }
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a - b)
    .map(([key, items]) => ({ day: new Date(key), items: items.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs) }));
}

// newEventIds: added since the client's last visit — marked with a red dot and "New".
export default function ClientScheduleView({ events, newEventIds }: { events: ClientScheduleEvent[]; newEventIds?: Set<string> }) {
  // "Now" for this visit (fixed, so renders stay pure).
  const [now] = useState(() => Date.now());
  const todayMs = startOfDay(now).getTime();
  const groups = groupByDay(events);
  const upcoming = groups.filter((g) => g.day.getTime() >= todayMs);
  const done = groups.filter((g) => g.day.getTime() < todayMs).reverse();

  const dayBlock = (g: DayGroup, muted: boolean) => {
    const isToday = g.day.getTime() === todayMs;
    return (
      <div key={g.day.getTime()} className="border-b last:border-b-0" style={{ borderColor: "#E2E8F0", opacity: muted ? 0.6 : 1 }}>
        <p className="px-4 py-2 text-[12px] font-semibold" style={{ color: isToday ? "#2F6BFF" : "#0F172A", backgroundColor: "#F8FAFC" }}>
          {dayHeading(g.day)}
          {isToday ? " · Today" : ""}
        </p>
        {g.items.map((e) => (
          <div key={`${e.id}_${g.day.getTime()}`} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-[92px] shrink-0 text-[12px]" style={{ color: "#64748B" }}>
              {e.allDay || e.endMs - e.startMs >= DAY_MS ? "All day" : `${time(e.startMs)} – ${time(e.endMs)}`}
            </span>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13.5px]" style={{ color: "#0F172A" }}>
                <span className="truncate">{e.title}</span>
                {newEventIds?.has(e.id) ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.5px]" style={{ color: "#DC2626" }}>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#DC2626" }} />
                    New
                  </span>
                ) : null}
              </span>
              {e.categoryName ? (
                <span className="block truncate text-[11.5px]" style={{ color: "#64748B" }}>{e.categoryName}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: "#D8DEE8", backgroundColor: "#FFFFFF" }}>
      {upcoming.length ? (
        upcoming.map((g) => dayBlock(g, false))
      ) : (
        <p className="px-4 py-6 text-center text-[13px]" style={{ color: "#64748B" }}>Nothing else scheduled yet.</p>
      )}
      {done.length ? (
        <>
          <p className="border-y px-4 py-2 text-[11px] font-bold uppercase tracking-[0.6px]" style={{ borderColor: "#E2E8F0", color: "#64748B" }}>Done</p>
          {done.map((g) => dayBlock(g, true))}
        </>
      ) : null}
    </div>
  );
}
