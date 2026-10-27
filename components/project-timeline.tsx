"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { attachBoardDragScroll } from "@/lib/board-drag-scroll";
import { activeDate, activeDateRange } from "@/lib/company-formats";
import { fetchUserScheduleTimelineCollapsed, saveUserScheduleTimelineCollapsed, type CalendarEvent } from "@/lib/calendar-data";
import { glassShineStyle } from "@/lib/glass-shine";

// A project's Calendar events along a line (the top of its Schedule pop-up — components/project-schedule-modal.tsx),
// from its first to its last: each a glass dot in its category's colour at its date — as far apart along it as they are
// in time (stretched to fill the pop-up; a day at least DAY_MIN_PX), only never closer than MIN_GAP_PX, so none are
// crammed in — and a little card of it on a stem: its name and date. Cards go over and under the line in turn (and one
// that would still run into another, a row further out). Longer than the pop-up, the line is slid along: grabbed and
// dragged, gliding on as it's let go, as the Dashboard's board (lib/board-drag-scroll.ts) — a swipe on a phone. Pointing
// at a card (a phone: a tap) opens it out — bigger, with everything: its whole name, when, its time and its category —
// growing toward the line, kept to the part of it on screen; clicking it (a phone: tapping it again) opens it in the
// Calendar. Today: a pill on the line where it falls among them (solid up to it, dashed after); before them all, a
// "← Today" pill at the start, pointing back to it (all of it still to come); after them all, "Today →" at the end. The
// next one coming up says so. It opens at today. They pop up in turn as it opens. Its "Timeline" heading puts it away
// (it slides shut) and brings it back — kept as that person's choice for every project (on their account —
// lib/calendar-data.ts — and on this device, so it opens as they left it straight away).
//
// Anything with a date can go along it (TimelineItem — a Calendar event is one): a contact's projects, quotes and leads
// (components/contact-timeline.tsx) — there with no heading to put it away (`collapsible` off), each card's own line
// under its date instead of its time (`detailOf`), and its own words for what a click does (`openTitle`).

const DAY_MS = 24 * 60 * 60 * 1000;
// A day's length along the line, at least; and how close two dots can be (two of them — the next card on the same side
// — leave a card's width and a gap between cards).
const DAY_MIN_PX = 20;
const MIN_GAP_PX = 76;
// A card, small (its height fixed: its rows are by it) and opened out; a row of them (a card and the gap to the next).
const CARD_PX = 132;
const CARD_PHONE_PX = 112;
const CARD_H = 48;
const OPEN_PX = 236;
const ROW_PX = CARD_H + 8;
// From the line to the first row's cards; room at an end for the Today pill (off the line's end); a little room over
// and under it all.
const STEM_PX = 14;
const TODAY_ROOM_PX = 104;
const PAD_Y = 6;
const ROWS_EACH_SIDE = 2;
// How close (px) two cards can be in a row.
const CARD_GAP_PX = 8;
// Put away or not, on this device (by person) — as the account has it, till that's been heard from.
const COLLAPSED_KEY = "cutsmart.web.schedule.timelineCollapsed.";
const SLIDE = "grid-template-rows 240ms cubic-bezier(0.22, 1, 0.36, 1), margin 240ms cubic-bezier(0.22, 1, 0.36, 1)";
function readCollapsedHere(uid: string): boolean {
  if (!uid || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_KEY + uid) === "1";
  } catch {
    return false;
  }
}
function keepCollapsedHere(uid: string, collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY + uid, collapsed ? "1" : "0");
  } catch {
    // (No room / not allowed: the account still has it.)
  }
}

// The time now — a module function, as the React Compiler lint takes a bare Date.now() in a component for a call during
// render.
function nowMs(): number {
  return Date.now();
}
function timeText(ms: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(ms))
    .toLowerCase()
    .replace(/\s+/g, "");
}
const weekday = (ms: number) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(ms));
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
// What goes along the line: when it starts and ends (an all-day one's end is the start of the day after) — a Calendar
// event is one.
export type TimelineItem = { id: string; title: string; startMs: number; endMs: number; allDay: boolean };
// An all-day event's last day (its end is the start of the day after); a timed one's end.
const lastMsOf = (e: TimelineItem) => (e.allDay ? e.endMs - DAY_MS : e.endMs - 1);
// When it is: its day (or days), and its time — or all day, and for how many.
function whenOf(e: TimelineItem): { date: string; time: string } {
  const lastMs = lastMsOf(e);
  if (sameDay(e.startMs, lastMs)) {
    return { date: `${weekday(e.startMs)} ${activeDate(e.startMs)}`, time: e.allDay ? "All day" : `${timeText(e.startMs)} – ${timeText(e.endMs)}` };
  }
  const range = activeDateRange(new Date(e.startMs), new Date(lastMs));
  if (e.allDay) {
    const days = Math.round((new Date(lastMs).setHours(0, 0, 0, 0) - new Date(e.startMs).setHours(0, 0, 0, 0)) / DAY_MS) + 1;
    return { date: range, time: `All day · ${days} days` };
  }
  return { date: range, time: `${timeText(e.startMs)} – ${timeText(e.endMs)}` };
}

export function ProjectEventsTimeline<T extends TimelineItem = CalendarEvent>({
  events,
  categoryOf,
  onOpenEvent,
  collapsible = true,
  detailOf,
  openTitle = "Open in the Calendar",
  untitled = "Untitled event",
}: {
  // Its events the person can see (the Calendar's rule) — or anything else with dates.
  events: T[];
  categoryOf: (event: T) => { name: string; color: string };
  onOpenEvent: (eventId: string) => void;
  // Its "Timeline" heading, to put it away and bring it back (a project's Schedule) — off: just the line.
  collapsible?: boolean;
  // An opened-out card's line under its date — its time, unless given.
  detailOf?: (event: T) => string;
  // What clicking a card does, as its tooltip says it.
  openTitle?: string;
  // A card with no title.
  untitled?: string;
}) {
  // What it slides in: how wide that is (the line at least as long), and its grab-and-drag.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setBoxWidth(Math.floor(entries[0]?.contentRect.width ?? 0)));
    observer.observe(el);
    const detachDrag = attachBoardDragScroll(el, { dragFrom: "[data-timeline-card]" });
    return () => {
      observer.disconnect();
      detachDrag();
    };
  }, []);
  // Put away (its heading pressed): this person's choice, for every project — as this device last had it, then as their
  // account has it.
  const { user } = useAuth();
  const uid = String(user?.uid || "");
  const [collapsedChoice, setCollapsed] = useState(() => readCollapsedHere(uid));
  // (Not collapsible: always open.)
  const collapsed = collapsible && collapsedChoice;
  useEffect(() => {
    if (!uid || !collapsible) return;
    let cancelled = false;
    void fetchUserScheduleTimelineCollapsed(uid).then((value) => {
      if (cancelled) return;
      keepCollapsedHere(uid, value);
      setCollapsed(value);
    });
    return () => {
      cancelled = true;
    };
  }, [uid, collapsible]);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (!uid) return;
    keepCollapsedHere(uid, next);
    void saveUserScheduleTimelineCollapsed(uid, next);
  };
  // The card opened out (pointed at, or tapped on a phone), and the part of the line on screen as it was opened — it's
  // kept to that.
  const [open, setOpen] = useState<{ id: string; viewLeft: number } | null>(null);
  const openCard = (eventId: string) => setOpen({ id: eventId, viewLeft: scrollRef.current?.scrollLeft ?? 0 });

  const now = nowMs();
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs);
  const nextId = sorted.find((e) => e.endMs > now)?.id ?? "";
  const cardPx = boxWidth < 440 ? CARD_PHONE_PX : CARD_PX;

  // ---- Where each dot is: by its date from the first one's, each at least MIN_GAP_PX on from the one before; stretched
  // to fill the pop-up when that's shorter. Today before them all: room at the start for its pill; after them all, at
  // the end.
  const firstMs = sorted[0]?.startMs ?? now;
  const lastStartMs = sorted[sorted.length - 1]?.startMs ?? now;
  const todayWhere: "before" | "among" | "after" = now < firstMs ? "before" : now > lastStartMs ? "after" : "among";
  const startPad = todayWhere === "before" ? TODAY_ROOM_PX : cardPx / 2 + 6;
  const endPad = todayWhere === "after" ? TODAY_ROOM_PX : cardPx / 2 + 6;
  const spanDays = (lastStartMs - firstMs) / DAY_MS;
  const dotsAt = (dayPx: number) => {
    const xs: number[] = [];
    for (const e of sorted) {
      const byDate = startPad + ((e.startMs - firstMs) / DAY_MS) * dayPx;
      xs.push(xs.length ? Math.max(byDate, xs[xs.length - 1] + MIN_GAP_PX) : byDate);
    }
    return xs;
  };
  let xs = dotsAt(DAY_MIN_PX);
  if ((xs[xs.length - 1] ?? startPad) + endPad < boxWidth && spanDays > 0) {
    xs = dotsAt((boxWidth - startPad - endPad) / spanDays);
  }
  // (Still shorter — one event, or one day's: in the middle.)
  const contentWidth = (xs[xs.length - 1] ?? startPad) + endPad;
  const shift = contentWidth < boxWidth ? (boxWidth - contentWidth) / 2 : 0;
  xs = xs.map((x) => x + shift);
  const width = Math.max(boxWidth, contentWidth);
  const lineFrom = shift + (todayWhere === "before" ? 8 : startPad);
  const lineTo = shift + contentWidth - (todayWhere === "after" ? 8 : endPad);
  // Today among them: between the two it falls between, as far along as it is.
  const todayX = (() => {
    if (todayWhere === "before") return lineFrom;
    if (todayWhere === "after") return lineTo;
    const after = sorted.findIndex((e) => e.startMs > now);
    if (after <= 0) return xs[xs.length - 1];
    const a = sorted[after - 1].startMs;
    const b = sorted[after].startMs;
    return xs[after - 1] + ((now - a) / Math.max(1, b - a)) * (xs[after] - xs[after - 1]);
  })();

  // ---- Each card's row: over and under the line in turn (and further out where it would still run into one before it).
  const clampLeft = (x: number, w: number, min: number, max: number) => Math.min(Math.max(min, x - w / 2), Math.max(min, max - w));
  const rowEnds = new Map<string, number>();
  let lastSide: "over" | "under" = "under";
  const placed: Array<{ event: T; x: number; left: number; side: "over" | "under"; row: number }> = [];
  sorted.forEach((event, index) => {
    const x = xs[index];
    const left = clampLeft(x, cardPx, 0, width);
    const firstSide = lastSide === "over" ? "under" : "over";
    const otherSide = firstSide === "over" ? "under" : "over";
    const tries: Array<{ side: "over" | "under"; row: number }> = [];
    for (let row = 0; row < ROWS_EACH_SIDE; row += 1) tries.push({ side: firstSide, row }, { side: otherSide, row });
    const free = tries.find((spot) => (rowEnds.get(`${spot.side}${spot.row}`) ?? Number.NEGATIVE_INFINITY) + CARD_GAP_PX <= left);
    // (None free: whichever runs into the one before it least.)
    const spot =
      free ??
      tries.reduce((best, spot) => ((rowEnds.get(`${spot.side}${spot.row}`) ?? 0) < (rowEnds.get(`${best.side}${best.row}`) ?? 0) ? spot : best));
    rowEnds.set(`${spot.side}${spot.row}`, left + cardPx);
    lastSide = spot.side;
    placed.push({ event, x, left, ...spot });
  });
  const rowsOver = Math.max(1, ...placed.filter((p) => p.side === "over").map((p) => p.row + 1));
  const rowsUnder = Math.max(1, ...placed.filter((p) => p.side === "under").map((p) => p.row + 1));
  const lineY = PAD_Y + rowsOver * ROW_PX + STEM_PX;
  const height = lineY + STEM_PX + rowsUnder * ROW_PX + PAD_Y;
  const lineColour = "color-mix(in srgb, var(--text-main) 22%, transparent)";

  // Opening: today in the middle of it (as near as its ends allow) — before them all, at the start; after, at the end.
  const placementKey = `${sorted.map((e) => e.id).join(",")}:${width}`;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    // (The line starts after its box's own padding.)
    if (el) el.scrollLeft = Math.max(0, todayX + Number.parseFloat(getComputedStyle(el).paddingLeft || "0") - el.clientWidth / 2);
    // (Only as it opens, or its events or size change — not as it's slid along.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementKey]);

  // A phone (nothing to point with): a tap opens a card out first, and the next opens it in the Calendar.
  const onCardClick = (eventId: string) => {
    const touch = typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
    if (touch && open?.id !== eventId) {
      openCard(eventId);
      return;
    }
    onOpenEvent(eventId);
  };

  return (
    <section className="mb-4">
      {collapsible ? (
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        title={collapsed ? "Show the timeline" : "Put the timeline away"}
        className="mb-1 inline-flex items-center gap-1.5 rounded-[6px] text-[11px] font-bold uppercase tracking-[0.8px] transition hover:opacity-75"
        style={{ color: "var(--text-main)" }}
      >
        Timeline
        <ChevronDown size={13} strokeWidth={2.6} style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 200ms ease" }} />
      </button>
      ) : null}
      {/* Sliding shut and open. Out to the pop-up's edges, with room over and under it for the cards' shadows (taken back
          by its margins while it's open) — its edge cuts off what's outside it. */}
      <div
        className="-mx-5 grid"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr", marginTop: collapsed ? 0 : -16, marginBottom: collapsed ? 0 : -40, transition: SLIDE }}
        inert={collapsed}
      >
        <div className="min-h-0 overflow-hidden">
          {/* What it slides in (to the pop-up's edges — its own inside them). Slid, an opened card puts itself away. */}
          <div
            ref={scrollRef}
            className="hide-native-scrollbar overflow-x-auto overflow-y-hidden px-5 pb-10 pt-4"
            onScroll={() => setOpen(null)}
            onMouseLeave={() => setOpen(null)}
          >
            <div className="relative" style={{ width, height }}>
              {boxWidth > 0 ? (
                <>
                  {/* The line: solid up to today, dashed after. */}
                  {todayX > lineFrom ? (
                    <div
                      className="absolute h-[3px] rounded-full"
                      style={{ left: lineFrom, width: Math.min(todayX, lineTo) - lineFrom, top: lineY - 1.5, backgroundColor: lineColour }}
                    />
                  ) : null}
                  {todayX < lineTo ? (
                    <div
                      className="absolute h-0 border-t-[3px] border-dashed"
                      style={{ left: Math.max(todayX, lineFrom), width: lineTo - Math.max(todayX, lineFrom), top: lineY - 1.5, borderColor: lineColour }}
                    />
                  ) : null}

                  {/* Today: a pill on the line where it falls among them — off its start, pointing back to it ("← Today":
                      they're still to come), or off its end, pointing on to it ("Today →": they're all over). */}
                  <span
                    className="glass-shine absolute z-[1] inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold text-white"
                    style={{
                      ...glassShineStyle("var(--brand)"),
                      left: todayX,
                      top: lineY,
                      // (Its own `translate` — its pop-in animates `transform`.)
                      translate: `${todayWhere === "before" ? "0" : todayWhere === "after" ? "-100%" : "-50%"} -50%`,
                      animation: "glass-bubble-pop-in 380ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
                    }}
                  >
                    {todayWhere === "before" ? <ArrowLeft size={12} strokeWidth={2.6} /> : null}
                    Today
                    {todayWhere === "after" ? <ArrowRight size={12} strokeWidth={2.6} /> : null}
                  </span>

                  {placed.map(({ event: e, x, left, side, row }, index) => {
                    const category = categoryOf(e);
                    const when = whenOf(e);
                    const detail = detailOf ? detailOf(e) : when.time;
                    const past = e.endMs <= now;
                    const isNext = e.id === nextId;
                    const isOpen = open?.id === e.id;
                    const over = side === "over";
                    // Opened out: wider, kept to the part of the line on screen as it opened.
                    const cardW = isOpen ? Math.min(OPEN_PX, boxWidth) : cardPx;
                    const cardLeft = isOpen && open ? clampLeft(x, cardW, open.viewLeft, open.viewLeft + boxWidth) : left;
                    // How far from the line its card starts (its row's) — its stem that long; it grows toward the line.
                    const reach = STEM_PX + row * ROW_PX;
                    const delay = 120 + index * 55;
                    return (
                      <div key={e.id}>
                        <span
                          className="absolute w-[2px]"
                          style={{
                            left: x - 1,
                            top: over ? lineY - reach : lineY,
                            height: reach,
                            backgroundColor: `color-mix(in srgb, ${category.color} 50%, transparent)`,
                          }}
                        />
                        {/* Its dot, at its date, in its colour: coming up, filled with the glass shine; over, a ring of it. */}
                        <span
                          className={`absolute z-[1] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${past ? "" : "glass-shine"}`}
                          style={{
                            ...(past
                              ? { borderColor: category.color, backgroundColor: "var(--panel-bg)" }
                              : glassShineStyle(category.color, {
                                  borderColor: "rgba(255,255,255,0.9)",
                                  boxShadow: `0 0 0 3px color-mix(in srgb, ${category.color} 28%, transparent)`,
                                })),
                            left: x,
                            top: lineY,
                            animation: `glass-bubble-pop-in 380ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}ms both`,
                          }}
                        />
                        {/* Its card: small, its name and date; opened out, everything. */}
                        <button
                          type="button"
                          data-timeline-card="true"
                          onClick={() => onCardClick(e.id)}
                          // (Not while the line's being dragged along under the pointer.)
                          onMouseEnter={(ev) => {
                            if (!(ev.buttons & 1)) openCard(e.id);
                          }}
                          onFocus={() => openCard(e.id)}
                          onBlur={() => setOpen((prev) => (prev?.id === e.id ? null : prev))}
                          title={openTitle}
                          aria-label={`${e.title || untitled} — ${when.date}${detail ? `, ${detail}` : ""} — ${category.name}`}
                          className={`absolute flex flex-col overflow-hidden rounded-[12px] border text-left ${isOpen ? "z-[5]" : "z-[2]"}`}
                          style={{
                            left: cardLeft,
                            width: cardW,
                            ...(over ? { top: lineY - reach - CARD_H } : { bottom: height - (lineY + reach + CARD_H) }),
                            height: isOpen ? undefined : CARD_H,
                            borderColor: isNext || isOpen ? category.color : "var(--glass-border)",
                            backgroundColor: `color-mix(in srgb, ${category.color} ${past && !isOpen ? 5 : 9}%, var(--panel-bg))`,
                            boxShadow: isOpen
                              ? `0 10px 26px color-mix(in srgb, ${category.color} 26%, transparent), var(--shadow-md)`
                              : isNext
                                ? `0 4px 12px color-mix(in srgb, ${category.color} 20%, transparent)`
                                : "var(--shadow-glass)",
                            transition: "left 180ms ease, width 180ms ease, box-shadow 180ms ease",
                            animation: `glass-bubble-pop-in 420ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delay + 60}ms both`,
                            transformOrigin: over ? "50% 100%" : "50% 0%",
                          }}
                        >
                          <span className="h-[3px] w-full shrink-0" style={{ backgroundColor: category.color }} />
                          <span className="min-w-0 px-2.5 pb-1.5 pt-1">
                            <span className="flex items-start justify-between gap-1.5">
                              <span
                                className={`min-w-0 text-[12px] font-semibold leading-snug ${isOpen ? "line-clamp-3" : "truncate"}`}
                                style={{ color: "var(--text-main)" }}
                              >
                                {e.title || untitled}
                              </span>
                              {isNext && isOpen ? (
                                <span
                                  className="glass-shine mt-[1px] shrink-0 rounded-full border px-1.5 text-[10px] font-semibold leading-[16px] text-white"
                                  style={glassShineStyle(category.color)}
                                >
                                  Next
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-[11.5px] font-medium" style={{ color: "var(--text-main)" }}>
                              {when.date}
                            </span>
                            {/* Opened out: its time, and its category. */}
                            {isOpen ? (
                              <span className="glass-panel-pop block" style={{ transformOrigin: "0% 0%" }}>
                                {detail ? (
                                  <span className="mt-0.5 block truncate text-[11.5px] font-medium" style={{ color: "var(--text-main)" }}>
                                    {detail}
                                  </span>
                                ) : null}
                                <span
                                  className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-[1px] text-[11px] font-medium"
                                  style={{ backgroundColor: `color-mix(in srgb, ${category.color} 18%, transparent)`, color: "var(--text-main)" }}
                                >
                                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                                  <span className="truncate">{category.name}</span>
                                </span>
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
