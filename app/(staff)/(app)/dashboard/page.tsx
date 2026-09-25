"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Activity, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeftRight, ChevronsRightLeft, FolderKanban, Kanban, ListFilter, RefreshCw, Rows3, Search, Users2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { GlassScrollbarThumb } from "@/components/glass-scrollbar-thumb";
import { attachBoardArrowKeyScroll } from "@/lib/board-arrow-key-scroll";
import { useDragGhost, DragGhostLayer } from "@/lib/use-drag-ghost";
import { useAppTabs } from "@/lib/app-tabs-context";
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
import { DASHBOARD_STAT_CARDS_UPDATED_EVENT, readDashboardStatCardsEnabled } from "@/lib/ui-preferences";
import type { Project } from "@/lib/types";
import { USER_COLOR_UPDATED_EVENT, type UserColorUpdatedDetail } from "@/lib/user-color-sync";
import { retryAsync, withTimeout } from "@/lib/load-retry";
import { captureGlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
type SubStageRow = { name: string; color: string; isDefault?: boolean };
type StatusRow = { name: string; color: string; subStages?: SubStageRow[] };
type RoleRow = { id: string; name: string; color: string };

const statCards = [
  { label: "Projects", key: "total", icon: FolderKanban, iconFrom: "#6EB4FF", iconTo: "#3577E0" },
  { label: "Active", key: "active", icon: Activity, iconFrom: "#F3CD6C", iconTo: "#DC9A1F" },
  { label: "Completed", key: "completed", icon: CheckCircle2, iconFrom: "#6BC79A", iconTo: "#2E8C5C" },
  { label: "Staff", key: "staff", icon: Users2, iconFrom: "#A796F0", iconTo: "#6E56D9" },
] as const;
type QuickFilter = "all" | "active" | "completed";
const QUICK_FILTER_OPTIONS: { key: QuickFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
];
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
      const subStagesRaw = Array.isArray(row.subStages) ? row.subStages : [];
      const subStages: SubStageRow[] = subStagesRaw
        .filter((sub) => sub && typeof sub === "object")
        .map((sub) => {
          const subRow = sub as Record<string, unknown>;
          return {
            name: String(subRow.name ?? "").trim(),
            color: String(subRow.color ?? "").trim() || "#64748B",
            isDefault: Boolean(subRow.isDefault),
          };
        })
        .filter((sub) => sub.name);
      return {
        name: String(row.name ?? "").trim(),
        color: String(row.color ?? "").trim() || "#64748B",
        subStages,
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
    month: "short",
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
  // Deliberately assignedToName only, never the plain assignedTo string — that field falls
  // back to the project creator's name (see normalizeProject in lib/firestore-data.ts) so other
  // read sites always have a sensible display value, but that means it's true even when nobody
  // has actually been assigned, and this helper is used to decide whether to show an assignee
  // badge at all.
  const value = String(project.assignedToName || "").trim();
  return value.toLowerCase() === "unassigned" ? "" : value;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, membershipStatus, retryMembershipLoad } = useAuth();
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
  // Mobile-only — the All/Active/Completed pills collapse into a single filter icon that opens
  // this glass dropdown instead, since there isn't room for three separate buttons next to the
  // search bar and view toggle at that width (see the toolbar row below).
  const [isMobileQuickFilterOpen, setIsMobileQuickFilterOpen] = useState(false);
  const [mobileQuickFilterPos, setMobileQuickFilterPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [statusUpdatingProjectId, setStatusUpdatingProjectId] = useState("");
  const [subStageUpdatingProjectId, setSubStageUpdatingProjectId] = useState("");
  // Board view — a drag-to-change-status kanban alternative to the default list, mirroring the
  // one on the Leads page (same shared drag-ghost helper, same interaction language). View mode
  // and per-column collapse state are remembered per-user (localStorage keyed by uid), so two
  // people sharing a browser profile each keep their own preference.
  const [dashboardViewMode, setDashboardViewMode] = useState<"list" | "board">("list");
  const [draggingProjectId, setDraggingProjectId] = useState("");
  const [dragOverProjectStatusColumn, setDragOverProjectStatusColumn] = useState("");
  const [collapsedProjectStatusColumns, setCollapsedProjectStatusColumns] = useState<Record<string, boolean>>({});
  const [boardPrefsHydrated, setBoardPrefsHydrated] = useState(false);
  // Sub-column drill-down: clicking a main column's header (when it has configured sub-stages)
  // swaps the board area in place to show that column's sub-stage columns — see subBoardColumns
  // below. Not a modal — the back button in the toolbar (to the left of the search bar) returns.
  // Remembered per-user (localStorage, same mechanism as dashboardViewMode/collapsedColumns below)
  // so a refresh reopens the same sub-board instead of dropping back to the main board.
  const [openSubBoardColumnName, setOpenSubBoardColumnName] = useState("");
  const [draggingSubStageProjectId, setDraggingSubStageProjectId] = useState("");
  const [dragOverSubStageColumn, setDragOverSubStageColumn] = useState("");
  // Per-sub-column collapse state, mirroring collapsedProjectStatusColumns for the main board —
  // keyed by `${parent main column name}::${sub-column name}` (not just the sub-column name alone)
  // so two different main columns configured with an identically-named sub-stage (or either one's
  // own "Other" bucket) don't collide in this one flat map.
  const [collapsedSubStageColumns, setCollapsedSubStageColumns] = useState<Record<string, boolean>>({});
  // Sub-board "shatter" effect: the clicked column splits into N vertical slices (portalled to
  // <body>, so the board's own overflow-x-auto can't clip them mid-animation) — one per eventual
  // sub-column (including "Other") — which fly out to each real sub-column's own on-screen box
  // while recoloring from the origin column's color to that sub-column's own. Reversed on close.
  // See onOpenSubBoardColumn/onCloseSubBoard and the effects below them.
  const boardScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const subBoardZoomPieceRefs = useRef<(HTMLDivElement | null)[]>([]);
  // The sub-board's own columns — ONE element, continuously mounted from "opening" all the way
  // through "revealed" (only actually unmounting once "closing" begins), serving three purposes
  // across that span: (1) during "opening", invisible, laid out (grid-stacked with the main board,
  // see the render below) purely so the "opening" effect can read its columns' real on-screen boxes
  // via getBoundingClientRect; (2) during "landed", fading in on top of the main board as the
  // shatter pieces fade out; (3) once "revealed", fully interactive and the container's sole normal
  // content. It must be a single continuously-mounted node rather than separate measurement/reveal
  // elements: a freshly-mounted element can't animate on the very same render it first appears in
  // (no prior committed value to transition from), so splitting it in two reintroduces a one-frame
  // start delay relative to the pieces' own fade — which used to let the still-fully-opaque main
  // board peek through the still-mostly-opaque pieces right as opening finished. It also never
  // switches `position` (grid-stacked, not absolute<->static) — that switch used to force a
  // compositing-layer rebuild for every column's backdrop-filter blur, which read as the columns
  // flashing away and back right when the animation settled.
  const subBoardOverlayRef = useRef<HTMLDivElement | null>(null);
  const [subBoardZoomOrigin, setSubBoardZoomOrigin] = useState<{ left: number; top: number; width: number; height: number; color: string } | null>(null);
  const [subBoardZoomPhase, setSubBoardZoomPhase] = useState<"idle" | "opening" | "landed" | "revealed" | "closing">("idle");
  // On close, the underlying board content swaps back to the main columns immediately (not only
  // once the shrink animation finishes) so they're there, fading in, for the whole close — but the
  // shrink animation itself needs each real sub-column's on-screen box from BEFORE that swap, so
  // onCloseSubBoard measures them eagerly, ahead of the state change that triggers the swap.
  const [subBoardZoomCloseStartRects, setSubBoardZoomCloseStartRects] = useState<Array<{ left: number; top: number; width: number; height: number }> | null>(
    null,
  );
  // Starts true (main board fully visible at rest); onCloseSubBoard flips it false the instant the
  // main columns remount, and the effect below flips it back true one paint later so the opacity
  // change is a real transition, not an instant pop. This mount-then-flip pattern is still correct
  // HERE specifically because the main board's wrapper genuinely, freshly (re)mounts at "closing"
  // (it was fully unmounted throughout "revealed") — unlike its "landed" fade-out below, which is
  // computed directly from phase on an already-mounted element instead, for the reason explained on
  // subBoardOverlayRef above.
  const [mainBoardFadeIn, setMainBoardFadeIn] = useState(true);
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
  // Left/Right arrow keys on the board — see lib/board-arrow-key-scroll.ts for the actual
  // algorithm (shared with the Leads page's own board, same column markup convention). Attached
  // via a callback ref (merged onto boardScrollContainerRef below), NOT a plain useEffect keyed on
  // dashboardViewMode — this board panel mounts behind its own loading gate (see boardStickyRef's
  // own comment above: "can mount *after* dashboardViewMode has already settled to 'board'"), so
  // an effect keyed only on that state value can fire while the real DOM node is still null and
  // then never re-fire once it actually mounts, permanently missing the attachment. A callback ref
  // runs exactly when this specific node mounts/unmounts, sidestepping that race entirely — the
  // same reasoning boardStickyRef itself is built on.
  const boardArrowKeyCleanupRef = useRef<(() => void) | null>(null);
  const boardScrollContainerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    boardScrollContainerRef.current = el;
    boardArrowKeyCleanupRef.current?.();
    boardArrowKeyCleanupRef.current = el ? attachBoardArrowKeyScroll(el) : null;
  }, []);
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
  const access = useCompanyAccess();
  useEffect(() => {
    if (typeof window === "undefined" || !user?.uid) return;
    try {
      const raw = window.localStorage.getItem(dashboardBoardPrefsStorageKey(user.uid));
      if (raw) {
        const parsed = JSON.parse(raw) as {
          viewMode?: unknown;
          collapsedColumns?: unknown;
          collapsedSubStageColumns?: unknown;
          openSubBoardColumnName?: unknown;
        };
        if (parsed.viewMode === "board" || parsed.viewMode === "list") setDashboardViewMode(parsed.viewMode);
        if (parsed.collapsedColumns && typeof parsed.collapsedColumns === "object") {
          setCollapsedProjectStatusColumns(parsed.collapsedColumns as Record<string, boolean>);
        }
        if (parsed.collapsedSubStageColumns && typeof parsed.collapsedSubStageColumns === "object") {
          setCollapsedSubStageColumns(parsed.collapsedSubStageColumns as Record<string, boolean>);
        }
        // Restore straight into "revealed" — fully open, no shatter animation to replay (there's no
        // real click event here to capture an origin rect from). onCloseSubBoard already falls back
        // to an instant close (no animation) when subBoardZoomOrigin is null, which is exactly this
        // state until the user closes and reopens it normally.
        if (typeof parsed.openSubBoardColumnName === "string" && parsed.openSubBoardColumnName) {
          setOpenSubBoardColumnName(parsed.openSubBoardColumnName);
          setSubBoardZoomPhase("revealed");
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
      JSON.stringify({
        viewMode: dashboardViewMode,
        collapsedColumns: collapsedProjectStatusColumns,
        collapsedSubStageColumns,
        openSubBoardColumnName,
      }),
    );
  }, [user?.uid, boardPrefsHydrated, dashboardViewMode, collapsedProjectStatusColumns, collapsedSubStageColumns, openSubBoardColumnName]);
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
  const canAccessDashboard =
    access.status === "ready" &&
    (isOwnerOrAdmin(access.role) || hasPermissionKey(access.permissionKeys, "company.dashboard.view"));

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

  // User Settings > "Dashboard stat cards" toggle.
  const [dashboardStatCardsEnabled, setDashboardStatCardsEnabled] = useState(true);
  useEffect(() => {
    setDashboardStatCardsEnabled(readDashboardStatCardsEnabled());
    if (typeof window === "undefined") return;
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled: boolean }>).detail;
      setDashboardStatCardsEnabled(detail?.enabled ?? true);
    };
    window.addEventListener(DASHBOARD_STAT_CARDS_UPDATED_EVENT, onUpdated as EventListener);
    return () => {
      window.removeEventListener(DASHBOARD_STAT_CARDS_UPDATED_EVENT, onUpdated as EventListener);
    };
  }, []);

  // A cold app start (no warm Firebase ID token / IndexedDB auth restore yet — the case a fresh
  // mobile PWA launch hits every time, since it has nothing cached) can make auth-context's own
  // membership fetch time out even though the user really is signed in with a real company.
  // auth-context then publishes a fallback identity with companyId left undefined and
  // membershipStatus: "error" (see lib/auth-context.tsx) — every consumer is documented to treat
  // that as "unknown", never as "confirmed no company", but this page previously didn't check it
  // at all: it just fetched projects with an empty companyId hint, silently got back [], and
  // showed "No Projects Yet" as if the company genuinely had none. A warm reload afterward always
  // "fixed" it only because the retry starts from an already-warm connection. Automatically
  // retrying membership resolution once here (rather than requiring the user to notice and
  // manually reload) gives the real companyId a real second chance to resolve — once it does,
  // `user?.companyId` changes, and the project-loading effect below (already depending on it)
  // re-fires on its own with a correct value.
  const hasAutoRetriedMembershipRef = useRef(false);
  useEffect(() => {
    if (membershipStatus !== "error" || hasAutoRetriedMembershipRef.current) return;
    hasAutoRetriedMembershipRef.current = true;
    retryMembershipLoad();
  }, [membershipStatus, retryMembershipLoad]);

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
        // withTimeout must wrap EACH individual attempt, inside retryAsync — not wrap the whole
        // retryAsync call from outside. A hung (never settling, not merely slow) Firestore call
        // makes that difference the entire point: retryAsync only advances to the next attempt
        // once the current one SETTLES, so an outer withTimeout can only ever kill the whole
        // sequence after its one deadline, and retryAsync never gets a real second attempt at all
        // — confirmed live via a real cold-mobile trace: membership resolved correctly in 0.56s,
        // then this call sat completely silent for exactly 15.002s (the old outer timeout's bound
        // to the millisecond) before failing, meaning the underlying call hung and no retry ever
        // actually happened. lib/load-retry.ts's own comment on withTimeout documents exactly
        // this failure mode.
        const items = await retryAsync(
          () =>
            withTimeout(
              fetchProjects(user?.uid, preferredCompanyIds, { lightweight: true }),
              7000,
              "Projects load timed out",
            ),
          {
            attempts: 2,
            delayMs: 350,
            // Retry a first-attempt empty result unconditionally now, not just when
            // preferredCompanyIds was non-empty — a genuinely fresh device/session (nothing
            // cached in localStorage yet, membership resolution itself still succeeded) is
            // exactly the case most likely to hit a cold-start hiccup in fetchProjects' own
            // company-lookup fallback chain, and it deserves the same one extra chance a
            // returning user with a cached company hint already got.
            shouldRetryResult: (value, attempt) =>
              attempt === 1 &&
              Array.isArray(value) &&
              value.length === 0,
          },
        );
        if (cancelled) return;
        setAllProjects(items);
        const fallbackCompanyId = String(items[0]?.companyId || "").trim();
        // Used below purely for the SEPARATE company-doc/members/status-rows fetch (stat cards,
        // staff list, status columns) — this used to fall back only to a project's own companyId,
        // never to user?.companyId (auth-context's own resolved value, already used above to help
        // find the projects themselves). So whenever localStorage had no cached company id AND
        // the projects fetch came back empty (for ANY reason — a genuinely new company, or any of
        // the cold-start hiccups fixed elsewhere this session), this whole second fetch silently
        // got skipped entirely (see the `companyId ? ... : null` branch below), even though a
        // perfectly good companyId was sitting right there on `user`. That's what left every stat
        // card, the staff list, and the status columns empty while the app otherwise looked like
        // it had loaded fine.
        const companyId = storedCompanyId || fallbackCompanyId || String(user?.companyId || "").trim();
        const creatorUids = items.map((row) => String(row.createdByUid || "").trim()).filter(Boolean);
        const assignedUids = items.map((row) => String(row.assignedToUid || "").trim()).filter(Boolean);
        // The user-color lookup and the company doc/members lookup are both derived from `items`
        // alone (not from each other's results), so they were an avoidable extra sequential round
        // trip — run them concurrently instead.
        // Same withTimeout-inside-retryAsync composition as the projects fetch above, and for the
        // identical reason — see that call's own comment.
        const userColorMapPromise = retryAsync(
          () =>
            withTimeout(
              fetchUserColorMapByUids([...creatorUids, ...assignedUids], companyId),
              7000,
              "User color lookup timed out",
            ),
          { attempts: 2, delayMs: 250 },
        );
        const companyDataPromise = companyId
          ? retryAsync(
              () =>
                withTimeout(
                  Promise.all([fetchCompanyDoc(companyId), fetchCompanyMembers(companyId)]),
                  7000,
                  "Company data load timed out",
                ),
              { attempts: 2, delayMs: 250 },
            )
          : null;
        const [userColorMap, companyBundle] = await Promise.all([userColorMapPromise, companyDataPromise]);
        if (cancelled) return;
        setCreatorColorByUid(userColorMap);
        if (companyId && companyBundle) {
          const [companyDoc, members] = companyBundle;
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
      String(access.role || user?.role || "").trim().toLowerCase() || "staff",
      "general",
      user?.uid,
      access.permissionKeys.length ? access.permissionKeys : user?.permissions ?? [],
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
    const previousSubStageId = String((project as unknown as Record<string, unknown>).dashboardSubStageId ?? "");
    // A card entering a column with sub-stages lands in whichever one is marked "Default" in
    // Company Settings — not "Other" — so it's immediately triaged; a column with none marked
    // default (or none configured at all) just clears to "".
    const destinationStatusRow = statusRows.find((row) => row.name.trim().toLowerCase() === nextStatus.trim().toLowerCase());
    const nextSubStageId = destinationStatusRow?.subStages?.find((sub) => sub.isDefault)?.name ?? "";
    setStatusUpdatingProjectId(project.id);
    // Optimistic: drop the card straight into its new column instead of waiting on the write to
    // resolve first — the round-trip is what made a drop feel like it "took a while" to land.
    setAllProjects((prev) =>
      prev.map((row) =>
        row.id === project.id
          ? ({ ...row, statusLabel: nextStatus, dashboardSubStageId: nextSubStageId, updatedAt: new Date().toISOString() } as Project)
          : row,
      ),
    );
    setStatusMenuProjectId("");
    setStatusMenuPos(null);
    const ok = await updateProjectStatus(project, nextStatus, nextSubStageId);
    if (!ok) {
      // Persist failed — put it back where it actually is.
      setAllProjects((prev) =>
        prev.map((row) =>
          row.id === project.id ? ({ ...row, statusLabel: previousStatus, dashboardSubStageId: previousSubStageId } as Project) : row,
        ),
      );
    }
    setStatusUpdatingProjectId("");
  };

  // Sibling of onSelectProjectStatus, same optimistic-before-write/revert-on-failure shape, but
  // writes the independent dashboardSubStageId field via the generic updateProjectPatch helper
  // instead — this NEVER touches statusLabel/status, so the card never moves on the main board.
  // subStageName === "" is a valid target (the sub-board's own "Other" column).
  const onSelectProjectSubStage = async (project: Project, subStageName: string) => {
    if (subStageUpdatingProjectId || !canEditProjectFromDashboard(project)) return;
    const previousSubStage = String((project as unknown as Record<string, unknown>).dashboardSubStageId ?? "");
    setSubStageUpdatingProjectId(project.id);
    setAllProjects((prev) =>
      prev.map((row) =>
        row.id === project.id
          ? ({ ...row, dashboardSubStageId: subStageName, updatedAt: new Date().toISOString() } as Project)
          : row,
      ),
    );
    const ok = await updateProjectPatch(project, { dashboardSubStageId: subStageName });
    if (!ok) {
      setAllProjects((prev) =>
        prev.map((row) => (row.id === project.id ? ({ ...row, dashboardSubStageId: previousSubStage } as Project) : row)),
      );
    }
    setSubStageUpdatingProjectId("");
  };

  // Captures the clicked column's exact on-screen box + color as the "shatter" animation's
  // origin — the actual piece-splitting/measuring happens in the "opening" effect below (after
  // subBoardColumns, which it needs to know each target sub-column's own color), once the real
  // (invisible) sub-board content has mounted and laid out.
  const onOpenSubBoardColumn = (column: { name: string; color: string }, e: ReactMouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setSubBoardZoomOrigin({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, color: column.color });
    setSubBoardZoomPhase("opening");
    setOpenSubBoardColumnName(column.name);
  };

  const onCloseSubBoard = () => {
    if (!subBoardZoomOrigin) {
      // No origin to animate from — reached when a sub-board was restored directly into "revealed"
      // on page load (see the localStorage hydration effect below), never actually opened via a
      // click this session. Just leave instantly, no shatter animation; also reset phase back to
      // "idle" (not just the open column name), since main board's own render condition excludes
      // "revealed" — leaving phase stuck there would blank out both boards until the next open.
      setOpenSubBoardColumnName("");
      setSubBoardZoomPhase("idle");
      return;
    }
    // Measure the real sub-columns' current on-screen boxes NOW, while they're still the DOM the
    // underlying board content shows — the render this triggers swaps that content back to the
    // main columns in the same pass, so querying for them again inside an effect afterward would
    // find the wrong (main-board) elements instead.
    const container = boardScrollContainerRef.current;
    const rects = container
      ? Array.from(container.querySelectorAll<HTMLElement>("[data-board-column]")).map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        })
      : [];
    setSubBoardZoomCloseStartRects(rects);
    setMainBoardFadeIn(false);
    setSubBoardZoomPhase("closing");
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
    if (!isMobileQuickFilterOpen) return;

    const closeMenu = () => {
      setIsMobileQuickFilterOpen(false);
      setMobileQuickFilterPos(null);
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-quick-filter-menu='true']")) return;
      if (target.closest("[data-quick-filter-trigger='true']")) return;
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
  }, [isMobileQuickFilterOpen]);

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
    // Board view has no Active/Completed filter pills of its own (its columns already separate
    // complete from active by status) — quickFilter only applies in list view, otherwise
    // switching views could silently hide an entire column with no visible way to bring it back.
    const applyQuickFilter = dashboardViewMode !== "board";
    let rows = allProjects.filter((project) => {
      const statusLabel = String(project.statusLabel || "New");

      if (applyQuickFilter && quickFilter === "active" && isCompletedStatus(statusLabel)) {
        return false;
      }
      if (applyQuickFilter && quickFilter === "completed" && !isCompletedStatus(statusLabel)) {
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
  }, [allProjects, dashboardViewMode, quickFilter, search]);
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
    const columns = statusRows.map((row) => ({ name: row.name, color: row.color, subStages: row.subStages ?? [], projects: [] as Project[] }));
    const byKey = new Map(columns.map((col) => [col.name.trim().toLowerCase(), col]));
    const otherProjects: Project[] = [];
    for (const project of filtered) {
      const col = byKey.get(String(project.statusLabel || "New").trim().toLowerCase());
      if (col) col.projects.push(project);
      else otherProjects.push(project);
    }
    return { columns, otherProjects };
  }, [filtered, statusRows]);

  // Sub-board: sub-stage columns for whichever main column is currently drilled into (empty when
  // none is open). Sourced from that column's already search/quick-filter-scoped `projects` list,
  // so the sub-board automatically inherits the main board's current search/filter. Each
  // sub-column carries its own configured color. No catch-all "Other" bucket — a card whose stored
  // dashboardSubStageId doesn't match any currently-configured sub-stage (not yet assigned, or its
  // sub-stage was renamed/deleted since) simply doesn't appear in the sub-board; it's untouched and
  // still fully visible on the main board under its real status, just not sorted into any of these
  // sub-columns until it's (re-)assigned one.
  const subBoardColumns = useMemo(() => {
    if (!openSubBoardColumnName) {
      return { columns: [] as Array<{ name: string; color: string; projects: Project[] }> };
    }
    const parent = dashboardStatusBoardColumns.columns.find((c) => c.name === openSubBoardColumnName);
    if (!parent) {
      return { columns: [] as Array<{ name: string; color: string; projects: Project[] }> };
    }
    const columns = parent.subStages.map((s) => ({ name: s.name, color: s.color, projects: [] as Project[] }));
    const byKey = new Map(columns.map((c) => [c.name.trim().toLowerCase(), c]));
    for (const project of parent.projects) {
      const key = String((project as unknown as Record<string, unknown>).dashboardSubStageId ?? "").trim().toLowerCase();
      const col = key ? byKey.get(key) : undefined;
      col?.projects.push(project);
    }
    return { columns };
  }, [dashboardStatusBoardColumns, openSubBoardColumnName]);

  const SUB_BOARD_ZOOM_MOVE_MS = 420;
  const SUB_BOARD_ZOOM_FADE_MS = 150;
  // Deliberately much shorter than SUB_BOARD_ZOOM_MOVE_MS: on close, the main board (the "parent
  // folder") should already be fully visible well before the pieces finish their return trip, so
  // the pieces read as flying INTO an already-solid destination, not appearing in lockstep with it.
  const SUB_BOARD_MAIN_FADE_IN_MS = 180;
  // Shared by both opening and closing moves. Includes `opacity` for closing's fade-away-as-it-
  // shrinks — harmless for opening, which keeps opacity at a constant 1 throughout its own move (a
  // transitioned property that never actually changes value doesn't animate).
  const subBoardZoomMoveTransition = `left ${SUB_BOARD_ZOOM_MOVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), top ${SUB_BOARD_ZOOM_MOVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), width ${SUB_BOARD_ZOOM_MOVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), height ${SUB_BOARD_ZOOM_MOVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), background-color ${SUB_BOARD_ZOOM_MOVE_MS}ms ease, opacity ${SUB_BOARD_ZOOM_MOVE_MS}ms ease`;

  // One target {name, color, projects} per eventual piece, in the SAME order the piece divs
  // render (one per configured sub-stage) — shared by the opening and closing effects below, and
  // by the pieces' own JSX so each one can show its target column's real header/cards while it
  // animates, not just a blank color block.
  const subBoardZoomTargetInfo = useMemo(
    () => subBoardColumns.columns.map((c) => ({ name: c.name, color: c.color, projects: c.projects })),
    [subBoardColumns],
  );

  // Phase "opening": split the origin column into N even vertical slices (N = subBoardZoomTargetInfo.length),
  // snap each piece to its own slice at the origin color (instant), then animate every piece
  // simultaneously to its real sub-column's actual on-screen box — measured now, while that real
  // content is mounted+laid-out but still invisible — and that column's own color. The shatter.
  useLayoutEffect(() => {
    if (subBoardZoomPhase !== "opening") return;
    const measureEl = subBoardOverlayRef.current;
    const n = subBoardZoomTargetInfo.length;
    const pieces = subBoardZoomPieceRefs.current.slice(0, n);
    if (!measureEl || !subBoardZoomOrigin || n === 0 || pieces.length !== n || pieces.some((p) => !p)) {
      setSubBoardZoomPhase("landed");
      return;
    }
    const realColumnEls = Array.from(measureEl.querySelectorAll<HTMLElement>("[data-board-column]"));
    if (realColumnEls.length !== n) {
      setSubBoardZoomPhase("landed");
      return;
    }
    const sliceWidth = subBoardZoomOrigin.width / n;
    const originBg = hexToRgba(subBoardZoomOrigin.color, 0.85);
    pieces.forEach((piece, i) => {
      if (!piece) return;
      piece.style.transition = "none";
      piece.style.left = `${subBoardZoomOrigin.left + i * sliceWidth}px`;
      piece.style.top = `${subBoardZoomOrigin.top}px`;
      piece.style.width = `${sliceWidth}px`;
      piece.style.height = `${subBoardZoomOrigin.height}px`;
      piece.style.backgroundColor = originBg;
      piece.style.opacity = "1";
    });
    void pieces[0]!.offsetWidth;
    pieces.forEach((piece, i) => {
      if (!piece) return;
      const targetRect = realColumnEls[i].getBoundingClientRect();
      piece.style.transition = subBoardZoomMoveTransition;
      piece.style.left = `${targetRect.left}px`;
      piece.style.top = `${targetRect.top}px`;
      piece.style.width = `${targetRect.width}px`;
      piece.style.height = `${targetRect.height}px`;
      piece.style.backgroundColor = hexToRgba(subBoardZoomTargetInfo[i]?.color ?? subBoardZoomOrigin.color, 0.85);
    });
    const firstPiece = pieces[0];
    const onDone = () => setSubBoardZoomPhase("landed");
    firstPiece?.addEventListener("transitionend", onDone, { once: true });
    return () => firstPiece?.removeEventListener("transitionend", onDone);
  }, [subBoardZoomPhase, subBoardZoomOrigin, subBoardZoomTargetInfo, subBoardZoomMoveTransition]);

  // Phase "landed": pieces now exactly overlay the real sub-board columns, which are fading in
  // underneath them as the pieces fade out on top (see the render below — both are computed
  // directly from phase on already-mounted elements, so they start in the same commit, no skew).
  // "revealed" normally begins via the sub-board overlay's own onTransitionEnd once that fade-in
  // has ACTUALLY finished — this timeout is only a backstop (a chunk of extra margin past the
  // nominal fade duration) in case transitionend never fires (reduced-motion settings disabling
  // the transition entirely, the element getting interrupted, etc.).
  useEffect(() => {
    if (subBoardZoomPhase !== "landed") return;
    const timeout = window.setTimeout(() => setSubBoardZoomPhase("revealed"), SUB_BOARD_ZOOM_FADE_MS + 200);
    return () => window.clearTimeout(timeout);
  }, [subBoardZoomPhase, SUB_BOARD_ZOOM_FADE_MS]);

  // Phase "closing": snap each piece to its real sub-column's box + color as measured eagerly by
  // onCloseSubBoard (not re-queried here — by this point the underlying content has already
  // swapped back to the main columns, so the sub-board's own elements are gone), then animate all
  // pieces simultaneously back into the origin column's N even slices + its color — the exact
  // reverse of opening. Once done, actually leave the sub-board.
  useLayoutEffect(() => {
    if (subBoardZoomPhase !== "closing") return;
    const n = subBoardZoomTargetInfo.length;
    const pieces = subBoardZoomPieceRefs.current.slice(0, n);
    const startRects = subBoardZoomCloseStartRects;
    if (!subBoardZoomOrigin || !startRects || n === 0 || pieces.length !== n || pieces.some((p) => !p) || startRects.length !== n) {
      setOpenSubBoardColumnName("");
      setSubBoardZoomPhase("idle");
      setSubBoardZoomOrigin(null);
      setSubBoardZoomCloseStartRects(null);
      return;
    }
    const sliceWidth = subBoardZoomOrigin.width / n;
    pieces.forEach((piece, i) => {
      if (!piece) return;
      const startRect = startRects[i];
      piece.style.transition = "none";
      piece.style.left = `${startRect.left}px`;
      piece.style.top = `${startRect.top}px`;
      piece.style.width = `${startRect.width}px`;
      piece.style.height = `${startRect.height}px`;
      piece.style.backgroundColor = hexToRgba(subBoardZoomTargetInfo[i]?.color ?? subBoardZoomOrigin.color, 0.85);
      piece.style.opacity = "1";
    });
    void pieces[0]!.offsetWidth;
    const originBg = hexToRgba(subBoardZoomOrigin.color, 0.85);
    pieces.forEach((piece, i) => {
      if (!piece) return;
      piece.style.transition = subBoardZoomMoveTransition;
      piece.style.left = `${subBoardZoomOrigin.left + i * sliceWidth}px`;
      piece.style.top = `${subBoardZoomOrigin.top}px`;
      piece.style.width = `${sliceWidth}px`;
      piece.style.height = `${subBoardZoomOrigin.height}px`;
      piece.style.backgroundColor = originBg;
      // Fades away DURING the shrink back into the parent column, rather than staying solid the
      // whole way and only disappearing once it arrives.
      piece.style.opacity = "0";
    });
    const firstPiece = pieces[0];
    const onDone = () => {
      setOpenSubBoardColumnName("");
      setSubBoardZoomPhase("idle");
      setSubBoardZoomOrigin(null);
      setSubBoardZoomCloseStartRects(null);
    };
    firstPiece?.addEventListener("transitionend", onDone, { once: true });
    return () => firstPiece?.removeEventListener("transitionend", onDone);
  }, [subBoardZoomPhase, subBoardZoomOrigin, subBoardZoomTargetInfo, subBoardZoomMoveTransition, subBoardZoomCloseStartRects]);

  // One paint after "closing" begins (the main board's own first render at opacity 0 having
  // already committed), flip to opacity 1 so the fade-in is a real transition, not a pop. This is
  // still the mount-then-flip pattern (not a direct phase computation) because the main board's
  // wrapper genuinely, freshly remounts at "closing" — it was fully unmounted throughout "revealed".
  useEffect(() => {
    if (subBoardZoomPhase !== "closing") return;
    setMainBoardFadeIn(true);
  }, [subBoardZoomPhase]);

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

  // Sub-board drag handlers — same shape as the main board's own trio above, reusing the SAME
  // projectBoardDragGhost controller/layer (only one drag is ever in flight at a time). A distinct
  // spawn id ("project-substage-board-name-") is required: the project's main-board card is still
  // mounted underneath the sub-board modal (its status never changes when its sub-stage does), so
  // reusing the main board's id would collide.
  const onSubStageCardDragStart = (event: ReactDragEvent<HTMLDivElement>, project: Project) => {
    if (!canEditProjectFromDashboard(project)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", project.id);
    event.dataTransfer.effectAllowed = "move";
    setDraggingSubStageProjectId(project.id);
    if (projectBoardDragGhost.transparentImageRef.current) {
      event.dataTransfer.setDragImage(projectBoardDragGhost.transparentImageRef.current, 0, 0);
    }
    const color = String(projectStatusPillStyle(project.statusLabel || "New").backgroundColor || "");
    projectBoardDragGhost.spawn(event, `project-substage-board-name-${project.id}`, { label: project.name, color });
  };

  const onSubStageCardDragEnd = () => {
    setDraggingSubStageProjectId("");
    setDragOverSubStageColumn("");
    projectBoardDragGhost.end();
  };

  const onSubStageColumnDrop = (event: ReactDragEvent<HTMLElement>, subStageKey: string) => {
    event.preventDefault();
    setDragOverSubStageColumn("");
    const projectId = event.dataTransfer.getData("text/plain") || draggingSubStageProjectId;
    setDraggingSubStageProjectId("");
    projectBoardDragGhost.end();
    const project = allProjects.find((row) => row.id === projectId);
    if (!project) return;
    const nextSubStage = subStageKey;
    const currentSubStage = String((project as unknown as Record<string, unknown>).dashboardSubStageId ?? "").trim().toLowerCase();
    if (currentSubStage === nextSubStage.trim().toLowerCase()) return;
    void onSelectProjectSubStage(project, nextSubStage);
  };

  const renderProjectBoardCard = (
    project: Project,
    accentColor: string,
    cardOptions?: {
      idPrefix?: string;
      onCardDragStart?: (e: ReactDragEvent<HTMLDivElement>, project: Project) => void;
      onCardDragEnd?: () => void;
      isDragging?: boolean;
    },
  ) => {
    const canEdit = canEditProjectFromDashboard(project);
    const displayAssigned = assignedDisplayName(project);
    const cardBg = isDarkMode ? darkenHexColor(accentColor, 0.75) : lightenHexColor(accentColor, 0.82);
    const cardBorder = isDarkMode ? darkenHexColor(accentColor, 0.4) : lightenHexColor(accentColor, 0.5);
    const cardText = isDarkMode ? dashboardPalette.text : "#000000";
    const chipBg = isDarkMode ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)";
    const idPrefix = cardOptions?.idPrefix ?? "project-board-name-";
    const handleDragStart = cardOptions?.onCardDragStart ?? onProjectBoardCardDragStart;
    const handleDragEnd = cardOptions?.onCardDragEnd ?? onProjectBoardCardDragEnd;
    const isDragging = cardOptions?.isDragging ?? draggingProjectId === project.id;
    return (
      <div
        key={project.id}
        id={`${idPrefix}${project.id}`}
        draggable={canEdit}
        onDragStart={(e) => handleDragStart(e, project)}
        onDragEnd={handleDragEnd}
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
          opacity: isDragging ? 0.4 : 1,
          cursor: isDragging ? "grabbing" : "pointer",
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

  // Shared expanded-column shell (glass background, header, card list, drag-handler wiring) —
  // used by both the main board's regular (non-collapsed) status columns and every sub-board
  // column (including its own droppable "Other" bucket). The main board's COLLAPSED-column case
  // and its own grey "Other" bucket stay bespoke below (neither applies to the sub-board).
  const renderBoardColumn = (options: {
    columnKey: string;
    color: string;
    count: number;
    projects: Project[];
    isDragOver: boolean;
    dragHandlers: {
      onDragOver: (e: ReactDragEvent<HTMLElement>) => void;
      onDragLeave: (e: ReactDragEvent<HTMLElement>) => void;
      onDrop: (e: ReactDragEvent<HTMLElement>) => void;
    };
    renderCard: (project: Project) => React.ReactNode;
    renderHeader: (badgeBg: string, badgeText: string) => React.ReactNode;
    emptyLabel?: string;
  }) => {
    const glassColumnBg = hexToRgba(options.color, 0.85);
    const glassColumnBorder = "rgba(255,255,255,0.3)";
    const glassColumnSurface: React.CSSProperties = {
      backgroundColor: glassColumnBg,
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
    };
    const glassColumnShadow = options.isDragOver
      ? "0 0 0 3px rgba(255,255,255,0.85), inset 0 1px 0 rgba(255,255,255,0.7)"
      : "inset 0 1px 0 rgba(255,255,255,0.7), inset 0 30px 40px -32px rgba(255,255,255,0.35), var(--shadow-glass)";
    const columnBadgeBg = isDarkMode ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)";
    const columnBadgeText = isDarkMode ? dashboardPalette.text : "#000000";
    return (
      // See the main board's collapsed-column case for why the shadow and reveal height sit on
      // this outer shell rather than on the column div below.
      <div
        key={options.columnKey}
        {...options.dragHandlers}
        data-board-column="true"
        className="h-full w-[85vw] max-w-[300px] shrink-0 snap-center sm:w-[280px] sm:max-w-none sm:snap-align-none"
        style={{ borderRadius: 16, boxShadow: glassColumnShadow }}
      >
        <div
          className="flex h-full w-full flex-col overflow-hidden rounded-[16px] border transition"
          style={{ borderColor: glassColumnBorder, ...glassColumnSurface }}
        >
          {options.renderHeader(columnBadgeBg, columnBadgeText)}
          {/* touchAction pan-y: this list only ever scrolls vertically — telling the browser that
              explicitly means a touch that starts here but moves horizontally is handed to the
              board's own horizontal scroller right away, instead of this column's native vertical
              scroll capturing the whole gesture first (the classic nested-perpendicular-scroll
              trap, worse the further a column's already been scrolled from its own edges). */}
          <div className="glass-scroll board-column-scroll flex-1 space-y-2.5 overflow-y-hidden p-2.5" style={{ scrollbarWidth: "none", touchAction: "pan-y" }}>
            {options.projects.length === 0 ? (
              <p className="px-1 py-6 text-center text-[11px] font-semibold" style={{ color: "#000000" }}>{options.emptyLabel ?? "No projects."}</p>
            ) : (
              options.projects.map((project) => options.renderCard(project))
            )}
          </div>
        </div>
      </div>
    );
  };

  // Shared column-header row (name/left slot + count badge + collapse button) — used by both the
  // main board's regular columns and every sub-board column (including its own "Other" bucket), so
  // both get the exact same collapse affordance/styling from one place.
  const renderColumnHeaderBar = (options: {
    left: React.ReactNode;
    count: number;
    badgeBg: string;
    badgeText: string;
    onCollapse: () => void;
    collapseTitle: string;
  }) => (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: "rgba(0,0,0,0.15)" }}>
      {options.left}
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-2 text-[10px] font-bold"
          style={{ color: options.badgeText, backgroundColor: options.badgeBg }}
        >
          {options.count}
        </span>
        <button
          type="button"
          onClick={options.onCollapse}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full transition hover:brightness-95"
          style={{ color: options.badgeText, backgroundColor: options.badgeBg }}
          title={options.collapseTitle}
          aria-label={options.collapseTitle}
        >
          <ChevronsRightLeft size={13} />
        </button>
      </div>
    </div>
  );

  // Shared collapsed-column shell — the narrow, vertical-text strip a column becomes once collapsed
  // (via renderColumnHeaderBar's own collapse button above). Used by both the main board's regular
  // columns and every sub-board column, so collapsing behaves identically in both places.
  const renderCollapsedBoardColumn = (options: {
    columnKey: string;
    color: string;
    count: number;
    name: string;
    isDragOver: boolean;
    dragHandlers: {
      onDragOver: (e: ReactDragEvent<HTMLElement>) => void;
      onDragLeave: (e: ReactDragEvent<HTMLElement>) => void;
      onDrop: (e: ReactDragEvent<HTMLElement>) => void;
    };
    onExpand: () => void;
  }) => {
    const glassColumnBorder = "rgba(255,255,255,0.3)";
    const glassColumnSurface: React.CSSProperties = {
      backgroundColor: hexToRgba(options.color, 0.85),
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
    };
    const glassColumnShadow = options.isDragOver
      ? "0 0 0 3px rgba(255,255,255,0.85), inset 0 1px 0 rgba(255,255,255,0.7)"
      : "inset 0 1px 0 rgba(255,255,255,0.7), inset 0 30px 40px -32px rgba(255,255,255,0.35), var(--shadow-glass)";
    const columnBadgeBg = isDarkMode ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)";
    const columnBadgeText = isDarkMode ? dashboardPalette.text : "#000000";
    return (
      // Shadow AND the scroll-reveal height live on this outer shell (not the button below) — the
      // shadow always renders around whatever size the outer currently is, so setting the height
      // here (rather than clip-path-ing the button) keeps it continuously in sync with the reveal
      // instead of needing to be a separate unclipped layer.
      <div
        key={options.columnKey}
        {...options.dragHandlers}
        data-board-column="true"
        className="h-full w-[52px] shrink-0 snap-center sm:snap-align-none"
        style={{ borderRadius: 16, boxShadow: glassColumnShadow }}
      >
        <button
          type="button"
          onClick={options.onExpand}
          className="flex h-full w-full flex-col items-center gap-3 overflow-hidden rounded-[16px] border pb-3 pt-2.5 transition hover:brightness-105"
          style={{ borderColor: glassColumnBorder, ...glassColumnSurface }}
          title={`Expand ${options.name}`}
          aria-label={`Expand ${options.name}`}
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
            {options.count}
          </span>
          <span
            className="shrink-0 whitespace-nowrap text-[14px] font-normal"
            style={{ writingMode: "vertical-rl", color: "#000000", letterSpacing: "0.12em" }}
          >
            {options.name}
          </span>
        </button>
      </div>
    );
  };

  // Qualifies a sub-column's collapse-state key with its parent main column's name — see
  // collapsedSubStageColumns' own declaration above for why (avoids collisions between two main
  // columns that happen to share an identically-named sub-stage, or either one's own "Other").
  const subStageCollapseKey = (subColKey: string) => `${openSubBoardColumnName}::${subColKey}`;

  // The sub-board's own columns (configured sub-stages + trailing "Other") — used by
  // subBoardOverlayRef's single continuously-mounted element (see its declaration above), which
  // serves as an invisible measurement source during "opening" (so the shatter pieces have real
  // on-screen boxes to fly to, while the main board stays the visible content underneath) and then
  // as the real, interactive board once revealed. Each column can be collapsed via
  // renderColumnHeaderBar's collapse button, exactly like the main board's own columns. No trailing
  // "Other" bucket — only the sub-stages actually configured for this main column are shown.
  const renderSubBoardColumnsContent = () => {
    const columns = subBoardColumns.columns.map((subCol) => ({
      key: subCol.name,
      name: subCol.name,
      color: subCol.color,
      projects: subCol.projects,
    }));
    return (
      <>
        {columns.map((col) => {
          const isDragOver = dragOverSubStageColumn === col.key;
          const collapseKey = subStageCollapseKey(col.key);
          const isCollapsed = Boolean(collapsedSubStageColumns[collapseKey]);
          const dragHandlers = {
            onDragOver: (e: ReactDragEvent<HTMLElement>) => {
              e.preventDefault();
              if (dragOverSubStageColumn !== col.key) setDragOverSubStageColumn(col.key);
            },
            onDragLeave: (e: ReactDragEvent<HTMLElement>) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setDragOverSubStageColumn((prev) => (prev === col.key ? "" : prev));
            },
            onDrop: (e: ReactDragEvent<HTMLElement>) => onSubStageColumnDrop(e, col.key),
          };
          if (isCollapsed) {
            return renderCollapsedBoardColumn({
              columnKey: col.key,
              color: col.color,
              count: col.projects.length,
              name: col.name,
              isDragOver,
              dragHandlers,
              onExpand: () => setCollapsedSubStageColumns((prev) => ({ ...prev, [collapseKey]: false })),
            });
          }
          return renderBoardColumn({
            columnKey: col.key,
            color: col.color,
            count: col.projects.length,
            projects: col.projects,
            isDragOver,
            dragHandlers,
            renderCard: (project) =>
              renderProjectBoardCard(project, col.color, {
                idPrefix: "project-substage-board-name-",
                onCardDragStart: onSubStageCardDragStart,
                onCardDragEnd: onSubStageCardDragEnd,
                isDragging: draggingSubStageProjectId === project.id,
              }),
            renderHeader: (badgeBg, badgeText) =>
              renderColumnHeaderBar({
                left: <p className="truncate text-[13px] font-semibold" style={{ color: "#000000" }}>{col.name}</p>,
                count: col.projects.length,
                badgeBg,
                badgeText,
                onCollapse: () => setCollapsedSubStageColumns((prev) => ({ ...prev, [collapseKey]: true })),
                collapseTitle: `Collapse ${col.name}`,
              }),
          });
        })}
      </>
    );
  };

  // The main board's own columns (loading/empty states, one per configured status, plus the
  // trailing "Other" bucket) — factored out the same way as renderSubBoardColumnsContent so it can
  // be rendered in the normal, interactive slot AND (non-interactively, fading out) as an overlay
  // during the "landed" crossfade below.
  const renderMainBoardColumnsContent = () => (
    <>
      {(showProjectsLoadingState || !statusRowsLoaded) && (
        <div className="flex h-full w-full items-center justify-center gap-2 text-[13px] font-semibold" style={{ color: dashboardPalette.textMuted }}>
          Loading projects...
          <div
            className="h-4 w-4 animate-spin rounded-full border-[2px] border-[var(--glass-border)] border-t-[var(--brand-strong)]"
            role="status"
            aria-label="Loading"
          />
        </div>
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
        if (isCollapsed) {
          return renderCollapsedBoardColumn({
            columnKey: column.name,
            color: column.color,
            count: column.projects.length,
            name: column.name,
            isDragOver,
            dragHandlers,
            onExpand: () => setCollapsedProjectStatusColumns((prev) => ({ ...prev, [column.name]: false })),
          });
        }
        return (
          renderBoardColumn({
            columnKey: column.name,
            color: column.color,
            count: column.projects.length,
            projects: column.projects,
            isDragOver,
            dragHandlers,
            renderCard: (project) => renderProjectBoardCard(project, column.color),
            renderHeader: (badgeBg, badgeText) =>
              renderColumnHeaderBar({
                left:
                  column.subStages.length > 0 ? (
                    <button
                      type="button"
                      onClick={(e) => onOpenSubBoardColumn(column, e)}
                      className="flex min-w-0 items-center gap-1 text-left hover:underline"
                      title={`Open ${column.subStages.length} sub-stage${column.subStages.length === 1 ? "" : "s"}`}
                    >
                      <span className="truncate text-[13px] font-semibold" style={{ color: "#000000" }}>{column.name}</span>
                      <ChevronRight size={13} className="shrink-0" style={{ color: "#000000" }} />
                    </button>
                  ) : (
                    <p className="truncate text-[13px] font-semibold" style={{ color: "#000000" }}>{column.name}</p>
                  ),
                count: column.projects.length,
                badgeBg,
                badgeText,
                onCollapse: () => setCollapsedProjectStatusColumns((prev) => ({ ...prev, [column.name]: true })),
                collapseTitle: `Collapse ${column.name}`,
              }),
          })
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
            <div className="glass-scroll board-column-scroll flex-1 space-y-2.5 overflow-y-hidden p-2.5" style={{ scrollbarWidth: "none", touchAction: "pan-y" }}>
              {dashboardStatusBoardColumns.otherProjects.map((project) => renderProjectBoardCard(project, "#64748B"))}
            </div>
          </div>
        </div>
      )}
    </>
  );

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
          {access.status === "loading" ? (
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
          ) : access.status === "error" ? (
            <div
              className="rounded-[14px] p-6 text-[13px] font-semibold"
              style={{
                border: `1px solid ${dashboardPalette.border}`,
                backgroundColor: dashboardPalette.panelBg,
                color: dashboardPalette.textSoft,
                boxShadow: dashboardPalette.strongShadow,
              }}
            >
              <p>Couldn&apos;t check your access to the dashboard — the connection may be slow or offline.</p>
              <button
                type="button"
                onClick={() => access.retry()}
                className="mt-3 inline-flex h-9 items-center rounded-[8px] border px-3 text-[12px] font-bold hover:brightness-95"
                style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelBg, color: dashboardPalette.textSoft }}
              >
                Retry
              </button>
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
          {/* Negative margin on the TOP only cancels <main>'s own py at each breakpoint, so
              whatever renders first here — the stat cards or, when they're hidden, the toolbar
              below — starts flush with <main>'s true top edge instead of doubling up with
              whatever top padding it carries on its own. No horizontal (-mx) counterpart —
              <main>'s own px is already "matching the sides" by definition, so this and
              everything below it deliberately just sits inside that padding rather than bleeding
              past it and re-insetting by a separately-chosen number, which had twice produced a
              mismatch (padding not actually matching the sides, in one case landing flush against
              the desktop sidebar with a lg:-mx-5 that exactly canceled <main>'s lg:px-5). */}
          <div className="-mt-3 space-y-0 md:-mt-4 lg:-mt-4">

          {dashboardStatCardsEnabled && (
          <div className="relative z-0" style={{ paddingTop: 16, paddingBottom: 16 }}>
            <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
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
                    className={`rounded-[18px] border px-3 py-2.5 sm:px-5 sm:py-4 ${
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
                    <div className="flex items-center gap-2 sm:mb-3 sm:gap-2.5">
                      <div
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-[0_4px_10px_rgba(0,0,0,0.14)] sm:h-9 sm:w-9"
                        style={{ backgroundImage: `linear-gradient(135deg, ${card.iconFrom} 0%, ${card.iconTo} 100%)` }}
                      >
                        <Icon size={15} strokeWidth={2.4} />
                      </div>
                      <p className="min-w-0 truncate text-[12px] font-semibold sm:text-[13px] sm:text-[14px]" style={{ color: dashboardPalette.textSoft }}>{card.label}</p>
                      <p className="ml-auto shrink-0 text-[18px] font-bold sm:hidden" style={{ color: dashboardPalette.text }}>{value}</p>
                    </div>
                    <p className="hidden text-[32px] font-semibold leading-none sm:block sm:text-[38px] lg:text-[42px]" style={{ color: dashboardPalette.text }}>{value}</p>
                    {stats.weekly[card.key] > 0 && (
                      <p className="hidden pt-1 text-[13px] font-bold sm:block" style={{ color: "#2A7A3B" }}>
                        + {stats.weekly[card.key]} this week
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* Toolbar lives OUTSIDE the sticky panel below so it scrolls away with the stat
              cards on mobile — otherwise the board columns can never reach the top of the
              viewport, since the toolbar's own height would always sit above them inside the
              stuck panel. */}
          <div
            className={`relative z-10 -mx-3 border-t px-[10px] pb-3 md:-mx-4 lg:-mx-5 ${dashboardStatCardsEnabled ? "pt-[19px]" : "pt-0"} ${dashboardViewMode === "board" ? "border-b" : ""}`}
            style={{
              borderColor: "var(--glass-border)",
              backgroundColor: dashboardPalette.panelMuted,
              // -mx-3/md:-mx-4/lg:-mx-5 exactly cancels <main>'s own px at each breakpoint, so this
              // bar touches the true left/right edge everywhere — the true viewport edge on mobile,
              // and <main>'s edge (flush against the 240px sidebar) on desktop. The inner px-[10px]
              // above keeps its own buttons/search box from touching that edge directly.
            }}
          >
              <div className="relative flex flex-wrap items-center gap-2 pl-0 pr-[92px] sm:pl-[10px] sm:pr-0">
                {/* Sub-board back button — always mounted (not conditionally rendered), but
                    collapsed to zero width (and a matching negative margin that cancels out the
                    row's own gap-2) when hidden, so the search bar/toggle actually sit at their
                    normal position instead of staying permanently shifted over. Animating width
                    open reveals the button left-to-right (slides in) and pushes every sibling
                    after it — including the search bar, and the icon inside it, which moves as
                    one piece with the bar since it's positioned relative to the bar's own box. */}
                <div
                  className="shrink-0 overflow-hidden transition-[width,margin-right] duration-250 ease-out"
                  style={{
                    width: openSubBoardColumnName ? 36 : 0,
                    marginRight: openSubBoardColumnName ? 8 : -8,
                  }}
                >
                  <button
                    type="button"
                    onClick={onCloseSubBoard}
                    aria-label={`Back to board${openSubBoardColumnName ? ` (leave ${openSubBoardColumnName})` : ""}`}
                    aria-hidden={!openSubBoardColumnName}
                    tabIndex={openSubBoardColumnName ? 0 : -1}
                    title="Back"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border"
                    style={{
                      borderColor: dashboardPalette.border,
                      backgroundColor: dashboardPalette.panelBg,
                      color: dashboardPalette.text,
                    }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                </div>
                {/* Deliberately `relative` at every breakpoint (no `sm:static` reset) — the
                    Search icon below is absolutely positioned against THIS box specifically, so
                    it has to stay this element's own containing block or it detaches and pins
                    itself to the outer toolbar row instead, no longer tracking the bar as it
                    shifts (e.g. when the sub-board back button pushes it over). */}
                <div className="peer relative order-1 w-[92px] shrink-0 flex-none transition-[flex-grow,width] duration-200 focus-within:w-auto focus-within:flex-1 sm:order-none sm:w-auto sm:min-w-[260px] sm:max-w-[360px] sm:flex-none sm:focus-within:flex-none">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
                    style={{ color: dashboardPalette.textMuted }}
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search"
                    className="h-9 w-full rounded-[10px] border pl-9 pr-3 text-[12px] font-semibold outline-none transition focus:border-[var(--brand)]"
                    style={{
                      borderColor: dashboardPalette.border,
                      backgroundColor: dashboardPalette.panelBg,
                      color: dashboardPalette.inputText,
                    }}
                  />
                </div>
                {/* Desktop — the three filter pills, next to the search bar. Not shown in board
                    (column) view — its columns already separate complete from active by status,
                    so the filter has nothing meaningful left to do there. */}
                {dashboardViewMode !== "board" && (
                <div className="order-2 hidden flex-initial gap-1.5 sm:flex">
                  {QUICK_FILTER_OPTIONS.map((option) => (
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
                )}
                {/* Mobile — the pills collapse into a single icon that opens a glass dropdown
                    with the same three options, since there isn't room otherwise. Fades/slides
                    out of the way (same as it did as a button row) while the search bar is
                    focused and expanded. */}
                <div className="relative z-0 order-2 flex flex-1 translate-x-0 justify-center overflow-hidden transition-[opacity,flex-grow,transform] duration-200 peer-focus-within:pointer-events-none peer-focus-within:flex-none peer-focus-within:w-0 peer-focus-within:translate-x-6 peer-focus-within:opacity-0 sm:hidden">
                  <button
                    type="button"
                    data-quick-filter-trigger="true"
                    onClick={(e) => {
                      if (isMobileQuickFilterOpen) {
                        setIsMobileQuickFilterOpen(false);
                        setMobileQuickFilterPos(null);
                        return;
                      }
                      const rect = e.currentTarget.getBoundingClientRect();
                      const menuWidth = Math.max(140, rect.width);
                      const centeredLeft = rect.left + rect.width / 2 - menuWidth / 2;
                      setMobileQuickFilterPos({
                        left: Math.min(Math.max(8, centeredLeft), window.innerWidth - menuWidth - 8),
                        top: rect.bottom + 4,
                        width: menuWidth,
                      });
                      setIsMobileQuickFilterOpen(true);
                    }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border"
                    style={{
                      backgroundColor: quickFilter === "all" ? dashboardPalette.panelBg : undefined,
                      backgroundImage: quickFilter === "all" ? "none" : "var(--brand-gradient)",
                      borderColor: quickFilter === "all" ? dashboardPalette.border : "var(--brand)",
                    }}
                    title="Filter projects"
                    aria-label="Filter projects"
                  >
                    <ListFilter size={16} style={{ color: quickFilter === "all" ? dashboardPalette.textMuted : "#FFFFFF" }} />
                  </button>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={dashboardViewMode === "board"}
                  onClick={() => setDashboardViewMode((prev) => (prev === "list" ? "board" : "list"))}
                  className="absolute right-0 top-1/2 z-20 order-3 inline-flex h-[38px] w-[82px] -translate-y-1/2 shrink-0 items-center overflow-hidden rounded-full border p-1 sm:static sm:order-none sm:translate-y-0 sm:z-auto"
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
                {dashboardViewMode === "list" && (
                  // Hidden on mobile — infinite scroll (see the load-more-near-bottom effect
                  // further down) already reveals more projects automatically as the user
                  // scrolls, using this same pageSize as its batch size, so there's nothing left
                  // for the picker itself to do there besides take up space.
                  <div className="order-4 hidden w-full items-center gap-1.5 sm:order-none sm:ml-auto sm:flex sm:w-auto">
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
                ? // Bleeds past <main>'s own px (same -mx values as the filter bar above) so the
                  // board columns wrapper's own side padding re-insets from the TRUE edge —
                  // without this, <main>'s padding and the columns' own side padding stacked,
                  // doubling the gap instead of matching it. Top stays its own pt-[10px] (the gap
                  // from the filter bar) — deliberately NOT matched to the (bigger) side padding.
                  "sticky top-0 flex h-[calc(100svh-48px)] min-h-[280px] flex-col overflow-hidden pt-[10px] -mx-3 md:-mx-4 lg:top-[48px] lg:-mx-5 lg:h-[calc(100svh-48px)] lg:min-h-[320px]"
                : ""
            }`}
            style={{
              borderColor: "var(--glass-border)",
            }}
          >

          {dashboardViewMode === "list" && (
          // -mx-3/md:-mx-4 bleeds past <main>'s own px (this view is lg:hidden, so no lg: needed)
          // so the card grid's own px-2 below re-insets from the TRUE edge instead of stacking on
          // top of <main>'s padding — otherwise the side gap (main's px + px-2) came out much
          // bigger than the gap-2 between cards instead of matching it.
          <div className="-mx-3 md:-mx-4 lg:hidden">
                {showProjectsLoadingState && (
                  <div className="flex min-h-[60vh] items-center justify-center gap-2 text-[13px] font-semibold" style={{ color: dashboardPalette.textMuted }}>
                    Loading projects...
                    <div
                      className="h-4 w-4 animate-spin rounded-full border-[2px] border-[var(--glass-border)] border-t-[var(--brand-strong)]"
                      role="status"
                      aria-label="Loading"
                    />
                  </div>
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
                  <div className="grid grid-cols-1 gap-2 px-2 pb-2 pt-2 md:grid-cols-2">
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
                          <p className="line-clamp-2 text-[16px] font-bold" style={{ color: dashboardPalette.text }}>{project.name}</p>
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

                        {/* Desktop — tags and assigned user as their own separate rows. */}
                        <div className="mt-2 hidden flex-wrap gap-1 sm:flex">
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

                        <div className="mt-2 hidden items-center gap-2 text-[12px] sm:flex">
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

                        {/* Mobile only — tags + assigned user left-aligned, Created/Modified right-aligned, all in one row. */}
                        <div className="mt-2 flex items-start justify-between gap-2 sm:hidden">
                          <div className="flex flex-col items-start gap-1">
                            <div className="flex flex-wrap items-center gap-1">
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
                            {assignedDisplayName(project) ? (
                              <span className="flex items-center gap-1.5 text-[12px]">
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
                              </span>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-0.5 text-[11px]" style={{ color: dashboardPalette.textSoft }}>
                            <p className="flex items-center gap-1">
                              <CalendarDays size={11} className="shrink-0" style={{ color: dashboardPalette.textMuted }} />
                              <span>{dashboardDate(project.createdAt)}</span>
                            </p>
                            <p className="flex items-center gap-1">
                              <RefreshCw size={11} className="shrink-0" style={{ color: dashboardPalette.textMuted }} />
                              <span>{dashboardDate(project.updatedAt)}</span>
                            </p>
                          </div>
                        </div>

                        <div className="mt-2 hidden gap-1 text-[11px] sm:grid sm:grid-cols-2" style={{ color: dashboardPalette.textSoft }}>
                          <p className="flex items-center gap-1.5">
                            <span className="font-bold" style={{ color: dashboardPalette.textMuted }}>Created:</span>
                            <span>{dashboardDate(project.createdAt)}</span>
                          </p>
                          <p className="flex items-center gap-1.5">
                            <span className="font-bold" style={{ color: dashboardPalette.textMuted }}>Modified:</span>
                            <span>{dashboardDate(project.updatedAt)}</span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!isLoading && visibleProjects.length < filtered.length && (
                  <div className="flex items-center justify-center gap-2 px-3 py-4 text-center text-[12px] font-semibold" style={{ color: dashboardPalette.textMuted }}>
                    Loading more projects...
                    <div
                      className="h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-[var(--glass-border)] border-t-[var(--brand-strong)]"
                      role="status"
                      aria-label="Loading"
                    />
                  </div>
                )}
              </div>
          )}

          {dashboardViewMode === "board" && (
          <div
            ref={boardScrollContainerCallbackRef}
            data-horizontal-swipe-scroll="true"
            className="glass-scroll hide-native-scrollbar grid snap-x snap-mandatory overflow-x-auto overflow-y-hidden px-[10px] pb-[10px] sm:snap-none lg:px-4"
            style={{ flex: "1 1 auto", minHeight: 0, gridTemplateRows: "1fr" }}
          >
            {/* Main board vs. sub-board: both grid-stacked onto the SAME cell (gridArea: "1 / 1")
                rather than one of them being position:absolute — grid items never change `position`
                (both stay static/in-flow the whole time), so switching which one is "on top" or
                fading in/out never forces the browser to rebuild a compositing layer. That rebuild
                is exactly what caused a real, if brief, bug here: with the previous
                absolute<->static toggle on the sub-board (switched the instant it became fully
                interactive), every column's `backdrop-filter` blur had to tear down and rebuild its
                compositing layer at that exact moment, which reliably renders as one flat/transparent
                frame before recovering — i.e. the columns visibly flashing away and back right as
                the opening animation settled. Grid items paint in DOM order by default (like flex
                items), so main board (first) sits under sub board (second) with no explicit z-index
                needed. Both inherit the container's own padding/height naturally, same as any other
                grid item — no manual padding/height reconstruction required either. */}
            {/* Main board: normal-flow whenever it's the primary content — idle, opening (visible,
                unchanged, per the earlier "keep the parent column already there" fix), and closing
                (mount-then-flip fade-in via mainBoardFadeIn, since it's a genuine fresh remount
                there after being fully unmounted through "revealed"). Unmounts INSTANTLY (no fade)
                the moment "landed" begins, rather than crossfading out underneath the sub-board —
                confirmed live (logged in, watched the actual animation, not just reasoned from
                source) that a main-board fade-out here doesn't read as a clean dissolve: it briefly
                superimposes the main board's own column headers/cards over the sub-board's
                completely different ones at full readable opacity (e.g. "In Production" bleeding
                into "Dryfit" as one garbled label), which is what was being reported as a flash —
                a legibility/content problem, not a compositing or timing bug. The sub-board's own
                fade-in and the pieces' own fade-out (below) don't have this problem, because by
                "landed" they show matching content (the pieces are already sitting exactly on top
                of the real columns they preview), so THEIR crossfade stays kept. */}
            {subBoardZoomPhase !== "landed" && subBoardZoomPhase !== "revealed" && (
              <div
                className="flex items-stretch gap-[10px]"
                style={{
                  gridArea: "1 / 1",
                  opacity: mainBoardFadeIn ? 1 : 0,
                  transition: subBoardZoomPhase === "closing" ? `opacity ${SUB_BOARD_MAIN_FADE_IN_MS}ms ease` : undefined,
                }}
              >
                {renderMainBoardColumnsContent()}
              </div>
            )}
            {/* Sub-board: see subBoardOverlayRef's own declaration above for why this is ONE
                element continuously mounted from "opening" through "revealed" (only unmounting once
                "closing" begins, matching the pre-existing instant-swap-back-to-main-board-on-close
                behavior). Invisible during "opening" (pure measurement — the "opening" effect reads
                its columns' real on-screen boxes), fades in during "landed" (opacity computed
                directly from phase on this same already-mounted node, matching the main board
                above), fully interactive once "revealed". Advances phase to "revealed" itself via
                onTransitionEnd once its fade-in has actually finished, rather than trusting a fixed
                timer (see the "landed" phase effect above for the timeout backstop). */}
            {openSubBoardColumnName && subBoardZoomPhase !== "closing" && (
              <div
                ref={subBoardOverlayRef}
                aria-hidden={subBoardZoomPhase === "revealed" ? undefined : "true"}
                className="flex items-stretch gap-[10px]"
                style={{
                  gridArea: "1 / 1",
                  opacity: subBoardZoomPhase === "opening" ? 0 : 1,
                  pointerEvents: subBoardZoomPhase === "revealed" ? "auto" : "none",
                  transition: subBoardZoomPhase === "landed" ? `opacity ${SUB_BOARD_ZOOM_FADE_MS}ms ease` : undefined,
                }}
                onTransitionEnd={(e) => {
                  if (e.target !== e.currentTarget || e.propertyName !== "opacity") return;
                  setSubBoardZoomPhase((prev) => (prev === "landed" ? "revealed" : prev));
                }}
              >
                {renderSubBoardColumnsContent()}
              </div>
            )}
          </div>
          )}

          {dashboardViewMode === "list" && (
          // lg:-mx-5 exactly cancels <main>'s own lg:px-5 so the table (and its rows' own
          // backgrounds/borders/hover states, which span its full width) touches the sidebar on
          // the left and the true viewport edge on the right — unlike the board columns above,
          // which stay padded to match their own gap from the filter bar.
          <div className="hidden lg:-mx-5 lg:block">
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
                      <td className="py-3" style={{ color: dashboardPalette.textMuted, backgroundColor: dashboardPalette.panelBg }} colSpan={6}>
                        <div className="flex min-h-[60vh] items-center justify-center gap-2">
                          Loading projects...
                          <div
                            className="h-4 w-4 animate-spin rounded-full border-[2px] border-[var(--glass-border)] border-t-[var(--brand-strong)]"
                            role="status"
                            aria-label="Loading"
                          />
                        </div>
                      </td>
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
                        <div className="flex items-center justify-center gap-2">
                          Loading more projects...
                          <div
                            className="h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-[var(--glass-border)] border-t-[var(--brand-strong)]"
                            role="status"
                            aria-label="Loading"
                          />
                        </div>
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

              {isMobileQuickFilterOpen &&
                mobileQuickFilterPos &&
                createPortal(
                  <div
                    data-quick-filter-menu="true"
                    className="fixed overflow-hidden rounded-[10px] border p-1 shadow-[var(--shadow-md)]"
                    style={{
                      left: mobileQuickFilterPos.left,
                      top: mobileQuickFilterPos.top,
                      width: mobileQuickFilterPos.width,
                      zIndex: 2147483647,
                      borderColor: "var(--glass-border)",
                      backgroundColor: "var(--glass-modal-bg)",
                      backdropFilter: "blur(12px) saturate(220%)",
                      WebkitBackdropFilter: "blur(12px) saturate(220%)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {QUICK_FILTER_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => {
                          setQuickFilter(option.key);
                          setIsMobileQuickFilterOpen(false);
                          setMobileQuickFilterPos(null);
                        }}
                        className="block w-full rounded-[8px] px-3 py-2 text-left text-[12px] font-bold"
                        style={{
                          backgroundImage: quickFilter === option.key ? "var(--brand-gradient)" : "none",
                          color: quickFilter === option.key ? "#FFFFFF" : dashboardPalette.text,
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}

            </div>
            {/* Sub-board shatter pieces — see the phase effects above for the full sequence
                (opening -> landed -> revealed, or closing -> idle). Portalled to <body> with a
                high z-index so they reliably sit above the real content regardless of that
                content's own position in the page's stacking order. */}
            {(subBoardZoomPhase === "opening" || subBoardZoomPhase === "landed" || subBoardZoomPhase === "closing") &&
              subBoardZoomOrigin &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  aria-hidden="true"
                  className="pointer-events-none fixed inset-0"
                  style={{
                    zIndex: 500,
                    // Stays mounted (and their own positions/colors untouched) through "landed" —
                    // just fades the whole group out on top of the now-visible real content,
                    // instead of instantly vanishing the moment they've arrived.
                    opacity: subBoardZoomPhase === "landed" ? 0 : 1,
                    transition: subBoardZoomPhase === "landed" ? `opacity ${SUB_BOARD_ZOOM_FADE_MS}ms ease` : undefined,
                  }}
                >
                  {subBoardZoomTargetInfo.map((info, i) => {
                    // Rendered at the origin column's own i-th slice from the very first paint —
                    // not left unset until the layout effect below gets a chance to run — so
                    // there's never a frame where a piece has no explicit position and falls back
                    // to its CSS default (which reads as a flash at its "parked" flow position).
                    // The effect still does its own identical instant-snap write on mount (a
                    // harmless, redundant re-write of the same values) before animating away.
                    const n = subBoardZoomTargetInfo.length;
                    const sliceWidth = subBoardZoomOrigin.width / n;
                    return (
                      <div
                        key={i}
                        ref={(el) => {
                          subBoardZoomPieceRefs.current[i] = el;
                        }}
                        className="absolute overflow-hidden rounded-[16px] border"
                        style={{
                          left: subBoardZoomOrigin.left + i * sliceWidth,
                          top: subBoardZoomOrigin.top,
                          width: sliceWidth,
                          height: subBoardZoomOrigin.height,
                          backgroundColor: hexToRgba(subBoardZoomOrigin.color, 0.85),
                          opacity: 1,
                          borderColor: "rgba(255,255,255,0.3)",
                          backdropFilter: "blur(20px) saturate(180%)",
                          WebkitBackdropFilter: "blur(20px) saturate(180%)",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), inset 0 30px 40px -32px rgba(255,255,255,0.35), var(--shadow-glass)",
                        }}
                      >
                        {/* The piece's target header/cards, already there at a FIXED natural width
                            (not 100% of the piece's own animating width) — otherwise this content
                            would squish down to illegible as the piece narrows, only snapping to
                            readable size right at the very end (reads as "flashing in"). Clipped
                            by the piece's own overflow-hidden above instead, so more of this
                            already-full-size content comes into view as the piece grows over it.
                            Non-interactive by inheritance (the portal wrapper is pointer-events-none). */}
                        <div className="flex h-full flex-col" style={{ width: 280 }}>
                          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: "rgba(0,0,0,0.15)" }}>
                            <p className="truncate text-[13px] font-semibold" style={{ color: "#000000" }}>{info.name}</p>
                            <span
                              className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-2 text-[10px] font-bold"
                              style={{
                                color: isDarkMode ? dashboardPalette.text : "#000000",
                                backgroundColor: isDarkMode ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)",
                              }}
                            >
                              {info.projects.length}
                            </span>
                          </div>
                          <div className="flex-1 space-y-2.5 overflow-hidden p-2.5">
                            {info.projects.slice(0, 6).map((project) =>
                              renderProjectBoardCard(project, info.color, { idPrefix: "project-piece-preview-" }),
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>,
                document.body,
              )}
            {completedProjectsModal}
            {showCompletedProjectsModal && <GlassScrollbarThumb scrollRef={completedProjectsScrollRef} zIndexClassName="z-[8]" />}
            {staffModal}
            {showStaffModal && <GlassScrollbarThumb scrollRef={staffMembersScrollRef} zIndexClassName="z-[8]" />}
            {/* Board view's own horizontal scroll needs a replacement scrollbar, not just a nicety:
                the columns row's natural bottom edge (where its native scrollbar renders) is
                viewport-relative in height, so it commonly sits below the fold until the page has
                been scrolled all the way down to the sticky-docked position — until then the real
                scrollbar is literally off-screen and undraggable. This one is pinned to the
                viewport's own bottom edge instead (docking to the real edge once that's in view —
                see GlassScrollbarThumb's own horizontal-mode comment), so the board stays
                horizontally scrollable via drag at any page scroll position. Desktop-only
                (trackClassName) — mobile already scrolls this same row via native touch swipe. */}
            {dashboardViewMode === "board" && (
              <GlassScrollbarThumb
                scrollRef={boardScrollContainerRef}
                orientation="horizontal"
                zIndexClassName="z-[40]"
                trackClassName="hidden lg:block"
                viewportBottomInsetPx={0}
              />
            )}
            {openingProjectOverlay}
            <DragGhostLayer controller={projectBoardDragGhost} />
          </>
          )}
    </>
  );
}
