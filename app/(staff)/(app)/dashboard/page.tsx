"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Activity, CalendarDays, CheckCircle2, ChevronsLeftRight, ChevronsRightLeft, FolderKanban, Kanban, Rows3, Search, Users2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { GlassScrollbarThumb } from "@/components/glass-scrollbar-thumb";
import { useDragGhost, DragGhostLayer } from "@/lib/use-drag-ghost";
import { useAppTabs } from "@/lib/app-tabs-context";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import {
  fetchCompanyDoc,
  fetchCompanyMembers,
  fetchProjects,
  fetchUserColorMapByUids,
  updateProjectPatch,
  updateProjectStatus,
} from "@/lib/firestore-data";
import type { CompanyMemberOption } from "@/lib/firestore-data";
import { projectTabAccess } from "@/lib/permissions";
import { readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import type { Project } from "@/lib/types";
import { USER_COLOR_UPDATED_EVENT, type UserColorUpdatedDetail } from "@/lib/user-color-sync";
import { retryAsync } from "@/lib/load-retry";
import { captureGlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
type StatusRow = { name: string; color: string };
type RoleRow = { id: string; name: string; color: string };

const statCards = [
  { label: "Projects", key: "total", icon: FolderKanban, iconFrom: "#6EB4FF", iconTo: "#3577E0" },
  { label: "Active", key: "active", icon: Activity, iconFrom: "#F3CD6C", iconTo: "#DC9A1F" },
  { label: "Completed", key: "completed", icon: CheckCircle2, iconFrom: "#6BC79A", iconTo: "#2E8C5C" },
  { label: "Staff Members", key: "staff", icon: Users2, iconFrom: "#A796F0", iconTo: "#6E56D9" },
] as const;
type QuickFilter = "all" | "active" | "completed";
type DashboardLegendRow = { id: string; name: string; color: string };

function normalizeRoleKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function isCompletedStatus(status: string) {
  const token = String(status || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return token === "done" || token.startsWith("complete");
}

function lightenHexColor(hex: string, amount: number): string {
  const value = String(hex || "").trim();
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#64748B";
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const ratio = Math.max(0, Math.min(1, amount));
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  const nr = clamp(r + (255 - r) * ratio);
  const ng = clamp(g + (255 - g) * ratio);
  const nb = clamp(b + (255 - b) * ratio);
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

function darkenHexColor(hex: string, amount: number): string {
  const value = String(hex || "").trim();
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#64748B";
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const ratio = Math.max(0, Math.min(1, amount));
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  const nr = clamp(r * (1 - ratio));
  const ng = clamp(g * (1 - ratio));
  const nb = clamp(b * (1 - ratio));
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const value = String(hex || "").trim();
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#64748B";
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

const DASHBOARD_BOARD_PREFS_STORAGE_PREFIX = "cutsmart_dashboard_board_prefs:";
function dashboardBoardPrefsStorageKey(uid: string) {
  return `${DASHBOARD_BOARD_PREFS_STORAGE_PREFIX}${String(uid || "").trim()}`;
}

function statusPillColors(status: string) {
  const key = String(status || "").trim().toLowerCase();
  const defaults: Record<string, string> = {
    new: "#3060D0",
    running: "#2A7A3B",
    "in production": "#2A7A3B",
    drafting: "#6B4FB3",
    quoting: "#C77700",
    "ready for cnc": "#3060D0",
    completed: "#2A7A3B",
    paused: "#A05A00",
  };

  const bg = defaults[key] ?? "#64748B";
  return { backgroundColor: bg, color: "#FFFFFF" };
}

function normalizeStatuses(raw: unknown): StatusRow[] {
  if (!Array.isArray(raw)) {
    return [
      { name: "New", color: "#3060D0" },
      { name: "In Production", color: "#2A7A3B" },
      { name: "On Hold", color: "#C77700" },
      { name: "Complete", color: "#2A7A3B" },
    ];
  }
  const rows = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        name: String(row.name ?? "").trim(),
        color: String(row.color ?? "").trim() || "#64748B",
      };
    })
    .filter((row) => row.name);
  return rows.length
    ? rows
    : [
        { name: "New", color: "#3060D0" },
        { name: "In Production", color: "#2A7A3B" },
        { name: "On Hold", color: "#C77700" },
        { name: "Complete", color: "#2A7A3B" },
      ];
}

function normalizeDashboardLegend(raw: unknown): DashboardLegendRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      return {
        id: String(row.id ?? `legend_${idx + 1}`).trim(),
        name: String(row.name ?? "").trim(),
        color: String(row.color ?? "").trim() || "#2A7A3B",
      };
    })
    .filter((row) => row.name);
}

function completedProjectIso(project: Project): string {
  const raw = project as unknown as Record<string, unknown>;
  const completedAtIso = String(raw.completedAtIso ?? "").trim();
  if (completedAtIso) return completedAtIso;
  const completedAtRaw = raw.completedAt;
  if (completedAtRaw instanceof Date && !Number.isNaN(completedAtRaw.getTime())) {
    return completedAtRaw.toISOString();
  }
  if (
    completedAtRaw &&
    typeof completedAtRaw === "object" &&
    typeof (completedAtRaw as { toDate?: () => Date }).toDate === "function"
  ) {
    const asDate = (completedAtRaw as { toDate: () => Date }).toDate();
    if (asDate instanceof Date && !Number.isNaN(asDate.getTime())) {
      return asDate.toISOString();
    }
  }
  return String(project.createdAt ?? "").trim();
}

function monthKeyForOffset(monthsAgo: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}`;
}

function monthKeyFromIso(iso: string): string {
  const d = new Date(String(iso || ""));
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function monthLabelFromKey(monthKey: string): string {
  const [yearRaw, monthRaw] = String(monthKey || "").split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return "Unknown Month";
  return new Intl.DateTimeFormat("en-NZ", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function monthSortValue(monthKey: string): number {
  const [yearRaw, monthRaw] = String(monthKey || "").split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return -1;
  return year * 100 + month;
}

function rowTextColorForFill(fill: string): string {
  const clean = String(fill || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "#111827";
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0F172A" : "#FFFFFF";
}

function normalizeRoleRows(raw: unknown): RoleRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      const id = normalizeRoleKey(row.id ?? row.name ?? `role_${idx + 1}`);
      return {
        id,
        name: String(row.name ?? row.id ?? "").trim() || id,
        color: String(row.color ?? "").trim() || "#7D99B3",
      };
    })
    .filter((row) => row.id);
}

function roleLabelFromKey(roleKey: string): string {
  const clean = normalizeRoleKey(roleKey);
  if (!clean) return "Staff";
  return clean
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function dashboardDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  const date = new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-NZ", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .toLowerCase()
    .replace(" ", "");
  return `${date} | ${time}`;
}

function dashboardDateOnly(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

function isoToDateInputValue(value: string) {
  const d = new Date(String(value || ""));
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputValueToCompletedIso(value: string) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  const next = new Date(`${clean}T12:00:00`);
  if (Number.isNaN(next.getTime())) return "";
  return next.toISOString();
}

function initials(text: string) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "CU";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function assignedDisplayName(project: Project) {
  const value = String(project.assignedToName || project.assignedTo || "").trim();
  return value.toLowerCase() === "unassigned" ? "" : value;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { tabs: globalAppTabs, registerScopeTabs } = useAppTabs();
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [pageSize, setPageSize] = useState(20);
  const [visibleCount, setVisibleCount] = useState(20);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMenuProjectId, setStatusMenuProjectId] = useState("");
  const [statusMenuPos, setStatusMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [statusUpdatingProjectId, setStatusUpdatingProjectId] = useState("");
  // Board view — a drag-to-change-status kanban alternative to the default list, mirroring the
  // one on the Leads page (same shared drag-ghost helper, same interaction language). View mode
  // and per-column collapse state are remembered per-user (localStorage keyed by uid), so two
  // people sharing a browser profile each keep their own preference.
  const [dashboardViewMode, setDashboardViewMode] = useState<"list" | "board">("list");
  const [draggingProjectId, setDraggingProjectId] = useState("");
  const [dragOverProjectStatusColumn, setDragOverProjectStatusColumn] = useState("");
  const [collapsedProjectStatusColumns, setCollapsedProjectStatusColumns] = useState<Record<string, boolean>>({});
  const [boardPrefsHydrated, setBoardPrefsHydrated] = useState(false);
  // The stat cards above the board scroll away with the page like any normal content; the board
  // panel itself (search/filter row + columns) is `position: sticky`, so it scrolls up with the
  // page too until its own top edge reaches just below the fixed nav bar(s), then locks there —
  // from that point on, only the columns' own internal scroll moves, not the page. Its actual
  // `height` is a fixed CSS value (see the className below) at all times — mutating an element's
  // real height on every scroll tick changes the page's total scrollable height, which can fight
  // with the browser's own scroll-position clamping and break scrolling entirely, so it must stay
  // constant. The "reveal more as you scroll" effect below is done with `clip-path` instead, which
  // is purely a paint-time mask — it never touches layout or scrollHeight.
  //
  // The panel div is behind `canAccessDashboard`/loading gates further down, so it can mount
  // *after* dashboardViewMode has already settled to "board" (e.g. the localStorage-hydrated view
  // preference resolves before permissions do) — a plain `useEffect(() => ..., [dashboardViewMode])`
  // would then hold a stale null ref forever, since dashboardViewMode never changes again to
  // trigger a re-run. A callback ref sidesteps that: setup runs exactly when the node itself
  // mounts/unmounts, independent of render timing, and `dashboardViewModeRef` (kept fresh every
  // render, no effect needed) lets the scroll handler always see the current mode.
  const dashboardViewModeRef = useRef(dashboardViewMode);
  dashboardViewModeRef.current = dashboardViewMode;
  const boardCheckRef = useRef<(() => void) | null>(null);
  const boardStickyCleanupRef = useRef<(() => void) | null>(null);
  const boardStickyRef = useCallback((el: HTMLDivElement | null) => {
    boardStickyCleanupRef.current?.();
    boardStickyCleanupRef.current = null;
    boardCheckRef.current = null;
    if (!el) return;
    let raf = 0;
    const mainEl = document.querySelector("main");
    // The page-scroll-blocked backstop below (see setPageScrollBlocked) only has an un-stick path
    // via the `wheel` event, which never fires for a touch-driven scroll — a coarse-pointer device
    // that engages the block while mid-scroll inside a column would then have no way to ever
    // un-block the page again (exactly "the page won't scroll back up"). Touch doesn't need the
    // backstop anyway: `.glass-scroll` has no overscroll-behavior set, so native touch scroll-
    // chaining already hands the gesture back to the page on its own once a column's card list
    // hits its own scroll boundary, the same way any ordinary nested scrollable does. Computed
    // once — pointer capability doesn't change over the component's lifetime.
    const isCoarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    // Each column's card list toggles overflow-y directly on the DOM (not via React state) for
    // the same reason clip-path is written directly below: going through setState here would add
    // a render cycle between "scroll crossed the lock threshold" and "the column can actually be
    // scrolled", long enough to eat the rest of a trackpad gesture and leave the user stuck until
    // they start a new one. A plain style write lands on the very next paint, same as clip-path.
    const setCardListsScrollable = (scrollable: boolean) => {
      el.querySelectorAll<HTMLElement>(".glass-scroll.flex-1").forEach((list) => {
        list.style.overflowY = scrollable ? "auto" : "hidden";
      });
    };
    // Each column is two nested elements: an outer shell (marked `data-board-column`) that owns
    // the box-shadow and layout sizing, and an inner element that owns the background/border/blur
    // and `rounded-[16px] overflow-hidden`. The reveal below sets the OUTER's real `height`
    // directly rather than clip-path-ing anything — that's what keeps the shadow (which always
    // renders around whatever size the outer currently is) and the rounded bottom (the inner's
    // own border-radius, which rounds correctly at any height) continuously in sync with how much
    // of the column is actually revealed, instead of a clip-path boundary that doesn't line up
    // with either. This is safe to do with a real `height` (unlike the row/panel itself) because
    // a column's own height doesn't feed into the row's — the row's is fixed independently via
    // flex, so shrinking a column here never changes the page's total scrollable height.
    const getColumns = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>("[data-board-column]"));
    // Backs the wheel handler below — the EARLY_SCROLLABLE_PX buffer on setCardListsScrollable
    // helps, but a discrete wheel tick still resolves its scroll target once, based on what the
    // BROWSER already considers scrollable at that instant; it can't retroactively redirect a
    // tick that already committed to scrolling the page. `isLocked` (the precise, unbuffered
    // state — matching exactly when position:sticky has actually engaged) lets the wheel handler
    // redirect scroll to a column manually, on every tick, without waiting on the browser to
    // notice anything.
    let isLocked = false;
    // Tracks which element actually scrolls the page (mirrors the same check inside `check()`)
    // so the wheel handler below can manually drive it — see the un-stick comment there.
    let mainScrolls = false;
    // Declared up here (rather than down by onWheel, where it's set) so `check()` can also read
    // it for the page-scroll lock below — see `setPageScrollBlocked`.
    let unsticking = false;
    // Belt-and-suspenders backstop on top of the wheel redirect below: rather than rely solely on
    // preventDefault() suppressing the browser's native scroll on every single wheel tick, this
    // makes it structurally impossible for the page to scroll at all while locked — there's no
    // event-level mechanism (native default action, scroll latching, or anything else) that can
    // scroll a container that has nothing scrollable. Only lifted the instant we deliberately want
    // the page to move (mid un-stick), and re-applied as soon as we're back to "should stay put."
    let pageScrollBlocked = false;
    const setPageScrollBlocked = (blocked: boolean) => {
      if (pageScrollBlocked === blocked) return;
      pageScrollBlocked = blocked;
      const target = mainScrolls ? mainEl : document.documentElement;
      if (target) target.style.overflowY = blocked ? "hidden" : "";
    };
    // Backs the natural-height cache inside `check()` — see the comment down there for why this
    // isn't just remeasured every scroll frame.
    let cachedFullHeight = 0;
    let cachedFullHeightKey = "";
    const check = () => {
      raf = 0;
      // Each column's card list has a fixed, viewport-relative height from the moment it
      // renders — position:sticky only changes whether the panel tracks scroll or holds still,
      // not its size — so if the card list were always overflow-y-auto, a swipe over an
      // unlocked (not-yet-stuck) column would scroll the cards instead of the page. Keep it
      // non-scrollable until the sticky panel has actually reached its stuck offset, so the
      // gesture bubbles up to the page/main scroll and finishes bringing the board to the top.
      if (dashboardViewModeRef.current !== "board") {
        isLocked = false;
        setCardListsScrollable(false);
        setPageScrollBlocked(false);
        getColumns().forEach((col) => { col.style.height = ""; });
        cachedFullHeightKey = "";
        return;
      }
      const stuckTop = Number.parseFloat(getComputedStyle(el).top) || 0;
      // getBoundingClientRect() is always viewport-relative, but the sticky `top` offset is
      // relative to whichever element is actually scrolling — on mobile that's `<main>` itself
      // (already offset ~48px below the fixed tab bar), on desktop it's the document (offset 0).
      // Comparing rect.top straight to the CSS top value only works for the latter, so add back
      // the scrollport's own offset when main is the one doing the scrolling.
      mainScrolls = Boolean(mainEl) && getComputedStyle(mainEl as HTMLElement).overflowY !== "visible";
      const containerTop = mainScrolls ? (mainEl as HTMLElement).getBoundingClientRect().top : 0;
      const rect = el.getBoundingClientRect();
      // A discrete wheel/trackpad tick resolves its scroll target ONCE, based on what's
      // scrollable at that instant — so if a card list only becomes overflow-y-auto exactly AT
      // the pixel the panel finishes locking, the tick that lands the panel there still scrolls
      // the page (the card list wasn't scrollable yet when the browser picked a target), and the
      // user needs one more, separate tick before the column responds. Unlocking a few pixels
      // EARLY (while the panel's own scroll-into-place is still finishing) means the card list is
      // already scrollable by the time that happens, so the same continuous gesture carries
      // straight through. EARLY_SCROLLABLE_PX is small on purpose: position:sticky itself still
      // won't let the panel move past its stuck offset regardless, so this can't reintroduce the
      // original bug (cards swallowing a swipe well before the panel has scrolled into place) —
      // it only shaves the last few pixels of an already-almost-finished scroll.
      const EARLY_SCROLLABLE_PX = 24;
      isLocked = rect.top <= containerTop + stuckTop + 1;
      const nearlyLocked = rect.top <= containerTop + stuckTop + EARLY_SCROLLABLE_PX;
      setCardListsScrollable(nearlyLocked);
      // Blocked on the same EARLY_SCROLLABLE_PX lead as the card lists go scrollable, not just
      // once `isLocked` — so the page is already unable to scroll by the exact tick that finishes
      // locking, and that tick's wheel event has nothing left to resolve to except the column.
      setPageScrollBlocked(!isCoarsePointer && nearlyLocked && !unsticking);
      const columns = getColumns();
      const firstCol = columns[0];
      if (!firstCol) return;
      // The column's natural (fully-grown) height doesn't change from one scroll frame to the
      // next — only how much of it is currently revealed does — so it's cached here instead of
      // being remeasured on every single scroll-driven call. Remeasuring meant resetting height
      // to "" and immediately reading getBoundingClientRect(), a write-then-read that forces a
      // synchronous layout reflow; doing that (plus repainting every column's backdrop-filter
      // blur) on every scroll frame for the whole lock-in transition is what showed up as
      // stutter, especially visible right at the moving bottom edge, worse on mobile GPUs. The
      // cache key covers the two things that actually DO change it: the column count (data
      // load/filter swapping which columns exist) and the viewport size (resize/orientation).
      const fullHeightCacheKey = `${columns.length}:${window.innerWidth}x${window.innerHeight}`;
      if (fullHeightCacheKey !== cachedFullHeightKey) {
        const prevHeight = firstCol.style.height;
        firstCol.style.height = "";
        cachedFullHeight = firstCol.getBoundingClientRect().height;
        firstCol.style.height = prevHeight;
        cachedFullHeightKey = fullHeightCacheKey;
      }
      const colRect = firstCol.getBoundingClientRect();
      // BOTTOM_PAD gives the revealed edge breathing room from the viewport bottom — matching the
      // wrapper's own pt-[10px] above the columns, the row's px-[10px]/pb-[10px], and the
      // gap-[10px] between columns, so every side of a column has the same padding — instead of
      // running flush to the screen edge. It stays in the formula even once locked — rect.top
      // then holds steady at the sticky offset, so this settles just short of the column's true
      // height rather than snapping straight to it, avoiding a jump at the handoff. Measured off
      // each column's own rect (not the wrapper's) so this stays correct regardless of any
      // padding between the wrapper and the columns — they're all the same size and position, so
      // the first one stands in for all of them.
      const BOTTOM_PAD = 10;
      const grownHeight = Math.min(cachedFullHeight, Math.max(0, window.innerHeight - BOTTOM_PAD - colRect.top));
      const nextHeight = grownHeight < cachedFullHeight - 0.5 ? `${grownHeight}px` : "";
      columns.forEach((col) => {
        if (col.style.height !== nextHeight) col.style.height = nextHeight;
      });
    };
    boardCheckRef.current = check;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(check);
    };
    // For ordinary scrolling within a column, this does NOT intercept the wheel event at all —
    // `setPageScrollBlocked` above already makes the page unable to scroll while locked, so a
    // wheel/mouse notch's own native default action has nothing left to resolve to except the
    // column underneath (the only remaining scrollable thing), and scrolls it with the browser's
    // own native, smooth, momentum-preserving animation — the same feel as scrolling the page
    // itself, which a hand-rolled JS scrollTop animation can only ever approximate. This only
    // steps in for the one case native scrolling can't handle on its own: un-sticking the panel
    // once a column has been scrolled all the way back to its own top.
    //
    // Once that scroll-up gesture starts un-sticking the panel (see below), `isLocked` flips false
    // mid-gesture as soon as the panel moves off its stuck offset — but the browser still won't
    // resume its own default scrolling for the REST of that gesture (it was prevented earlier in
    // this same gesture, to redirect it into the column). Without this flag, the moment isLocked
    // flips, onWheel's top guard would bail out and hand back to that browser default action,
    // which visibly reads as the scroll suddenly stopping ("gets stuck") partway through un-
    // sticking. Keeping this true — independent of isLocked — for the rest of the up-scroll keeps
    // driving the page manually all the way through, instead of only for the first tick or two.
    // (Declared up near `isLocked`/`mainScrolls` above, not here, so `check()` can read it too.)
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      if (unsticking) {
        if (e.deltaY > 0) {
          unsticking = false;
        } else {
          setPageScrollBlocked(false);
          const scroller = mainScrolls ? mainEl : null;
          if (scroller) scroller.scrollTop += e.deltaY;
          else window.scrollBy(0, e.deltaY);
          e.preventDefault();
          return;
        }
      }
      if (!isLocked || e.deltaY >= 0) return;
      const cardList = (e.target as HTMLElement | null)?.closest<HTMLElement>(".glass-scroll.flex-1");
      if (!cardList || cardList.scrollTop > 0) return;
      // Scroll the page/main back up manually too, rather than just releasing the event and
      // hoping the browser's default action takes over — this same continuous gesture has
      // already had preventDefault() called on it repeatedly (to redirect it into the column),
      // and the browser doesn't reliably hand default scrolling back to the page for the REST
      // of that gesture once reversed. Driving it ourselves, the same way we drive the column,
      // is what actually un-sticks the panel within the same swipe instead of needing a new one.
      unsticking = true;
      setPageScrollBlocked(false);
      const scroller = mainScrolls ? mainEl : null;
      if (scroller) scroller.scrollTop += e.deltaY;
      else window.scrollBy(0, e.deltaY);
      e.preventDefault();
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    mainEl?.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    // Projects load asynchronously, so the very first `check()` call above can land before any
    // column has actually rendered (still showing "Loading projects…") — `getColumns()` finds
    // nothing yet, so nothing gets sized, and nothing else was going to call `check()` again once
    // the columns actually mounted (the view-mode re-check effect below only reruns on
    // dashboardViewMode, which by then has already settled). Watching `el` for child changes
    // catches that moment generically — real data finishing load, a filter/search change
    // swapping which columns exist, anything — without needing to name every state that could
    // cause it. Calls `check()` directly rather than going through the rAF-throttled `onScroll`:
    // that throttle exists to coalesce rapid-fire scroll events, but mutations here are
    // infrequent, and a backgrounded tab can leave a pending rAF callback waiting on the browser
    // (which pauses rAF, not MutationObserver, for hidden tabs) — no reason to route through it.
    const observer = new MutationObserver(() => check());
    observer.observe(el, { childList: true, subtree: true });
    boardStickyCleanupRef.current = () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      mainEl?.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      observer.disconnect();
      getColumns().forEach((col) => { col.style.height = ""; });
      setCardListsScrollable(false);
      setPageScrollBlocked(false);
    };
  }, []);
  // Re-run the check immediately on a view-mode toggle (rather than waiting for the next scroll
  // or resize) so switching into/out of board view updates the lock/height state right away.
  // useLayoutEffect, not useEffect: dashboardViewMode starts as "list" and only flips to "board"
  // once the localStorage-saved preference hydrates a tick after mount, which repaints the panel
  // with the sticky/flex-col classes (full, unclipped height) before this can apply the clip. A
  // plain useEffect runs after that paint, so returning users would see one frame of the panel's
  // flat, un-rounded true bottom before the mask snapped in; useLayoutEffect applies it first.
  useLayoutEffect(() => {
    boardCheckRef.current?.();
  }, [dashboardViewMode]);
  const projectBoardDragGhost = useDragGhost();
  const [statusRows, setStatusRows] = useState<StatusRow[]>(normalizeStatuses(undefined));
  // `statusRows` starts out as a generic placeholder (see normalizeStatuses(undefined) above) —
  // the company's real, configured statuses/colors only land once the company doc fetch below
  // resolves. The board view's own loading gate (`showProjectsLoadingState`) goes false as soon
  // as PROJECTS have loaded, which happens earlier and independently — so without this, the
  // board would render a beat of columns in the placeholder names/colors before snapping to the
  // real ones the instant the company doc arrives, visible as a flash on every load.
  const [statusRowsLoaded, setStatusRowsLoaded] = useState(false);
  const [dashboardLegendRows, setDashboardLegendRows] = useState<DashboardLegendRow[]>([]);
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberOption[]>([]);
  const [roleRows, setRoleRows] = useState<RoleRow[]>([]);
  const [creatorColorByUid, setCreatorColorByUid] = useState<Record<string, string>>({});
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [hoveredProjectId, setHoveredProjectId] = useState("");
  const [openingProjectAnim, setOpeningProjectAnim] = useState<{
    id: string;
    from: { left: number; top: number; width: number; height: number };
    to: { left: number; top: number; width: number; height: number };
    phase: "start" | "animating";
  } | null>(null);
  const openingProjectTimerRef = useRef<number | null>(null);
  const [showCompletedProjectsModal, setShowCompletedProjectsModal] = useState(false);
  const [completedProjectsModalExpanded, setCompletedProjectsModalExpanded] = useState(false);
  const [completedMonthFrom, setCompletedMonthFrom] = useState("");
  const [completedMonthTo, setCompletedMonthTo] = useState("");
  const [completedCardRect, setCompletedCardRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [completedDateUpdatingProjectId, setCompletedDateUpdatingProjectId] = useState("");
  const [completedLegendUpdatingProjectId, setCompletedLegendUpdatingProjectId] = useState("");
  const [activeCompletedLegendId, setActiveCompletedLegendId] = useState("");
  const completedCardRef = useRef<HTMLDivElement | null>(null);
  const completedModalTimerRef = useRef<number | null>(null);
  const completedDateInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const completedProjectsScrollRef = useRef<HTMLDivElement | null>(null);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [staffModalExpanded, setStaffModalExpanded] = useState(false);
  const [staffCardRect, setStaffCardRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const staffCardRef = useRef<HTMLDivElement | null>(null);
  const staffModalTimerRef = useRef<number | null>(null);
  const staffMembersScrollRef = useRef<HTMLDivElement | null>(null);
  const [effectiveCompanyRole, setEffectiveCompanyRole] = useState("");
  const [effectiveCompanyPermissions, setEffectiveCompanyPermissions] = useState<string[]>([]);
  const [companyAccessResolved, setCompanyAccessResolved] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !user?.uid) return;
    try {
      const raw = window.localStorage.getItem(dashboardBoardPrefsStorageKey(user.uid));
      if (raw) {
        const parsed = JSON.parse(raw) as { viewMode?: unknown; collapsedColumns?: unknown };
        if (parsed.viewMode === "board" || parsed.viewMode === "list") setDashboardViewMode(parsed.viewMode);
        if (parsed.collapsedColumns && typeof parsed.collapsedColumns === "object") {
          setCollapsedProjectStatusColumns(parsed.collapsedColumns as Record<string, boolean>);
        }
      }
    } catch {
      // Ignore malformed/corrupt stored prefs — just fall back to defaults.
    }
    setBoardPrefsHydrated(true);
  }, [user?.uid]);
  useEffect(() => {
    // Don't write until hydration has actually run — otherwise the very first render's default
    // values would overwrite whatever was already saved for this user before it's even been read.
    if (typeof window === "undefined" || !user?.uid || !boardPrefsHydrated) return;
    window.localStorage.setItem(
      dashboardBoardPrefsStorageKey(user.uid),
      JSON.stringify({ viewMode: dashboardViewMode, collapsedColumns: collapsedProjectStatusColumns }),
    );
  }, [user?.uid, boardPrefsHydrated, dashboardViewMode, collapsedProjectStatusColumns]);
  const isDarkMode = themeMode === "dark";
  const dashboardPalette = isDarkMode
    ? {
        pageBg: "#0f0f0f",
        sectionBg: "#181818",
        panelBg: "#212121",
        panelMuted: "#272727",
        panelAlt: "#303030",
        border: "#3f3f46",
        text: "#f1f1f1",
        textMuted: "#aaaaaa",
        textSoft: "#c9d1d9",
        inputBg: "#303134",
        inputText: "#f1f1f1",
        rowHover: "#2a2a2a",
        strongShadow: "0 1px 2px rgba(0,0,0,0.3)",
      }
    : {
        pageBg: "#ffffff",
        sectionBg: "#ffffff",
        panelBg: "#ffffff",
        panelMuted: "#F5F7FA",
        panelAlt: "#EEF2F7",
        border: "#D7DEE8",
        text: "#111827",
        textMuted: "#64748B",
        textSoft: "#475467",
        inputBg: "#F3F5F8",
        inputText: "#5B6472",
        rowHover: "#F2F6FC",
        strongShadow: "0 1px 2px rgba(15,23,42,0.06)",
      };
  const [isProjectsHeaderStuck, setIsProjectsHeaderStuck] = useState(false);
  const projectsTableHeadRef = useRef<HTMLTableSectionElement | null>(null);
  useEffect(() => {
    let ticking = false;
    const checkStuck = () => {
      ticking = false;
      const headEl = projectsTableHeadRef.current;
      if (!headEl) return;
      setIsProjectsHeaderStuck(headEl.getBoundingClientRect().top <= 49);
    };
    const onScrollOrResize = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(checkStuck);
    };
    checkStuck();
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, []);
  const canAccessDashboard = useMemo(() => {
    const role = String(effectiveCompanyRole || user?.role || "").trim().toLowerCase();
    if (role === "owner" || role === "admin") {
      return true;
    }
    return (effectiveCompanyPermissions.length ? effectiveCompanyPermissions : user?.permissions ?? []).some(
      (permission) => String(permission || "").trim().toLowerCase() === "company.dashboard.view",
    );
  }, [effectiveCompanyPermissions, effectiveCompanyRole, user?.permissions, user?.role]);

  useEffect(() => {
    setThemeMode(readThemeMode());
    if (typeof window === "undefined") return;
    const onThemeUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: ThemeMode }>).detail;
      setThemeMode(detail?.mode === "dark" ? "dark" : "light");
    };
    window.addEventListener(THEME_MODE_UPDATED_EVENT, onThemeUpdated as EventListener);
    return () => {
      window.removeEventListener(THEME_MODE_UPDATED_EVENT, onThemeUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCompanyAccess = async () => {
      if (!cancelled) {
        setCompanyAccessResolved(false);
      }
      try {
        const storedCompanyId =
          typeof window !== "undefined"
            ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
            : "";
        const directCompanyId = String(user?.companyId || "").trim();
        const fallbackMembership = !directCompanyId && user?.uid
          ? await retryAsync(() => fetchPrimaryMembership(user.uid!), { attempts: 2, delayMs: 250 })
          : null;
        const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
        if (!user?.uid || !companyId) {
          if (!cancelled) {
            setEffectiveCompanyRole(String(user?.role || "").trim().toLowerCase());
            setEffectiveCompanyPermissions(Array.isArray(user?.permissions) ? user.permissions : []);
            setCompanyAccessResolved(true);
          }
          return;
        }
        const companyAccess = await retryAsync(() => fetchCompanyAccess(companyId, user.uid!), {
          attempts: 2,
          delayMs: 250,
        });
        if (cancelled) return;
        setEffectiveCompanyRole(String(companyAccess?.role || user?.role || "").trim().toLowerCase());
        setEffectiveCompanyPermissions(companyAccess?.permissionKeys ?? (Array.isArray(user?.permissions) ? user.permissions : []));
      } catch {
        if (!cancelled) {
          setEffectiveCompanyRole(String(user?.role || "").trim().toLowerCase());
          setEffectiveCompanyPermissions(Array.isArray(user?.permissions) ? user.permissions : []);
          setCompanyAccessResolved(true);
        }
        return;
      }
      if (!cancelled) {
        setCompanyAccessResolved(true);
      }
    };
    void loadCompanyAccess();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, user?.permissions, user?.role, user?.uid]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!cancelled) {
        setIsLoading(true);
        setStatusRowsLoaded(false);
      }
      try {
        const storedCompanyId =
          typeof window !== "undefined"
            ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
            : "";
        const preferredCompanyIds = [storedCompanyId, String(user?.companyId || "").trim()].filter(Boolean);
        const items = await retryAsync(() => fetchProjects(user?.uid, preferredCompanyIds), {
          attempts: 2,
          delayMs: 350,
          shouldRetryResult: (value, attempt) =>
            attempt === 1 &&
            preferredCompanyIds.length > 0 &&
            Array.isArray(value) &&
            value.length === 0,
        });
        if (cancelled) return;
        setAllProjects(items);
        const fallbackCompanyId = String(items[0]?.companyId || "").trim();
        const companyId = storedCompanyId || fallbackCompanyId;
        const creatorUids = items.map((row) => String(row.createdByUid || "").trim()).filter(Boolean);
        const assignedUids = items.map((row) => String(row.assignedToUid || "").trim()).filter(Boolean);
        const userColorMap = await retryAsync(
          () => fetchUserColorMapByUids([...creatorUids, ...assignedUids], companyId),
          { attempts: 2, delayMs: 250 },
        );
        if (cancelled) return;
        setCreatorColorByUid(userColorMap);
        if (companyId) {
          const [companyDoc, members] = await retryAsync(
            () =>
              Promise.all([
                fetchCompanyDoc(companyId),
                fetchCompanyMembers(companyId),
              ]),
            { attempts: 2, delayMs: 250 },
          );
          if (cancelled) return;
          setStatusRows(normalizeStatuses((companyDoc as Record<string, unknown> | null)?.projectStatuses));
          setStatusRowsLoaded(true);
          setDashboardLegendRows(normalizeDashboardLegend((companyDoc as Record<string, unknown> | null)?.dashboardCompleteLegend));
          setCompanyMembers(members);
          setRoleRows(normalizeRoleRows((companyDoc as Record<string, unknown> | null)?.roles));
          const themeColor = String((companyDoc as Record<string, unknown> | null)?.themeColor ?? "").trim();
          if (themeColor) setCompanyThemeColor(themeColor);
        } else {
          setStatusRows(normalizeStatuses(undefined));
          setStatusRowsLoaded(true);
          setDashboardLegendRows([]);
          setCompanyMembers([]);
          setRoleRows([]);
        }
      } catch {
        if (cancelled) return;
        setAllProjects([]);
        setCreatorColorByUid({});
        setStatusRows(normalizeStatuses(undefined));
        setStatusRowsLoaded(true);
        setDashboardLegendRows([]);
        setCompanyMembers([]);
        setRoleRows([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, user?.uid]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUserColorUpdated = (event: Event) => {
      const detail = (event as CustomEvent<UserColorUpdatedDetail>).detail;
      const uid = String(detail?.uid || "").trim();
      const color = String(detail?.color || "").trim();
      if (!uid) return;
      setCreatorColorByUid((prev) => {
        const next = { ...prev };
        if (color) next[uid] = color;
        else delete next[uid];
        return next;
      });
      setCompanyMembers((prev) =>
        prev.map((member) =>
          String(member.uid || "").trim() === uid
            ? { ...member, badgeColor: color || undefined, userColor: color || undefined }
            : member,
        ),
      );
    };
    window.addEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    return () => {
      window.removeEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    };
  }, []);

  const openNewProjectModal = (e?: React.MouseEvent<HTMLElement>) => {
    const origin = e ? captureGlassModalOrigin(e) : null;
    window.dispatchEvent(new CustomEvent("cutsmart:new-project", { detail: { origin } }));
  };

  const statusColorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of statusRows) {
      map.set(String(row.name || "").trim().toLowerCase(), String(row.color || "").trim() || "#64748B");
    }
    return map;
  }, [statusRows]);

  const statusOptions = useMemo(() => {
    const options = statusRows.map((row) => row.name).filter(Boolean);
    return options.length ? options : ["New", "In Production", "On Hold", "Complete"];
  }, [statusRows]);

  const projectStatusPillStyle = (statusLabel: string) => {
    const configured = statusColorByName.get(String(statusLabel || "").trim().toLowerCase());
    if (configured) {
      return { backgroundColor: configured, color: "#FFFFFF" };
    }
    return statusPillColors(statusLabel);
  };
  const canEditProjectFromDashboard = (project: Project) =>
    projectTabAccess(
      project,
      String(effectiveCompanyRole || user?.role || "").trim().toLowerCase() || "staff",
      "general",
      user?.uid,
      effectiveCompanyPermissions.length ? effectiveCompanyPermissions : user?.permissions ?? [],
    ).edit && Boolean(user?.verified);

  const openProjectInDashboard = async (projectId: string, projectName?: string) => {
    const name = String(projectName || "").trim();
    router.push(name ? `/projects/${projectId}?openName=${encodeURIComponent(name)}` : `/projects/${projectId}`);
  };

  const onProjectRowActivate = (project: Project, sourceEl: HTMLElement | null) => {
    const existingTab = globalAppTabs.find((tab) => tab.scopeKey === `project:${project.id}`);
    if (existingTab) {
      // Tab's already open somewhere in the strip — opening a project from a generic
      // list should always land on General, not wherever the tab was last left (that
      // stale sub-tab is still preserved in the strip's own href, just not used here).
      router.push(`/projects/${project.id}?tab=general`);
      return;
    }
    if (!sourceEl) {
      void openProjectInDashboard(project.id, project.name);
      return;
    }
    if (openingProjectTimerRef.current != null) {
      window.clearTimeout(openingProjectTimerRef.current);
      openingProjectTimerRef.current = null;
    }
    const rect = sourceEl.getBoundingClientRect();
    const to = { left: 160, top: 9, width: 130, height: 30 };
    const strip = document.querySelector('[data-app-tabs-strip="1"]');
    if (strip) {
      const stripRect = strip.getBoundingClientRect();
      const groups = strip.querySelectorAll("[data-app-tab-group]");
      const lastGroup = groups[groups.length - 1] as HTMLElement | undefined;
      to.left = lastGroup ? lastGroup.getBoundingClientRect().right + 6 : stripRect.left + 4;
      to.top = stripRect.top + (stripRect.height - to.height) / 2;
    }
    setOpeningProjectAnim({
      id: project.id,
      from: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      to,
      phase: "start",
    });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setOpeningProjectAnim((prev) => (prev && prev.id === project.id ? { ...prev, phase: "animating" } : prev));
      });
    });
    openingProjectTimerRef.current = window.setTimeout(() => {
      openingProjectTimerRef.current = null;
      // Register a placeholder tab the instant the fly-up ghost lands, so the
      // tab bar already shows it before navigation/data-fetch finishes — the
      // real project page's own registration (keyed to the same scopeKey)
      // seamlessly replaces this once it mounts, rather than leaving a gap
      // where no tab is visible yet.
      const scopeKey = `project:${project.id}`;
      registerScopeTabs(scopeKey, [
        {
          key: `${scopeKey}:opening`,
          label: project.name || "Project",
          href: `/projects/${project.id}`,
          scopeKey,
          groupKey: scopeKey,
          groupLabel: project.name || "Project",
          active: true,
        },
      ]);
      void openProjectInDashboard(project.id, project.name);
    }, 220);
  };

  const onSelectProjectStatus = async (project: Project, nextStatus: string) => {
    if (!nextStatus || statusUpdatingProjectId || !canEditProjectFromDashboard(project)) return;
    const previousStatus = project.statusLabel;
    setStatusUpdatingProjectId(project.id);
    // Optimistic: drop the card straight into its new column instead of waiting on the write to
    // resolve first — the round-trip is what made a drop feel like it "took a while" to land.
    setAllProjects((prev) =>
      prev.map((row) =>
        row.id === project.id ? { ...row, statusLabel: nextStatus, updatedAt: new Date().toISOString() } : row,
      ),
    );
    setStatusMenuProjectId("");
    setStatusMenuPos(null);
    const ok = await updateProjectStatus(project, nextStatus);
    if (!ok) {
      // Persist failed — put it back where it actually is.
      setAllProjects((prev) =>
        prev.map((row) => (row.id === project.id ? { ...row, statusLabel: previousStatus } : row)),
      );
    }
    setStatusUpdatingProjectId("");
  };

  const statusMenuProject = useMemo(
    () => allProjects.find((p) => p.id === statusMenuProjectId) ?? null,
    [allProjects, statusMenuProjectId],
  );

  useEffect(() => {
    if (!statusMenuProjectId) return;

    const closeMenu = () => {
      setStatusMenuProjectId("");
      setStatusMenuPos(null);
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-status-menu='true']")) return;
      if (target.closest("[data-status-trigger='true']")) return;
      closeMenu();
    };

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [statusMenuProjectId]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!showCompletedProjectsModal && !showStaffModal) return;
    const scrollY = window.scrollY;
    const scrollbarGutterWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevHtmlOverflowY = document.documentElement.style.overflowY;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyOverflowY = document.body.style.overflowY;
    const prevBodyPosition = document.body.style.position;
    const prevBodyTop = document.body.style.top;
    const prevBodyLeft = document.body.style.left;
    const prevBodyRight = document.body.style.right;
    const prevBodyWidth = document.body.style.width;
    const prevBodyPaddingRight = document.body.style.paddingRight;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overflowY = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overflowY = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.paddingRight =
      scrollbarGutterWidth > 0 ? `${scrollbarGutterWidth}px` : prevBodyPaddingRight;
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.documentElement.style.overflowY = prevHtmlOverflowY;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.overflowY = prevBodyOverflowY;
      document.body.style.position = prevBodyPosition;
      document.body.style.top = prevBodyTop;
      document.body.style.left = prevBodyLeft;
      document.body.style.right = prevBodyRight;
      document.body.style.width = prevBodyWidth;
      document.body.style.paddingRight = prevBodyPaddingRight;
      window.scrollTo({ top: scrollY, behavior: "auto" });
    };
  }, [showCompletedProjectsModal, showStaffModal]);

  useEffect(() => {
    return () => {
      if (completedModalTimerRef.current != null) {
        window.clearTimeout(completedModalTimerRef.current);
      }
      if (staffModalTimerRef.current != null) {
        window.clearTimeout(staffModalTimerRef.current);
      }
      if (openingProjectTimerRef.current != null) {
        window.clearTimeout(openingProjectTimerRef.current);
      }
    };
  }, []);

  const filtered = useMemo(() => {
    let rows = allProjects.filter((project) => {
      const statusLabel = String(project.statusLabel || "New");

      if (quickFilter === "active" && isCompletedStatus(statusLabel)) {
        return false;
      }
      if (quickFilter === "completed" && !isCompletedStatus(statusLabel)) {
        return false;
      }

      const tagsText = (project.tags || []).join(" ");
      const haystack = `${project.name} ${assignedDisplayName(project)} ${statusLabel} ${tagsText}`.toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) {
        return false;
      }

      return true;
    });

    rows = rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    const openRows = rows.filter((r) => !isCompletedStatus(r.statusLabel));
    const completeRows = rows.filter((r) => isCompletedStatus(r.statusLabel));
    return [...openRows, ...completeRows];
  }, [allProjects, quickFilter, search]);
  const showProjectsLoadingState = isLoading && filtered.length === 0;

  // Reset how many rows are revealed whenever the filtered result set changes
  // shape (new search/filter) or the user picks a different page size — the
  // filter itself is untouched by this, only how much of it is shown.
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [search, quickFilter, pageSize]);

  const visibleProjects = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Board view groups the same `filtered` set (search + Active/Completed already applied) into
  // one column per configured project status — unpaginated, since a kanban board is meant to show
  // everything at once rather than a page at a time.
  const dashboardStatusBoardColumns = useMemo(() => {
    const columns = statusRows.map((row) => ({ name: row.name, color: row.color, projects: [] as Project[] }));
    const byKey = new Map(columns.map((col) => [col.name.trim().toLowerCase(), col]));
    const otherProjects: Project[] = [];
    for (const project of filtered) {
      const col = byKey.get(String(project.statusLabel || "New").trim().toLowerCase());
      if (col) col.projects.push(project);
      else otherProjects.push(project);
    }
    return { columns, otherProjects };
  }, [filtered, statusRows]);

  const onProjectBoardCardDragStart = (event: ReactDragEvent<HTMLDivElement>, project: Project) => {
    if (!canEditProjectFromDashboard(project)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", project.id);
    event.dataTransfer.effectAllowed = "move";
    setDraggingProjectId(project.id);
    if (projectBoardDragGhost.transparentImageRef.current) {
      event.dataTransfer.setDragImage(projectBoardDragGhost.transparentImageRef.current, 0, 0);
    }
    const color = String(projectStatusPillStyle(project.statusLabel || "New").backgroundColor || "");
    projectBoardDragGhost.spawn(event, `project-board-name-${project.id}`, { label: project.name, color });
  };

  const onProjectBoardCardDragEnd = () => {
    setDraggingProjectId("");
    setDragOverProjectStatusColumn("");
    projectBoardDragGhost.end();
  };

  const onProjectBoardColumnDrop = (event: ReactDragEvent<HTMLElement>, statusName: string) => {
    event.preventDefault();
    setDragOverProjectStatusColumn("");
    const projectId = event.dataTransfer.getData("text/plain") || draggingProjectId;
    setDraggingProjectId("");
    // Dismiss the ghost here too, not just on the source card's onDragEnd — a successful drop can
    // move the project into a different column (a different DOM parent), and if that happens
    // before the browser dispatches `dragend` on the now-detached original element, the native
    // event never fires and the ghost is left stuck on screen.
    projectBoardDragGhost.end();
    const project = allProjects.find((row) => row.id === projectId);
    if (!project) return;
    if (String(project.statusLabel || "New").trim().toLowerCase() === statusName.trim().toLowerCase()) return;
    void onSelectProjectStatus(project, statusName);
  };

  const renderProjectBoardCard = (project: Project, accentColor: string) => {
    const canEdit = canEditProjectFromDashboard(project);
    const displayAssigned = assignedDisplayName(project);
    const cardBg = isDarkMode ? darkenHexColor(accentColor, 0.75) : lightenHexColor(accentColor, 0.82);
    const cardBorder = isDarkMode ? darkenHexColor(accentColor, 0.4) : lightenHexColor(accentColor, 0.5);
    const cardText = isDarkMode ? dashboardPalette.text : "#000000";
    const chipBg = isDarkMode ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)";
    return (
      <div
        key={project.id}
        id={`project-board-name-${project.id}`}
        draggable={canEdit}
        onDragStart={(e) => onProjectBoardCardDragStart(e, project)}
        onDragEnd={onProjectBoardCardDragEnd}
        onClick={(e) => onProjectRowActivate(project, e.currentTarget)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onProjectRowActivate(project, e.currentTarget);
          }
        }}
        className="flex flex-col gap-2 rounded-[12px] border p-2.5 text-left transition hover:brightness-105"
        style={{
          borderColor: cardBorder,
          backgroundColor: cardBg,
          opacity: draggingProjectId === project.id ? 0.4 : 1,
          cursor: draggingProjectId === project.id ? "grabbing" : "pointer",
        }}
      >
        <p className="truncate text-[12.5px] font-bold" style={{ color: cardText }}>{project.name}</p>
        {project.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {project.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-[6px] px-1.5 py-[1px] text-[10px] font-bold"
                style={{ backgroundColor: chipBg, color: cardText }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          {displayAssigned ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: creatorColorByUid[String(project.assignedToUid || "").trim()] || companyThemeColor }}
              >
                {initials(displayAssigned)}
              </span>
              <span className="truncate text-[11px] font-semibold" style={{ color: cardText }}>{displayAssigned}</span>
            </div>
          ) : <span />}
          <span className="shrink-0 text-[10px] font-semibold" style={{ color: cardText, opacity: 0.65 }}>
            {dashboardDate(project.updatedAt)}
          </span>
        </div>
      </div>
    );
  };

  // Reveals exactly one more page-size batch when the user scrolls near the
  // bottom. If the current batch doesn't produce a scrollbar at all (nothing
  // to scroll to trigger the listener), it auto-loads one more batch after a
  // short pause and re-checks — each step still only ever adds `pageSize`,
  // spaced out so it never appears to jump straight to several batches at
  // once; it just keeps stepping until a scrollbar appears or every matching
  // project is shown. Mirrors the rAF-throttled window-scroll pattern used
  // for the sticky table header.
  useEffect(() => {
    let ticking = false;
    const loadOneMoreBatch = () => {
      setVisibleCount((prev) => (prev >= filtered.length ? prev : Math.min(filtered.length, prev + pageSize)));
    };
    const checkNearBottom = () => {
      ticking = false;
      const scrollBottom = window.scrollY + window.innerHeight;
      const pageHeight = document.documentElement.scrollHeight;
      if (scrollBottom >= pageHeight - 600) {
        loadOneMoreBatch();
      }
    };
    const onScrollOrResize = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(checkNearBottom);
    };
    const canScroll = document.documentElement.scrollHeight > window.innerHeight + 40;
    const noScrollbarTimer =
      !canScroll && visibleCount < filtered.length ? window.setTimeout(loadOneMoreBatch, 200) : null;
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      if (noScrollbarTimer) window.clearTimeout(noScrollbarTimer);
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [filtered.length, pageSize, visibleCount]);

  const stats = useMemo(() => {
    const total = allProjects.length;
    const active = allProjects.filter((p) => !isCompletedStatus(p.statusLabel)).length;
    const completed = allProjects.filter((p) => isCompletedStatus(p.statusLabel)).length;
    const staff = companyMembers.length;

    const now = new Date();
    const weekStart = new Date(now);
    // Monday-start week for parity with desktop expectations.
    const day = weekStart.getDay();
    const daysFromMonday = (day + 6) % 7;
    weekStart.setDate(weekStart.getDate() - daysFromMonday);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartMs = weekStart.getTime();

    const wasCreatedThisWeek = (value: string) => {
      const ms = new Date(String(value || "")).getTime();
      return Number.isFinite(ms) && ms >= weekStartMs;
    };

    const totalThisWeek = allProjects.filter((p) => wasCreatedThisWeek(p.createdAt)).length;
    const activeThisWeek = allProjects.filter(
      (p) => !isCompletedStatus(p.statusLabel) && wasCreatedThisWeek(p.createdAt),
    ).length;
    const completedThisWeek = allProjects.filter((p) => {
      if (!isCompletedStatus(p.statusLabel)) return false;
      const updatedMs = new Date(String(p.updatedAt || "")).getTime();
      return Number.isFinite(updatedMs) && updatedMs >= weekStartMs;
    }).length;

    const staffThisWeek = companyMembers.filter((member) => {
      const raw = member as unknown as Record<string, unknown>;
      const createdMs = new Date(String(raw.createdAtIso ?? raw.createdAt ?? "")).getTime();
      return Number.isFinite(createdMs) && createdMs >= weekStartMs;
    }).length;

    return {
      total,
      active,
      completed,
      staff,
      weekly: {
        total: totalThisWeek,
        active: activeThisWeek,
        completed: completedThisWeek,
        staff: staffThisWeek,
      },
    };
  }, [allProjects, companyMembers]);

  const completedProjects = useMemo(() => {
    return allProjects
      .filter((project) => isCompletedStatus(project.statusLabel))
      .map((project) => ({
        project,
        completedIso: completedProjectIso(project),
        monthKey: monthKeyFromIso(completedProjectIso(project)),
      }))
      .sort((a, b) => String(b.completedIso).localeCompare(String(a.completedIso)));
  }, [allProjects]);

  const completedMonthOptions = useMemo(() => {
    return Array.from(new Set(completedProjects.map((row) => row.monthKey).filter(Boolean))).sort(
      (a, b) => monthSortValue(b) - monthSortValue(a),
    );
  }, [completedProjects]);

  const completedDatePresets = useMemo(() => {
    const thisMonth = monthKeyForOffset(0);
    const oldest = completedMonthOptions[completedMonthOptions.length - 1] || thisMonth;
    const newest = completedMonthOptions[0] || thisMonth;
    return [
      { id: "thisMonth", label: "This Month", from: thisMonth, to: thisMonth },
      { id: "last3", label: "Last 3 Months", from: monthKeyForOffset(2), to: thisMonth },
      { id: "allTime", label: "All Time", from: oldest, to: newest },
    ];
  }, [completedMonthOptions]);

  useEffect(() => {
    if (!completedMonthOptions.length) {
      setCompletedMonthFrom("");
      setCompletedMonthTo("");
      return;
    }
    setCompletedMonthFrom((prev) => (prev && completedMonthOptions.includes(prev) ? prev : completedMonthOptions[completedMonthOptions.length - 1]));
    setCompletedMonthTo((prev) => (prev && completedMonthOptions.includes(prev) ? prev : completedMonthOptions[0]));
  }, [completedMonthOptions]);

  useEffect(() => {
    if (!dashboardLegendRows.length) {
      if (activeCompletedLegendId) {
        setActiveCompletedLegendId("");
      }
      return;
    }
    if (dashboardLegendRows.some((row) => row.id === activeCompletedLegendId)) return;
    setActiveCompletedLegendId(dashboardLegendRows[0]?.id || "");
  }, [activeCompletedLegendId, dashboardLegendRows]);

  const filteredCompletedProjects = useMemo(() => {
    const fromValue = monthSortValue(completedMonthFrom);
    const toValue = monthSortValue(completedMonthTo);
    const lower = fromValue > 0 && toValue > 0 ? Math.min(fromValue, toValue) : null;
    const upper = fromValue > 0 && toValue > 0 ? Math.max(fromValue, toValue) : null;
    return completedProjects.filter((row) => {
      if (!row.monthKey || lower == null || upper == null) return true;
      const value = monthSortValue(row.monthKey);
      return value >= lower && value <= upper;
    });
  }, [completedMonthFrom, completedMonthTo, completedProjects]);

  const completedProjectsByMonth = useMemo(() => {
    const groups = new Map<string, typeof filteredCompletedProjects>();
    filteredCompletedProjects.forEach((row) => {
      const key = row.monthKey || "unknown";
      const existing = groups.get(key);
      if (existing) existing.push(row);
      else groups.set(key, [row]);
    });
    return Array.from(groups.entries()).sort((a, b) => monthSortValue(b[0]) - monthSortValue(a[0]));
  }, [filteredCompletedProjects]);

  const onOpenCompletedProjectsModal = () => {
    if (completedModalTimerRef.current != null) {
      window.clearTimeout(completedModalTimerRef.current);
      completedModalTimerRef.current = null;
    }
    if (typeof window !== "undefined") {
      const rect = completedCardRef.current?.getBoundingClientRect();
      if (rect) {
        setCompletedCardRect({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
      } else {
        setCompletedCardRect({
          left: Math.max(16, window.innerWidth / 2 - 140),
          top: Math.max(16, window.innerHeight / 2 - 70),
          width: 280,
          height: 140,
        });
      }
    }
    setShowCompletedProjectsModal(true);
    setCompletedProjectsModalExpanded(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setCompletedProjectsModalExpanded(true));
    });
  };

  const onCloseCompletedProjectsModal = () => {
    setCompletedProjectsModalExpanded(false);
    completedModalTimerRef.current = window.setTimeout(() => {
      setShowCompletedProjectsModal(false);
      completedModalTimerRef.current = null;
    }, 420);
  };

  const onOpenStaffModal = () => {
    if (staffModalTimerRef.current != null) {
      window.clearTimeout(staffModalTimerRef.current);
      staffModalTimerRef.current = null;
    }
    if (typeof window !== "undefined") {
      const rect = staffCardRef.current?.getBoundingClientRect();
      if (rect) {
        setStaffCardRect({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
      } else {
        setStaffCardRect({
          left: Math.max(16, window.innerWidth / 2 - 140),
          top: Math.max(16, window.innerHeight / 2 - 70),
          width: 280,
          height: 140,
        });
      }
    }
    setShowStaffModal(true);
    setStaffModalExpanded(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setStaffModalExpanded(true));
    });
  };

  const onCloseStaffModal = () => {
    setStaffModalExpanded(false);
    staffModalTimerRef.current = window.setTimeout(() => {
      setShowStaffModal(false);
      staffModalTimerRef.current = null;
    }, 420);
  };

  const onSelectCompletedProjectDate = async (project: Project, nextDateValue: string) => {
    const nextIso = dateInputValueToCompletedIso(nextDateValue);
    if (!nextIso || !user?.verified) return;
    setCompletedDateUpdatingProjectId(project.id);
    const ok = await updateProjectPatch(project, { completedAtIso: nextIso });
    if (ok) {
      setAllProjects((prev) =>
        prev.map((row) =>
          row.id === project.id
            ? (Object.assign({}, row, { completedAtIso: nextIso, updatedAt: new Date().toISOString() }) as Project)
            : row,
        ),
      );
    }
    setCompletedDateUpdatingProjectId("");
  };

  const onApplyCompletedProjectLegend = async (project: Project) => {
    const nextLegendId = String(activeCompletedLegendId || "").trim();
    if (!nextLegendId || !user?.verified) return;
    const rawProject = project as unknown as Record<string, unknown>;
    const currentLegendId = String(rawProject.dashboardCompleteStatusId ?? "").trim();
    if (currentLegendId === nextLegendId) return;
    const stableCompletedIso = completedProjectIso(project);
    setCompletedLegendUpdatingProjectId(project.id);
    const patch: Record<string, unknown> = { dashboardCompleteStatusId: nextLegendId };
    if (!String(rawProject.completedAtIso ?? "").trim() && stableCompletedIso) {
      patch.completedAtIso = stableCompletedIso;
    }
    const ok = await updateProjectPatch(project, patch);
    if (ok) {
      setAllProjects((prev) =>
        prev.map((row) =>
          row.id === project.id
            ? (Object.assign(
                {},
                row,
                {
                  dashboardCompleteStatusId: nextLegendId,
                  completedAtIso: String((row as unknown as Record<string, unknown>).completedAtIso ?? "").trim() || stableCompletedIso,
                },
              ) as Project)
            : row,
        ),
      );
    }
    setCompletedLegendUpdatingProjectId("");
  };

  const openCompletedDatePicker = (projectId: string) => {
    const input = completedDateInputRefs.current[projectId];
    if (!input) return;
    const picker = input as HTMLInputElement & { showPicker?: () => void };
    try {
      if (typeof picker.showPicker === "function") {
        picker.showPicker();
        return;
      }
    } catch {
      // Fall back to focus/click for browsers that gate showPicker.
    }
    input.focus();
    input.click();
  };

  const completedProjectsModal =
    showCompletedProjectsModal && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[1600] flex items-center justify-center px-4 py-4">
            <button
              type="button"
              aria-label="Close completed projects backdrop"
              onClick={onCloseCompletedProjectsModal}
              className="absolute inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-[2px] transition-opacity duration-[420ms]"
              style={{ opacity: completedProjectsModalExpanded ? 1 : 0 }}
            />
            {(() => {
              const targetWidth = Math.min(920, window.innerWidth - 32);
              const targetHeight = Math.min(window.innerHeight * 0.86, 760);
              const targetLeft = Math.max(16, (window.innerWidth - targetWidth) / 2);
              const targetTop = Math.max(16, (window.innerHeight - targetHeight) / 2);
              const startRect = completedCardRect ?? {
                left: targetLeft,
                top: targetTop,
                width: targetWidth,
                height: targetHeight,
              };
              const shellRect = completedProjectsModalExpanded
                ? { left: targetLeft, top: targetTop, width: targetWidth, height: targetHeight }
                : startRect;
              return (
                <div
                  className="pointer-events-none fixed z-[1601]"
                  style={{
                    left: shellRect.left,
                    top: shellRect.top,
                    width: shellRect.width,
                    height: shellRect.height,
                    transition: "left 420ms cubic-bezier(0.22, 1, 0.36, 1), top 420ms cubic-bezier(0.22, 1, 0.36, 1), width 420ms cubic-bezier(0.22, 1, 0.36, 1), height 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
                    transformStyle: "preserve-3d",
                    transform: `perspective(1800px) rotateX(${completedProjectsModalExpanded ? 180 : 0}deg)`,
                  }}
                >
                  <div
                    className="absolute inset-0 rounded-[18px] border px-4 py-3"
                    style={{
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      borderColor: "var(--glass-border)",
                      backgroundColor: "var(--glass-bg-strong)",
                      backdropFilter: "blur(20px) saturate(180%)",
                      WebkitBackdropFilter: "blur(20px) saturate(180%)",
                      boxShadow: "var(--shadow-glass)",
                    }}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <div
                        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-white"
                        style={{ backgroundImage: "linear-gradient(135deg, #6BC79A 0%, #2E8C5C 100%)" }}
                      >
                        <CheckCircle2 size={16} strokeWidth={2.4} />
                      </div>
                      <p className="text-[14px] font-semibold sm:text-[16px] lg:text-[17px]" style={{ color: dashboardPalette.textSoft }}>Completed</p>
                    </div>
                    <p className="text-[34px] font-medium leading-none sm:text-[40px] lg:text-[46px]" style={{ color: dashboardPalette.text }}>{stats.completed}</p>
                    {stats.weekly.completed > 0 && (
                      <p className="pt-1 text-[13px] font-bold" style={{ color: "#2A7A3B" }}>
                        + {stats.weekly.completed} this week
                      </p>
                    )}
                  </div>
                  <div
                    data-completed-projects-modal="true"
                    className="glass-modal-panel absolute inset-0 flex flex-col overflow-hidden"
                    style={{
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      transform: "rotateX(180deg)",
                      opacity: completedProjectsModalExpanded ? 1 : 0,
                      pointerEvents: completedProjectsModalExpanded ? "auto" : "none",
                      transition: "opacity 180ms ease",
                    }}
                  >
                    <div className="glass-modal-header flex h-[56px] shrink-0 items-center justify-between px-5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white"
                          style={{ backgroundImage: "linear-gradient(135deg, #6BC79A 0%, #2E8C5C 100%)" }}
                        >
                          <CheckCircle2 size={14} strokeWidth={2.6} />
                        </div>
                        <p className="text-[15px] font-bold" style={{ color: "var(--text-main)" }}>Completed Projects</p>
                        <span
                          className="rounded-full border px-2 py-[2px] text-[11px] font-bold"
                          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                        >
                          {filteredCompletedProjects.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={onCloseCompletedProjectsModal}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border hover:brightness-95"
                        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div
                      className="flex flex-wrap items-center gap-3 border-b px-5 py-3"
                      style={{ borderColor: "var(--glass-border)" }}
                    >
                      {dashboardLegendRows.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>Status</span>
                          {dashboardLegendRows.map((item) => {
                            const isActive = activeCompletedLegendId === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => setActiveCompletedLegendId((prev) => (prev === item.id ? "" : item.id))}
                                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95"
                                style={{
                                  borderColor: isActive ? "var(--brand-strong)" : "var(--glass-border)",
                                  backgroundColor: isActive ? "var(--brand-soft)" : "var(--panel-muted)",
                                  color: "var(--text-main)",
                                  boxShadow: isActive ? "0 0 0 1px var(--brand)" : "none",
                                }}
                                title={item.name || "Completed color"}
                              >
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                                {item.name || "Status"}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <div className="ml-auto flex flex-wrap items-center gap-1.5">
                        {completedDatePresets.map((preset) => {
                          const isActive = completedMonthFrom === preset.from && completedMonthTo === preset.to;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setCompletedMonthFrom(preset.from);
                                setCompletedMonthTo(preset.to);
                              }}
                              className="inline-flex h-8 items-center rounded-full border px-3 text-[12px] font-semibold transition hover:brightness-95"
                              style={
                                isActive
                                  ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff" }
                                  : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }
                              }
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div ref={completedProjectsScrollRef} className="glass-scroll hide-native-scrollbar min-h-0 flex-1 overflow-auto px-5 py-4">
                      {!completedProjectsByMonth.length ? (
                        <div
                          className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed px-4 py-10 text-center"
                          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
                        >
                          <CheckCircle2 size={22} style={{ color: "var(--text-muted)" }} />
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text-muted)" }}>No completed projects yet.</p>
                        </div>
                      ) : (
                        <div>
                          {completedProjectsByMonth.map(([monthKey, rows]) => (
                            <div key={`completed_month_${monthKey}`}>
                              <div
                                className="sticky top-0 z-10 -mx-5 flex items-center justify-between border-b px-5 py-2"
                                style={{
                                  borderColor: "var(--glass-border)",
                                  backgroundColor: "var(--glass-modal-bg)",
                                  backdropFilter: "blur(12px) saturate(220%)",
                                  WebkitBackdropFilter: "blur(12px) saturate(220%)",
                                }}
                              >
                                <p className="text-[13px] font-bold uppercase tracking-[0.5px]" style={{ color: "var(--text-main)" }}>{monthLabelFromKey(monthKey)}</p>
                                <span
                                  className="inline-flex rounded-full border px-2.5 py-[2px] text-[11px] font-bold"
                                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                                >
                                  {rows.length}
                                </span>
                              </div>
                              <div className="py-1">
                                {rows.map(({ project, completedIso }, index) => {
                                  const rawProject = project as unknown as Record<string, unknown>;
                                  const legendId = String(rawProject.dashboardCompleteStatusId ?? "").trim();
                                  const legendMatch = dashboardLegendRows.find((row) => row.id === legendId);
                                  const rowFillColor = legendMatch?.color || "";
                                  const rowHasFill = Boolean(rowFillColor);
                                  const rowTextColor = rowHasFill ? rowTextColorForFill(rowFillColor) : "var(--text-main)";
                                  const rowDateColor = rowHasFill ? rowTextColor : "var(--text-muted)";
                                  const isDateUpdating = completedDateUpdatingProjectId === project.id;
                                  const isLegendUpdating = completedLegendUpdatingProjectId === project.id;
                                  const canApplyLegend = Boolean(activeCompletedLegendId) && !isDateUpdating && !isLegendUpdating;
                                  return (
                                    <div
                                      key={`completed_project_${project.id}`}
                                      className="relative flex items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 transition hover:brightness-95"
                                      onClick={() => {
                                        if (!canApplyLegend) return;
                                        void onApplyCompletedProjectLegend(project);
                                      }}
                                      style={{
                                        borderTop: !rowHasFill && index > 0 ? "1px solid var(--glass-border)" : "1px solid transparent",
                                        marginTop: index > 0 ? 1 : 0,
                                        backgroundColor: rowFillColor || "transparent",
                                        cursor: canApplyLegend ? "pointer" : "default",
                                      }}
                                    >
                                      <div className="min-w-0 flex-1">
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            onCloseCompletedProjectsModal();
                                            void openProjectInDashboard(project.id, project.name);
                                          }}
                                          className="inline-flex max-w-full text-left transition hover:opacity-80"
                                        >
                                          <span className="block truncate pr-3 text-[13px] font-bold" style={{ color: rowTextColor }}>
                                            {project.name || "Untitled"}
                                          </span>
                                        </button>
                                      </div>
                                      <div className="relative flex shrink-0 items-center gap-1.5">
                                        <CalendarDays size={13} style={{ color: rowDateColor, opacity: 0.7 }} />
                                        <input
                                          type="date"
                                          ref={(node) => {
                                            completedDateInputRefs.current[project.id] = node;
                                          }}
                                          value={isoToDateInputValue(completedIso)}
                                          onChange={(event) => void onSelectCompletedProjectDate(project, event.currentTarget.value)}
                                          tabIndex={-1}
                                          aria-hidden="true"
                                          className="pointer-events-none absolute h-0 w-0 opacity-0"
                                        />
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            openCompletedDatePicker(project.id);
                                          }}
                                          disabled={isDateUpdating}
                                          className="text-[12px] font-bold transition hover:opacity-80 disabled:cursor-wait"
                                          style={{ color: rowDateColor }}
                                        >
                                          {dashboardDateOnly(completedIso)}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>,
          document.body,
        )
      : null;

  const roleNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of roleRows) {
      if (row.id) map.set(row.id, row.name);
    }
    return map;
  }, [roleRows]);

  const roleColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of roleRows) {
      if (row.id) map.set(row.id, row.color);
    }
    return map;
  }, [roleRows]);

  const staffMembersByRole = useMemo(() => {
    const groups = new Map<string, typeof companyMembers>();
    companyMembers.forEach((member) => {
      const roleKey = normalizeRoleKey(member.roleId || member.role);
      const existing = groups.get(roleKey);
      if (existing) existing.push(member);
      else groups.set(roleKey, [member]);
    });
    const roleOrder = roleRows.map((row) => row.id);
    return Array.from(groups.entries()).sort((a, b) => {
      const aIndex = roleOrder.indexOf(a[0]);
      const bIndex = roleOrder.indexOf(b[0]);
      if (aIndex === -1 && bIndex === -1) return a[0].localeCompare(b[0]);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }, [companyMembers, roleRows]);

  const staffModal =
    showStaffModal && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[1600] flex items-center justify-center px-4 py-4">
            <button
              type="button"
              aria-label="Close staff backdrop"
              onClick={onCloseStaffModal}
              className="absolute inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-[2px] transition-opacity duration-[420ms]"
              style={{ opacity: staffModalExpanded ? 1 : 0 }}
            />
            {(() => {
              const targetWidth = Math.min(860, window.innerWidth - 32);
              const targetHeight = Math.min(window.innerHeight * 0.82, 720);
              const targetLeft = Math.max(16, (window.innerWidth - targetWidth) / 2);
              const targetTop = Math.max(16, (window.innerHeight - targetHeight) / 2);
              const startRect = staffCardRect ?? {
                left: targetLeft,
                top: targetTop,
                width: targetWidth,
                height: targetHeight,
              };
              const shellRect = staffModalExpanded
                ? { left: targetLeft, top: targetTop, width: targetWidth, height: targetHeight }
                : startRect;
              return (
                <div
                  className="pointer-events-none fixed z-[1601]"
                  style={{
                    left: shellRect.left,
                    top: shellRect.top,
                    width: shellRect.width,
                    height: shellRect.height,
                    transition: "left 420ms cubic-bezier(0.22, 1, 0.36, 1), top 420ms cubic-bezier(0.22, 1, 0.36, 1), width 420ms cubic-bezier(0.22, 1, 0.36, 1), height 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
                    transformStyle: "preserve-3d",
                    transform: `perspective(1800px) rotateX(${staffModalExpanded ? 180 : 0}deg)`,
                  }}
                >
                  <div
                    className="absolute inset-0 rounded-[18px] border px-4 py-3"
                    style={{
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      borderColor: "var(--glass-border)",
                      backgroundColor: "var(--glass-bg-strong)",
                      backdropFilter: "blur(20px) saturate(180%)",
                      WebkitBackdropFilter: "blur(20px) saturate(180%)",
                      boxShadow: "var(--shadow-glass)",
                    }}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <div
                        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-white"
                        style={{ backgroundImage: "linear-gradient(135deg, #A796F0 0%, #6E56D9 100%)" }}
                      >
                        <Users2 size={16} strokeWidth={2.4} />
                      </div>
                      <p className="text-[14px] font-semibold sm:text-[16px] lg:text-[17px]" style={{ color: dashboardPalette.textSoft }}>Staff Members</p>
                    </div>
                    <p className="text-[34px] font-medium leading-none sm:text-[40px] lg:text-[46px]" style={{ color: dashboardPalette.text }}>{stats.staff}</p>
                    {stats.weekly.staff > 0 && (
                      <p className="pt-1 text-[13px] font-bold" style={{ color: "#2A7A3B" }}>
                        + {stats.weekly.staff} this week
                      </p>
                    )}
                  </div>
                  <div
                    data-staff-modal="true"
                    className="glass-modal-panel absolute inset-0 flex flex-col overflow-hidden"
                    style={{
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      transform: "rotateX(180deg)",
                      opacity: staffModalExpanded ? 1 : 0,
                      pointerEvents: staffModalExpanded ? "auto" : "none",
                      transition: "opacity 180ms ease",
                    }}
                  >
                    <div className="glass-modal-header flex h-[56px] shrink-0 items-center justify-between px-5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white"
                          style={{ backgroundImage: "linear-gradient(135deg, #A796F0 0%, #6E56D9 100%)" }}
                        >
                          <Users2 size={14} strokeWidth={2.6} />
                        </div>
                        <p className="text-[15px] font-bold" style={{ color: "var(--text-main)" }}>Staff Members</p>
                        <span
                          className="rounded-full border px-2 py-[2px] text-[11px] font-bold"
                          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                        >
                          {companyMembers.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={onCloseStaffModal}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border hover:brightness-95"
                        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div ref={staffMembersScrollRef} className="glass-scroll hide-native-scrollbar min-h-0 flex-1 overflow-auto px-5 py-2">
                      {!companyMembers.length ? (
                        <div
                          className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed px-4 py-10 text-center"
                          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
                        >
                          <Users2 size={22} style={{ color: "var(--text-muted)" }} />
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text-muted)" }}>No staff members found.</p>
                        </div>
                      ) : (
                        <div>
                          {staffMembersByRole.map(([roleKey, members]) => {
                            const roleColor = roleColorById.get(roleKey) || "#7D99B3";
                            const roleLabel = roleNameById.get(roleKey) || roleLabelFromKey(roleKey);
                            return (
                              <div key={`staff_role_${roleKey}`}>
                                <div
                                  className="sticky top-0 z-10 -mx-5 flex items-center gap-2 border-b px-5 py-2"
                                  style={{
                                    borderColor: "var(--glass-border)",
                                    backgroundColor: "var(--glass-modal-bg)",
                                    backdropFilter: "blur(12px) saturate(220%)",
                                    WebkitBackdropFilter: "blur(12px) saturate(220%)",
                                  }}
                                >
                                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: roleColor }} />
                                  <p className="text-[13px] font-bold uppercase tracking-[0.5px]" style={{ color: "var(--text-main)" }}>{roleLabel}</p>
                                  <span
                                    className="inline-flex rounded-full border px-2.5 py-[2px] text-[11px] font-bold"
                                    style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                                  >
                                    {members.length}
                                  </span>
                                </div>
                                <div className="py-1">
                                  {members.map((member, index) => {
                                    const avatarColor = String(member.badgeColor || member.userColor || companyThemeColor).trim() || companyThemeColor;
                                    return (
                                      <div
                                        key={`staff_member_${member.uid}`}
                                        className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition hover:brightness-95"
                                        style={{ borderTop: index > 0 ? "1px solid var(--glass-border)" : "1px solid transparent" }}
                                      >
                                        <span
                                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                                          style={{ backgroundColor: avatarColor }}
                                        >
                                          {initials(member.displayName || member.email || member.uid)}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-[13px] font-bold" style={{ color: "var(--text-main)" }}>
                                            {member.displayName || member.email || member.uid}
                                          </p>
                                          {member.email ? (
                                            <p className="truncate text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                                              {member.email}
                                            </p>
                                          ) : null}
                                        </div>
                                        <button
                                          type="button"
                                          disabled
                                          className="inline-flex h-8 shrink-0 items-center justify-center rounded-[8px] border px-3 text-[12px] font-bold opacity-60"
                                          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                                          title="Coming soon"
                                        >
                                          View
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>,
          document.body,
        )
      : null;

  const openingProjectOverlay =
    openingProjectAnim && typeof document !== "undefined"
      ? createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[3000] overflow-hidden rounded-[14px] border"
            style={{
              left: openingProjectAnim.phase === "animating" ? openingProjectAnim.to.left : openingProjectAnim.from.left,
              top: openingProjectAnim.phase === "animating" ? openingProjectAnim.to.top : openingProjectAnim.from.top,
              width: openingProjectAnim.phase === "animating" ? openingProjectAnim.to.width : openingProjectAnim.from.width,
              height: openingProjectAnim.phase === "animating" ? openingProjectAnim.to.height : openingProjectAnim.from.height,
              opacity: openingProjectAnim.phase === "animating" ? 0 : 1,
              transform: openingProjectAnim.phase === "animating" ? "scale(0.92)" : "scale(1)",
              transition:
                openingProjectAnim.phase === "animating"
                  ? "left 220ms cubic-bezier(0.34, 1.56, 0.64, 1), top 220ms cubic-bezier(0.34, 1.56, 0.64, 1), width 220ms cubic-bezier(0.34, 1.56, 0.64, 1), height 220ms cubic-bezier(0.34, 1.56, 0.64, 1), transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 160ms ease 60ms"
                  : "none",
              borderColor: "var(--glass-border)",
              backgroundColor: "var(--glass-bg-strong)",
              boxShadow: "var(--shadow-glass)",
            }}
          />,
          document.body,
        )
      : null;

  return (
    <>
          {!companyAccessResolved ? (
            <div
              className="rounded-[14px] p-6 text-[13px] font-semibold"
              style={{
                border: `1px solid ${dashboardPalette.border}`,
                backgroundColor: dashboardPalette.panelBg,
                color: dashboardPalette.textSoft,
                boxShadow: dashboardPalette.strongShadow,
              }}
            >
              Checking access...
            </div>
          ) : !canAccessDashboard ? (
            <div
              className="rounded-[14px] p-6 text-[13px] font-semibold"
              style={{
                border: `1px solid ${dashboardPalette.border}`,
                backgroundColor: dashboardPalette.panelBg,
                color: dashboardPalette.textSoft,
                boxShadow: dashboardPalette.strongShadow,
              }}
            >
              You do not have permission to access the company dashboard.
            </div>
          ) : (
          <>
          <div className="space-y-0">

          <div
            className="relative z-0"
            style={{
              marginTop: -16,
              marginLeft: -12,
              marginRight: -12,
              padding: 16,
            }}
          >
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {statCards.map((card) => {
                const Icon = card.icon;
                const value = stats[card.key];
                const isCompletedCard = card.key === "completed";
                const isStaffCard = card.key === "staff";
                const isInteractiveCard = isCompletedCard || isStaffCard;
                return (
                  <div
                    key={card.label}
                    ref={isCompletedCard ? completedCardRef : isStaffCard ? staffCardRef : null}
                    role={isInteractiveCard ? "button" : undefined}
                    tabIndex={isInteractiveCard ? 0 : undefined}
                    onClick={isCompletedCard ? onOpenCompletedProjectsModal : isStaffCard ? onOpenStaffModal : undefined}
                    onKeyDown={
                      isInteractiveCard
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (isCompletedCard) onOpenCompletedProjectsModal();
                              if (isStaffCard) onOpenStaffModal();
                            }
                          }
                        : undefined
                    }
                    onMouseMove={(e) => {
                      const el = e.currentTarget;
                      const rect = el.getBoundingClientRect();
                      const rotateY = ((e.clientX - rect.left - rect.width / 2) / (rect.width / 2)) * 3;
                      const rotateX = -((e.clientY - rect.top - rect.height / 2) / (rect.height / 2)) * 3;
                      el.style.transition = "transform 60ms linear";
                      el.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-1px) scale(1.008)`;
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget;
                      el.style.transition = "transform 350ms cubic-bezier(0.22, 1, 0.36, 1)";
                      el.style.transform = "perspective(800px) rotateX(0deg) rotateY(0deg) translateY(0px) scale(1)";
                    }}
                    className={`rounded-[18px] border px-5 py-4 ${
                      isInteractiveCard ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]" : ""
                    }`}
                    style={{
                      borderColor: "var(--glass-border)",
                      backgroundColor: "var(--glass-bg-strong)",
                      backdropFilter: "blur(20px) saturate(180%)",
                      WebkitBackdropFilter: "blur(20px) saturate(180%)",
                      boxShadow: "var(--shadow-glass)",
                      willChange: "transform",
                    }}
                  >
                    <div className="mb-3 flex items-center gap-2.5">
                      <div
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white shadow-[0_4px_10px_rgba(0,0,0,0.14)]"
                        style={{ backgroundImage: `linear-gradient(135deg, ${card.iconFrom} 0%, ${card.iconTo} 100%)` }}
                      >
                        <Icon size={17} strokeWidth={2.4} />
                      </div>
                      <p className="text-[13px] font-semibold sm:text-[14px]" style={{ color: dashboardPalette.textSoft }}>{card.label}</p>
                    </div>
                    <p className="text-[32px] font-semibold leading-none sm:text-[38px] lg:text-[42px]" style={{ color: dashboardPalette.text }}>{value}</p>
                    {stats.weekly[card.key] > 0 && (
                      <p className="pt-1 text-[13px] font-bold" style={{ color: "#2A7A3B" }}>
                        + {stats.weekly[card.key]} this week
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Toolbar lives OUTSIDE the sticky panel below so it scrolls away with the stat
              cards on mobile — otherwise the board columns can never reach the top of the
              viewport, since the toolbar's own height would always sit above them inside the
              stuck panel. */}
          <div
            className="relative z-10 border-t border-b px-[10px] pb-3 pt-[19px]"
            style={{
              borderColor: "var(--glass-border)",
              backgroundColor: dashboardPalette.panelMuted,
              marginLeft: -12,
              marginRight: -12,
            }}
          >
              <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-[10px]">
                <button
                  type="button"
                  role="switch"
                  aria-checked={dashboardViewMode === "board"}
                  onClick={() => setDashboardViewMode((prev) => (prev === "list" ? "board" : "list"))}
                  className="relative inline-flex h-[38px] w-[82px] shrink-0 items-center overflow-hidden rounded-full border p-1"
                  style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelBg }}
                  title="Toggle project view"
                  aria-label="Toggle project view"
                >
                  <div
                    className="absolute top-1 h-7 w-9 rounded-full transition-all duration-200"
                    style={{ left: dashboardViewMode === "list" ? 4 : 40, backgroundImage: "var(--brand-gradient)" }}
                  />
                  <span className="relative z-[1] flex h-7 w-9 items-center justify-center rounded-full">
                    <Rows3 size={15} style={{ color: dashboardViewMode === "list" ? "#fff" : dashboardPalette.textMuted }} />
                  </span>
                  <span className="relative z-[1] flex h-7 w-9 items-center justify-center rounded-full">
                    <Kanban size={15} style={{ color: dashboardViewMode === "board" ? "#fff" : dashboardPalette.textMuted }} />
                  </span>
                </button>
                <div className="relative w-full min-w-0 sm:w-auto sm:min-w-[260px] sm:max-w-[360px]">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: dashboardPalette.textMuted }}
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects..."
                    className="h-9 w-full rounded-[10px] border pl-8 pr-3 text-[12px] font-semibold outline-none transition focus:border-[var(--brand)]"
                    style={{
                      borderColor: dashboardPalette.border,
                      backgroundColor: dashboardPalette.panelBg,
                      color: dashboardPalette.inputText,
                    }}
                  />
                </div>
                <div className="flex gap-1.5">
                  {[
                    { key: "all", label: "All" },
                    { key: "active", label: "Active" },
                    { key: "completed", label: "Completed" },
                  ].map((option) => (
                    <button
                      key={option.key}
                      onClick={() => setQuickFilter(option.key as QuickFilter)}
                      className="h-9 rounded-[10px] border px-4 text-[12px] font-bold transition"
                      style={{
                        backgroundColor: quickFilter === option.key ? undefined : dashboardPalette.panelBg,
                        backgroundImage: quickFilter === option.key ? "var(--brand-gradient)" : "none",
                        borderColor: quickFilter === option.key ? "var(--brand)" : dashboardPalette.border,
                        color: quickFilter === option.key ? "#FFFFFF" : dashboardPalette.text,
                        boxShadow: quickFilter === option.key ? "var(--shadow-sm)" : "none",
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {dashboardViewMode === "list" && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold" style={{ color: dashboardPalette.textMuted }}>Show</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="h-9 rounded-[10px] border px-2 text-[12px] font-bold outline-none"
                      style={{
                        borderColor: dashboardPalette.border,
                        backgroundColor: dashboardPalette.panelBg,
                        color: dashboardPalette.text,
                      }}
                    >
                      {[10, 20, 30, 40, 50].map((size) => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                    <span className="text-[11px] font-semibold" style={{ color: dashboardPalette.textMuted }}>
                      per page
                    </span>
                  </div>
                )}
              </div>

          </div>

          <div
            ref={boardStickyRef}
            className={`relative z-10 border-b ${
              dashboardViewMode === "board"
                ? "sticky top-0 flex h-[calc(100dvh-48px)] min-h-[280px] flex-col overflow-hidden pt-[10px] lg:top-[48px] lg:h-[calc(100dvh-48px)] lg:min-h-[320px]"
                : ""
            }`}
            style={{
              borderColor: "var(--glass-border)",
              backgroundColor: "var(--glass-bg-strong)",
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
              boxShadow: "var(--shadow-glass)",
              marginLeft: -12,
              marginRight: -12,
            }}
          >

          {dashboardViewMode === "list" && (
          <div className="lg:hidden">
                {showProjectsLoadingState && (
                  <div className="px-3 py-6 text-[13px] font-semibold" style={{ color: dashboardPalette.textMuted }}>Loading projects...</div>
                )}
                {!showProjectsLoadingState && filtered.length === 0 && (
                  <div className="px-3 py-10">
                    <div className="flex flex-col items-center gap-3">
                      <p className="text-[14px] font-bold" style={{ color: dashboardPalette.textSoft }}>No Projects Yet</p>
                      <button
                        type="button"
                        onClick={openNewProjectModal}
                        className="rounded-[10px] bg-[image:var(--brand-gradient)] px-4 py-2 text-[12px] font-bold text-white shadow-[var(--shadow-sm)] transition hover:brightness-105"
                      >
                        Create First Project
                      </button>
                    </div>
                  </div>
                )}
                {!isLoading && visibleProjects.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 px-2 pb-2 md:grid-cols-2">
                    {visibleProjects.map((project) => (
                      <div
                        key={project.id}
                        role="button"
                        tabIndex={0}
                        className="w-full cursor-pointer rounded-[14px] border px-3.5 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]"
                        style={{
                          borderColor: dashboardPalette.border,
                          backgroundColor: hoveredProjectId === project.id ? dashboardPalette.rowHover : dashboardPalette.panelBg,
                          opacity: openingProjectAnim?.id === project.id ? 0 : 1,
                        }}
                        onMouseEnter={() => setHoveredProjectId(project.id)}
                        onMouseLeave={() => setHoveredProjectId((prev) => (prev === project.id ? "" : prev))}
                        onClick={(e) => onProjectRowActivate(project, e.currentTarget)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onProjectRowActivate(project, e.currentTarget);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 text-[13px] font-bold" style={{ color: dashboardPalette.text }}>{project.name}</p>
                          <button
                            data-status-trigger="true"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (statusUpdatingProjectId === project.id || !canEditProjectFromDashboard(project)) {
                                return;
                              }
                              if (statusMenuProjectId === project.id) {
                                setStatusMenuProjectId("");
                                setStatusMenuPos(null);
                                return;
                              }
                              const trigger = e.currentTarget as HTMLButtonElement;
                              const rect = trigger.getBoundingClientRect();
                              const estimatedMenuHeight = 156;
                              const hasRoomBelow = rect.bottom + estimatedMenuHeight <= window.innerHeight - 8;
                              const hasRoomAbove = rect.top - estimatedMenuHeight >= 8;
                              const shouldOpenUp = !hasRoomBelow && hasRoomAbove;
                              const menuWidth = Math.max(120, Math.round(rect.width));
                              const clampedLeft = Math.min(
                                Math.max(8, rect.left),
                                window.innerWidth - menuWidth - 8,
                              );
                              setStatusMenuPos({
                                left: clampedLeft,
                                top: shouldOpenUp ? Math.max(8, rect.top - estimatedMenuHeight - 4) : rect.bottom + 4,
                                width: menuWidth,
                              });
                              setStatusMenuProjectId(project.id);
                            }}
                            className="inline-flex h-7 w-[118px] shrink-0 items-center justify-center rounded-[10px] px-3 text-[11px] font-bold"
                            style={projectStatusPillStyle(project.statusLabel || "New")}
                            aria-disabled={statusUpdatingProjectId === project.id || !canEditProjectFromDashboard(project)}
                            aria-label="Project status"
                            title={canEditProjectFromDashboard(project) ? "Change project status" : "You can view this project but not change its status"}
                          >
                            {statusUpdatingProjectId === project.id ? "Saving..." : project.statusLabel || "New"}
                          </button>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1">
                          {project.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-[8px] border px-2 py-[1px] text-[11px] font-bold"
                              style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelMuted, color: dashboardPalette.textSoft }}
                            >
                              {tag}
                            </span>
                          ))}
                          {project.tags.length > 2 && <span className="font-bold" style={{ color: dashboardPalette.textMuted }}>...</span>}
                        </div>

                        <div className="mt-2 flex items-center gap-2 text-[12px]">
                          {assignedDisplayName(project) ? (
                            <>
                              <span
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                style={{
                                  backgroundColor:
                                    creatorColorByUid[String(project.assignedToUid || "").trim()] || companyThemeColor,
                                }}
                              >
                                {initials(assignedDisplayName(project))}
                              </span>
                              <span style={{ color: dashboardPalette.text }}>{assignedDisplayName(project)}</span>
                            </>
                          ) : null}
                        </div>

                        <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2" style={{ color: dashboardPalette.textSoft }}>
                          <p>
                            <span className="font-bold" style={{ color: dashboardPalette.textMuted }}>Created:</span> {dashboardDate(project.createdAt)}
                          </p>
                          <p>
                            <span className="font-bold" style={{ color: dashboardPalette.textMuted }}>Modified:</span> {dashboardDate(project.updatedAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!isLoading && visibleProjects.length < filtered.length && (
                  <div className="px-3 py-4 text-center text-[12px] font-semibold" style={{ color: dashboardPalette.textMuted }}>
                    Loading more projects...
                  </div>
                )}
              </div>
          )}

          {dashboardViewMode === "board" && (
          <div
            className="glass-scroll flex snap-x snap-mandatory items-stretch gap-[10px] overflow-x-auto overflow-y-hidden px-[10px] pb-[10px] sm:snap-none"
            style={{ flex: "1 1 auto", minHeight: 0 }}
          >
            {(showProjectsLoadingState || !statusRowsLoaded) && (
              <div className="px-3 py-6 text-[13px] font-semibold" style={{ color: dashboardPalette.textMuted }}>Loading projects...</div>
            )}
            {!showProjectsLoadingState && statusRowsLoaded && filtered.length === 0 && (
              <div className="flex flex-col items-center gap-3 px-4 py-10">
                <p className="text-[14px] font-bold" style={{ color: dashboardPalette.textSoft }}>No Projects Yet</p>
                <button
                  type="button"
                  onClick={openNewProjectModal}
                  className="rounded-[10px] bg-[image:var(--brand-gradient)] px-4 py-2 text-[12px] font-bold text-white shadow-[var(--shadow-sm)] transition hover:brightness-105"
                >
                  Create First Project
                </button>
              </div>
            )}
            {!showProjectsLoadingState && statusRowsLoaded && filtered.length > 0 && dashboardStatusBoardColumns.columns.map((column) => {
              const isDragOver = dragOverProjectStatusColumn === column.name;
              const isCollapsed = Boolean(collapsedProjectStatusColumns[column.name]);
              const dragHandlers = {
                onDragOver: (e: ReactDragEvent<HTMLElement>) => {
                  e.preventDefault();
                  if (dragOverProjectStatusColumn !== column.name) setDragOverProjectStatusColumn(column.name);
                },
                onDragLeave: (e: ReactDragEvent<HTMLElement>) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setDragOverProjectStatusColumn((prev) => (prev === column.name ? "" : prev));
                },
                onDrop: (e: ReactDragEvent<HTMLElement>) => onProjectBoardColumnDrop(e, column.name),
              };
              const glassColumnBg = hexToRgba(column.color, 0.85);
              const glassColumnBorder = "rgba(255,255,255,0.3)";
              const glassColumnSurface: React.CSSProperties = {
                backgroundColor: glassColumnBg,
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
              };
              const glassColumnShadow = isDragOver
                ? "0 0 0 3px rgba(255,255,255,0.85), inset 0 1px 0 rgba(255,255,255,0.7)"
                : "inset 0 1px 0 rgba(255,255,255,0.7), inset 0 30px 40px -32px rgba(255,255,255,0.35), var(--shadow-glass)";
              const columnBadgeBg = isDarkMode ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)";
              const columnBadgeText = isDarkMode ? dashboardPalette.text : "#000000";
              if (isCollapsed) {
                return (
                  // Shadow AND the scroll-reveal height live on this outer shell (not the button
                  // below) — the shadow always renders around whatever size the outer currently
                  // is, so setting the height here (rather than clip-path-ing the button) keeps
                  // it continuously in sync with the reveal instead of needing to be a separate
                  // unclipped layer.
                  <div
                    key={column.name}
                    {...dragHandlers}
                    data-board-column="true"
                    className="h-full w-[52px] shrink-0 snap-center sm:snap-align-none"
                    style={{ borderRadius: 16, boxShadow: glassColumnShadow }}
                  >
                    <button
                      type="button"
                      onClick={() => setCollapsedProjectStatusColumns((prev) => ({ ...prev, [column.name]: false }))}
                      className="flex h-full w-full flex-col items-center gap-3 overflow-hidden rounded-[16px] border pb-3 pt-2.5 transition hover:brightness-105"
                      style={{
                        borderColor: glassColumnBorder,
                        ...glassColumnSurface,
                      }}
                      title={`Expand ${column.name}`}
                      aria-label={`Expand ${column.name}`}
                    >
                      <span
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                        style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                      >
                        <ChevronsLeftRight size={13} />
                      </span>
                      <span
                        className="inline-flex h-6 min-w-[24px] shrink-0 items-center justify-center rounded-full px-2 text-[10px] font-bold"
                        style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                      >
                        {column.projects.length}
                      </span>
                      <span
                        className="shrink-0 whitespace-nowrap text-[14px] font-normal"
                        style={{ writingMode: "vertical-rl", color: "#000000", letterSpacing: "0.12em" }}
                      >
                        {column.name}
                      </span>
                    </button>
                  </div>
                );
              }
              return (
                // See the collapsed-button case above for why the shadow and reveal height sit
                // on this outer shell rather than on the column div below.
                <div
                  key={column.name}
                  {...dragHandlers}
                  data-board-column="true"
                  className="h-full w-[85vw] max-w-[300px] shrink-0 snap-center sm:w-[280px] sm:max-w-none sm:snap-align-none"
                  style={{ borderRadius: 16, boxShadow: glassColumnShadow }}
                >
                  <div
                    className="flex h-full w-full flex-col overflow-hidden rounded-[16px] border transition"
                    style={{
                      borderColor: glassColumnBorder,
                      ...glassColumnSurface,
                    }}
                  >
                    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: "rgba(0,0,0,0.15)" }}>
                      <p className="truncate text-[13px] font-semibold" style={{ color: "#000000" }}>{column.name}</p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-2 text-[10px] font-bold"
                          style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                        >
                          {column.projects.length}
                        </span>
                        <button
                          type="button"
                          onClick={() => setCollapsedProjectStatusColumns((prev) => ({ ...prev, [column.name]: true }))}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full transition hover:brightness-95"
                          style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                          title={`Collapse ${column.name}`}
                          aria-label={`Collapse ${column.name}`}
                        >
                          <ChevronsRightLeft size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="glass-scroll board-column-scroll flex-1 space-y-2.5 overflow-y-hidden p-2.5" style={{ scrollbarWidth: "none" }}>
                      {column.projects.length === 0 ? (
                        <p className="px-1 py-6 text-center text-[11px] font-semibold" style={{ color: "#000000" }}>No projects.</p>
                      ) : (
                        column.projects.map((project) => renderProjectBoardCard(project, column.color))
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {!showProjectsLoadingState && statusRowsLoaded && dashboardStatusBoardColumns.otherProjects.length > 0 && (
              // See the column cases above for why the shadow and reveal height sit on this
              // outer shell rather than on the column div below.
              <div
                data-board-column="true"
                className="h-full w-[85vw] max-w-[300px] shrink-0 snap-center sm:w-[280px] sm:max-w-none sm:snap-align-none"
                style={{
                  borderRadius: 16,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), inset 0 30px 40px -32px rgba(255,255,255,0.25), var(--shadow-glass)",
                }}
              >
                <div
                  className="flex h-full w-full flex-col overflow-hidden rounded-[16px] border"
                  style={{
                    borderColor: "rgba(255,255,255,0.3)",
                    backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.06) 35%, rgba(255,255,255,0) 62%)",
                    backgroundColor: "var(--glass-bg-strong)",
                    backdropFilter: "blur(20px) saturate(180%)",
                    WebkitBackdropFilter: "blur(20px) saturate(180%)",
                  }}
                >
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelMuted }}>
                    <p className="truncate text-[13px] font-semibold" style={{ color: dashboardPalette.text }}>Other</p>
                    <span className="shrink-0 rounded-full px-2 py-[1px] text-[10px] font-bold text-white" style={{ backgroundColor: dashboardPalette.textMuted }}>
                      {dashboardStatusBoardColumns.otherProjects.length}
                    </span>
                  </div>
                  <div className="glass-scroll board-column-scroll flex-1 space-y-2.5 overflow-y-hidden p-2.5" style={{ scrollbarWidth: "none" }}>
                    {dashboardStatusBoardColumns.otherProjects.map((project) => renderProjectBoardCard(project, "#64748B"))}
                  </div>
                </div>
              </div>
            )}
          </div>
          )}

          {dashboardViewMode === "list" && (
          <div className="hidden lg:block">
                <table className="w-full min-w-[980px] table-fixed text-[12px]">
                  <colgroup>
                    <col style={{ width: "220px" }} />
                    <col style={{ width: "180px" }} />
                    <col style={{ width: "180px" }} />
                    <col style={{ width: "220px" }} />
                    <col style={{ width: "220px" }} />
                    <col style={{ width: "200px" }} />
                  </colgroup>
                  <thead
                    ref={projectsTableHeadRef}
                    className="sticky top-12 z-20"
                    style={{
                      backgroundColor: isProjectsHeaderStuck
                        ? isDarkMode
                          ? "rgba(10,10,12,0.4)"
                          : "rgba(238,241,248,0.4)"
                        : dashboardPalette.panelMuted,
                      backdropFilter: isProjectsHeaderStuck ? "blur(12px) saturate(220%)" : "none",
                      WebkitBackdropFilter: isProjectsHeaderStuck ? "blur(12px) saturate(220%)" : "none",
                      transition: "background-color 280ms ease, backdrop-filter 280ms ease",
                    }}
                  >
                    <tr className="border-b" style={{ borderBottomColor: dashboardPalette.border }}>
                      <th
                        className="py-2 pl-[10px] text-left text-[11px] font-bold"
                        style={{ color: dashboardPalette.textMuted }}
                      >
                        Project Name
                      </th>
                      <th
                        className="py-2 text-left text-[11px] font-bold"
                        style={{ color: dashboardPalette.textMuted }}
                      >
                        Tags
                      </th>
                      <th
                        className="py-2 text-left text-[11px] font-bold"
                        style={{ color: dashboardPalette.textMuted }}
                      >
                        Assigned
                      </th>
                      <th
                        className="py-2 text-center text-[11px] font-bold"
                        style={{ color: dashboardPalette.textMuted }}
                      >
                        Created
                      </th>
                      <th
                        className="py-2 text-center text-[11px] font-bold"
                        style={{ color: dashboardPalette.textMuted }}
                      >
                        Modified
                      </th>
                      <th
                        className="w-[200px] py-2 text-right text-[11px] font-bold"
                        style={{ color: dashboardPalette.textMuted }}
                      >
                        <span className="inline-block w-[120px] text-center" style={{ marginRight: 10 }}>
                          Status
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>

                  {showProjectsLoadingState && (
                    <tr>
                      <td className="py-3" style={{ color: dashboardPalette.textMuted, backgroundColor: dashboardPalette.panelBg }} colSpan={6}>Loading projects...</td>
                    </tr>
                  )}
                  {!showProjectsLoadingState && filtered.length === 0 && (
                    <tr>
                      <td className="py-10 text-center" style={{ backgroundColor: dashboardPalette.panelBg }} colSpan={6}>
                        <div className="flex flex-col items-center gap-3">
                          <p className="text-[14px] font-bold" style={{ color: dashboardPalette.textSoft }}>No Projects Yet</p>
                          <button
                            type="button"
                            onClick={openNewProjectModal}
                            className="rounded-[10px] bg-[image:var(--brand-gradient)] px-4 py-2 text-[12px] font-bold text-white shadow-[var(--shadow-sm)] transition hover:brightness-105"
                          >
                            Create First Project
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {visibleProjects.map((project) => {
                    const rowBg = hoveredProjectId === project.id ? dashboardPalette.rowHover : dashboardPalette.panelBg;
                    return (
                    <tr
                      key={project.id}
                      className="cursor-pointer border-b transition-colors"
                      style={{
                        borderBottomColor: dashboardPalette.border,
                        opacity: openingProjectAnim?.id === project.id ? 0 : 1,
                        transition: "opacity 200ms ease",
                      }}
                      onMouseEnter={() => setHoveredProjectId(project.id)}
                      onMouseLeave={() => setHoveredProjectId((prev) => (prev === project.id ? "" : prev))}
                      onClick={(e) => onProjectRowActivate(project, e.currentTarget)}
                    >
                      <td className="py-[11px] pl-[10px] font-bold" style={{ color: dashboardPalette.text, backgroundColor: rowBg }}>{project.name}</td>
                      <td className="py-[11px]" style={{ backgroundColor: rowBg }}>
                        <div className="flex flex-wrap gap-1">
                          {project.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-[8px] border px-2 py-[1px] text-[11px] font-bold"
                              style={{
                                borderColor: dashboardPalette.border,
                                backgroundColor: dashboardPalette.panelMuted,
                                color: dashboardPalette.textSoft,
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                          {project.tags.length > 2 && <span className="font-bold" style={{ color: dashboardPalette.textMuted }}>...</span>}
                        </div>
                      </td>
                      <td className="py-[11px]" style={{ backgroundColor: rowBg }}>
                        <div className="flex items-center gap-2 text-[12px]">
                          {assignedDisplayName(project) ? (
                            <>
                              <span
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                style={{
                                  backgroundColor:
                                    creatorColorByUid[String(project.assignedToUid || "").trim()] || companyThemeColor,
                                }}
                              >
                                {initials(assignedDisplayName(project))}
                              </span>
                              <span style={{ color: dashboardPalette.text }}>{assignedDisplayName(project)}</span>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-[11px] text-center text-[12px]" style={{ color: dashboardPalette.textSoft, backgroundColor: rowBg }}>{dashboardDate(project.createdAt)}</td>
                      <td className="py-[11px] text-center text-[12px]" style={{ color: dashboardPalette.textSoft, backgroundColor: rowBg }}>{dashboardDate(project.updatedAt)}</td>
                      <td className="relative w-[200px] py-[11px] text-right" style={{ backgroundColor: rowBg }}>
                          <button
                            data-status-trigger="true"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (statusUpdatingProjectId === project.id || !canEditProjectFromDashboard(project)) {
                                return;
                              }
                              if (statusMenuProjectId === project.id) {
                                setStatusMenuProjectId("");
                                setStatusMenuPos(null);
                                return;
                              }
                              const trigger = e.currentTarget as HTMLButtonElement;
                              const rect = trigger.getBoundingClientRect();
                              const estimatedMenuHeight = 156;
                              const hasRoomBelow = rect.bottom + estimatedMenuHeight <= window.innerHeight - 8;
                              const hasRoomAbove = rect.top - estimatedMenuHeight >= 8;
                              const shouldOpenUp = !hasRoomBelow && hasRoomAbove;
                              const menuWidth = Math.max(120, Math.round(rect.width));
                              const clampedLeft = Math.min(
                                Math.max(8, rect.left),
                                window.innerWidth - menuWidth - 8,
                              );
                              setStatusMenuPos({
                                left: clampedLeft,
                                top: shouldOpenUp
                                  ? Math.max(8, rect.top - estimatedMenuHeight - 4)
                                  : rect.bottom + 4,
                                width: menuWidth,
                              });
                              setStatusMenuProjectId(project.id);
                            }}
                            className="inline-flex w-[120px] items-center justify-center rounded-[10px] px-3 py-[3px] text-[12px] font-bold"
                            style={{ ...projectStatusPillStyle(project.statusLabel || "New"), marginRight: 10 }}
                            aria-disabled={statusUpdatingProjectId === project.id || !canEditProjectFromDashboard(project)}
                            aria-label="Project status"
                            title={canEditProjectFromDashboard(project) ? "Change project status" : "You can view this project but not change its status"}
                          >
                            {statusUpdatingProjectId === project.id ? "Saving..." : project.statusLabel || "New"}
                          </button>
                      </td>
                    </tr>
                  );
                  })}
                  {!isLoading && visibleProjects.length < filtered.length && (
                    <tr>
                      <td className="py-4 text-center" style={{ color: dashboardPalette.textMuted, backgroundColor: dashboardPalette.panelBg }} colSpan={6}>
                        Loading more projects...
                      </td>
                    </tr>
                  )}
                  </tbody>
                </table>
              </div>
          )}
          </div>

              {statusMenuProject &&
                statusMenuPos &&
                createPortal(
                  <div
                    data-status-menu="true"
                    className="fixed overflow-hidden rounded-[10px] border shadow-[var(--shadow-md)]"
                    style={{
                      left: statusMenuPos.left,
                      top: statusMenuPos.top,
                      width: statusMenuPos.width,
                      zIndex: 2147483647,
                      borderColor: dashboardPalette.border,
                      backgroundColor: dashboardPalette.panelBg,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {statusOptions.map((option) => {
                      const active =
                        String(statusMenuProject.statusLabel || "").trim().toLowerCase() === option.toLowerCase();
                      const rowColor = statusColorByName.get(String(option || "").trim().toLowerCase()) || "#64748B";
                      return (
                        <button
                          key={`${statusMenuProject.id}_${option}`}
                          type="button"
                          disabled={statusUpdatingProjectId === statusMenuProject.id}
                          onClick={() => void onSelectProjectStatus(statusMenuProject, option)}
                          className="block w-full border-b px-3 py-2 text-center text-[12px] font-semibold text-white disabled:opacity-55"
                          style={{
                            backgroundColor: rowColor,
                            filter: active ? "brightness(0.96)" : "brightness(1)",
                            borderBottomColor: isDarkMode ? "#232323" : "#EEF2F7",
                          }}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>,
                  document.body,
                )}

            </div>
            {completedProjectsModal}
            {showCompletedProjectsModal && <GlassScrollbarThumb scrollRef={completedProjectsScrollRef} zIndexClassName="z-[8]" />}
            {staffModal}
            {showStaffModal && <GlassScrollbarThumb scrollRef={staffMembersScrollRef} zIndexClassName="z-[8]" />}
            {openingProjectOverlay}
            <DragGhostLayer controller={projectBoardDragGhost} />
          </>
          )}
    </>
  );
}
