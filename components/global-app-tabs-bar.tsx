"use client";

import { activeDate, activeDateTime } from "@/lib/company-formats";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode, type RefObject, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  DollarSign,
  FolderKanban,
  Globe,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Lock,
  Mail,
  Menu,
  Minus,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  Unlock,
  UserMinus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { requestNotificationReminderPush } from "@/lib/push-client";
import { pushNotificationCategoryOf } from "@/lib/push-notification-types";
import { devButtonClass, useDevModeOn } from "@/lib/dev-mode";
import { DEV_TEST_LIST_KINDS, devTestListSample, isDevTestNotificationText } from "@/lib/push-dev-test";
import { useSwipeToClose } from "@/lib/use-swipe-to-close";
import { openWhatsNew } from "@/components/whats-new-sheet";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";
import { bounceOriginElement } from "@/lib/use-glass-modal-pop-origin";
import { GlassDropdown } from "@/components/glass-dropdown";
import { useAppTabs, type AppWorkspaceTab } from "@/lib/app-tabs-context";
import { applyThemeMode, readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import { useAuth } from "@/lib/auth-context";
import { prefetchProjectById } from "@/lib/firestore-data";
import {
  addUserNotification,
  deleteUserNotification,
  fetchOlderUserNotifications,
  fetchUserNotifications,
  NOTIFICATIONS_PAGE_MS,
  markUserNotificationRead,
  setAllUserNotificationsRead,
  setUserNotificationRead,
  snoozeUserNotification,
  type UserNotificationRow,
} from "@/lib/firestore-data";

const NOTIF_POLL_INTERVAL_MS = 50000;

// "<date> | 8:57pm" — the date in the company's date format, the time in the viewer's own local time.
function formatNotificationTime(iso: string) {
  return activeDateTime(iso);
}

// A notification's time, short: "Now", "5m", "2h", "3d" — then its date (the company's date format).
function relativeNotifTime(iso: string) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.floor((Date.now() - at) / 60000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return activeDate(iso);
}

// Each notification's icon: the one the app uses for what it's about —
const NOTIF_TYPE_ICONS: Record<string, LucideIcon> = {
  // a project's access (Company Settings > Production access), the "Assigned" in a project's header, removing
  // someone (Company Settings), and Production's Unlock Edit (locked / unlocked)
  project_access: KeyRound,
  project_assigned: Users,
  project_unassigned: UserMinus,
  production_unlock_request: Lock,
  production_unlock_response: Unlock,
  // Leads (the sidebar's)
  lead_new: Inbox,
  lead_access: Inbox,
  // Design's Quote and Specifications tabs
  quote_accepted: DollarSign,
  quote_declined: DollarSign,
  quote_sent: DollarSign,
  quote_pending: DollarSign,
  specs_submitted: ClipboardList,
  specs_sent: ClipboardList,
  specs_pending: ClipboardList,
  // Calendar (the sidebar's)
  calendar_reminder: CalendarDays,
  // a new version: an update (arrows in a circle); a role (Company Settings > Roles)
  app_version: RefreshCw,
  role_change: Shield,
};
// — or, for a kind not listed there, its category's (the same icons as User Settings > Notifications).
const NOTIF_CATEGORY_ICONS: Record<string, LucideIcon> = {
  projects: FolderKanban,
  leads: Inbox,
  client_portal: Globe,
  calendar: CalendarDays,
  cutsmart: Sparkles,
};
// "Remind me in…" (a notification's menu): minutes, hours or days — how long one is, the most you can pick (the
// server takes 1 minute to 60 days — app/api/push/remind), and how far − / + move it (minutes go in fives).
type RemindUnit = "minutes" | "hours" | "days";
const REMIND_UNITS: Record<RemindUnit, { ms: number; max: number; step: number; one: string; many: string }> = {
  minutes: { ms: 60 * 1000, max: 59, step: 5, one: "minute", many: "minutes" },
  hours: { ms: 60 * 60 * 1000, max: 24, step: 1, one: "hour", many: "hours" },
  days: { ms: 24 * 60 * 60 * 1000, max: 30, step: 1, one: "day", many: "days" },
};
const REMIND_UNIT_OPTIONS = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
];
// One step of − / + from `value`: by `step`, landing on its multiples (1 → 5 → 10 for minutes), within 1–max.
function stepRemindAmount(value: number, unit: RemindUnit, direction: 1 | -1): number {
  const { step, max } = REMIND_UNITS[unit];
  const next = direction > 0 ? Math.floor(value / step) * step + step : Math.ceil(value / step) * step - step;
  return Math.min(max, Math.max(1, next));
}

// The soft circle behind a notification's icon (and the empty list's bell).
const NOTIF_ICON_BG = "color-mix(in srgb, var(--text-main) 7%, transparent)";

// A new notification pops up in the top-right corner on a computer (1024px and up, like the Notifications
// drawer) while CutSmart is on screen. Phones and tablets get the system's own notifications instead.
function canPopUpNotifications(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  return window.matchMedia("(min-width: 1024px)").matches && document.visibilityState === "visible";
}
// How long one stays up (while the pointer's on it, it waits).
const NOTIF_TOAST_MS = 5000;
// A dev mode test notification (the "test in … s" at the top of Notifications) — marked as one, or, if it was
// added before they were marked, one of the tests' exact words. Cleared away once it's been seen.
function isDevTestNotification(row: UserNotificationRow): boolean {
  return Boolean(row.devTest) || isDevTestNotificationText(row.title, row.message);
}
// A pop-up: a notification from the list — or a dev mode test (lib/push-dev-test.ts), which isn't stored, so
// it's made from the push itself, and opens where the push would (testUrl).
type NotifToastItem = UserNotificationRow & { testUrl?: string };
// Popping out of the bell and back into it — the same as the app's other pop-ups (lib/use-glass-modal-pop-origin.ts):
// a little overshoot coming out, a smooth shrink going back.
const NOTIF_TOAST_POP_MS = 320;
const NOTIF_TOAST_POP_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const NOTIF_TOAST_SHRINK_EASING = "cubic-bezier(0.34, 1, 0.64, 1)";
// From a pop-up to the bell: how far its centre moves, and the transform that shrinks it onto the bell.
function notifToastPathToBell(el: HTMLElement, bell: HTMLElement | null): { dx: number; dy: number; transform: string } | null {
  if (!bell || !bell.isConnected || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const from = el.getBoundingClientRect();
  const to = bell.getBoundingClientRect();
  if (!from.width || !to.width) return null;
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const scaleX = Math.max(to.width / from.width, 0.02);
  const scaleY = Math.max(to.height / from.height, 0.02);
  return { dx, dy, transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` };
}

// One pop-up: its icon, title and message, like its row in the list. Clicking it opens what it's about; its X
// (shown on hover) just closes it. It pops out of the bell (bellRef), and when it's done shrinks back into it,
// the bell giving a little nudge as it lands — like the app's other pop-ups and the buttons they open from.
function NotifToast({
  icon: Icon,
  title,
  message,
  bellRef,
  onOpen,
  onDone,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
  bellRef: RefObject<HTMLElement | null>;
  onOpen: () => void;
  onDone: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  // The time it has left — kept across hovering, so the pointer resting on it pauses it rather than restarting it.
  const remainingMsRef = useRef(NOTIF_TOAST_MS);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    if (hovered || leaving) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => setLeaving(true), remainingMsRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingMsRef.current = Math.max(1000, remainingMsRef.current - (Date.now() - startedAt));
    };
  }, [hovered, leaving]);
  // Coming in: out of the bell (just fading in, with reduced motion).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const path = notifToastPathToBell(el, bellRef.current);
    const animation = path
      ? el.animate(
          [
            { transform: path.transform, opacity: 0 },
            { opacity: 1, offset: 0.3 },
            { transform: "translate(0px, 0px) scale(1, 1)", opacity: 1 },
          ],
          { duration: NOTIF_TOAST_POP_MS, easing: NOTIF_TOAST_POP_EASING },
        )
      : el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease" });
    return () => animation.cancel();
  }, [bellRef]);
  // Going: back into the bell, which nudges as it lands — then it's gone.
  useEffect(() => {
    if (!leaving) return;
    const el = rootRef.current;
    if (!el) {
      onDoneRef.current();
      return;
    }
    // Still popping out (closed straight away)? Stopped first, so it's measured where it really sits.
    for (const running of el.getAnimations()) running.cancel();
    const bell = bellRef.current;
    const path = notifToastPathToBell(el, bell);
    const animation = path
      ? el.animate(
          [
            { transform: "translate(0px, 0px) scale(1, 1)", opacity: 1 },
            { opacity: 1, offset: 0.55 },
            { transform: path.transform, opacity: 0 },
          ],
          { duration: NOTIF_TOAST_POP_MS, easing: NOTIF_TOAST_SHRINK_EASING, fill: "forwards" },
        )
      : el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease", fill: "forwards" });
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      if (path && bell?.isConnected) bounceOriginElement(bell, path.dx, path.dy);
      onDoneRef.current();
    };
    animation.onfinish = land;
    // In case the browser holds the animation's end back (e.g. a tab in the background).
    const fallback = window.setTimeout(land, NOTIF_TOAST_POP_MS + 250);
    return () => {
      window.clearTimeout(fallback);
      animation.onfinish = null;
      animation.cancel();
    };
  }, [leaving, bellRef]);
  return (
    <div
      ref={rootRef}
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group pointer-events-auto relative w-full overflow-hidden rounded-[16px] border"
      style={{
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-bg-strong)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass)",
      }}
    >
      <button
        type="button"
        onClick={() => {
          onOpen();
          setLeaving(true);
        }}
        className="flex w-full items-start gap-3 px-3 py-3 pr-9 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)]"
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: NOTIF_ICON_BG, color: "var(--text-main)" }}>
          <Icon size={16} />
        </span>
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="block truncate text-[13.5px] font-semibold" style={{ color: "var(--text-main)" }}>
            {title}
          </span>
          {message ? (
            <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug" style={{ color: "var(--text-muted)" }}>
              {message}
            </span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setLeaving(true)}
        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] focus-visible:opacity-100 group-hover:opacity-100"
        style={{ color: "var(--text-muted)" }}
        aria-label="Dismiss notification"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

let pendingActiveAppTabKeyMemory = "";
const CLOSING_SCOPE_PREFIX = "scope::";

function scopeKeyForPath(pathname: string) {
  const cleanPath = String(pathname || "").trim() || "/";
  const projectRouteMatch = cleanPath.match(/^\/projects\/([^/?#]+)/);
  if (projectRouteMatch) {
    return `project:${String(projectRouteMatch[1] || "").trim()}`;
  }
  return `route:${cleanPath}`;
}

function formatSingleTabLabel(tab: AppWorkspaceTab, groupLabel: string) {
  const normalizedScopeKey = String(tab.scopeKey || "").trim();
  const normalizedGroupLabel = String(groupLabel || "").trim();
  if (normalizedScopeKey.startsWith("project:") && normalizedGroupLabel) {
    return normalizedGroupLabel;
  }
  return normalizedGroupLabel && tab.groupKey ? `${normalizedGroupLabel}: ${tab.label}` : tab.label;
}

// Same key/precedence company-settings, dashboard, etc. already use to resolve "which company is
// active" — a manual override in localStorage first, falling back to the signed-in account's own
// membership. Notifications need this too: without it, a user who's a member of multiple
// companies would see every company's notifications mixed together regardless of which one
// they're currently working in.
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

export function GlobalAppTabsBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { tabs: globalAppTabs, actionsByKey, closeTab, reorderGroupToIndex, suppressScope, restoreScope, suppressTab, chromeHidden, setMobileNavOpen, notifOpen: isNotifOpen, setNotifOpen: setIsNotifOpen } = useAppTabs();
  const { user } = useAuth();
  const activeCompanyId = useMemo(() => {
    if (typeof window === "undefined") return String(user?.companyId || "").trim();
    const stored = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
    return stored || String(user?.companyId || "").trim();
  }, [user?.companyId]);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  // Whether the page has scrolled under the bar: the bar is see-through at the top of a page and its
  // glass fades in once there's something underneath it.
  const [isPageScrolledUnder, setIsPageScrolledUnder] = useState(false);
  const [isAppTabsMenuOpen, setIsAppTabsMenuOpen] = useState("");
  const [appTabsMenuPos, setAppTabsMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [notifRows, setNotifRows] = useState<UserNotificationRow[]>([]);
  const [notifPos, setNotifPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const notifBtnRef = useRef<HTMLButtonElement | null>(null);
  const notifDropdownRef = useRef<HTMLDivElement | null>(null);
  const notifUnreadCount = notifRows.filter((row) => !row.read).length;
  // Which person and company the list was last loaded for — until it has been for these, it isn't "all caught
  // up", just not loaded yet (renderNotifRows shows placeholders then).
  const notifListKey = `${String(user?.uid || "")}|${activeCompanyId}`;
  const [notifsLoadedKey, setNotifsLoadedKey] = useState("");
  const isNotifListLoaded = notifsLoadedKey === notifListKey;
  // New notifications popped up in the corner (computers — see canPopUpNotifications): newest on top, three
  // at most at once.
  const [notifToasts, setNotifToasts] = useState<NotifToastItem[]>([]);
  // The notifications the last check found (null before the first: those were already there, so none of
  // them pops up). One that wasn't there before is new — including one a "Remind me" brings back.
  const seenNotifIdsRef = useRef<Set<string> | null>(null);
  // Checks for new notifications straight away (set by the polling below) — e.g. when a push arrives.
  const loadNotifsNowRef = useRef<(() => void) | null>(null);
  // The list loads two weeks at a time (lib/firestore-data.ts): the last two weeks — from notifSinceMsRef, two weeks
  // before it first loaded, on — kept current by the polling; then each "Load more" at the bottom of the list adds
  // the two weeks before notifOldestMsRef (where what's loaded reaches back to).
  const notifSinceMsRef = useRef<number | null>(null);
  const notifOldestMsRef = useRef<number | null>(null);
  const [notifHasOlder, setNotifHasOlder] = useState(false);
  const [isLoadingOlderNotifs, setIsLoadingOlderNotifs] = useState(false);
  const loadOlderNotifs = async () => {
    const uid = String(user?.uid || "").trim();
    const beforeMs = notifOldestMsRef.current;
    if (!uid || beforeMs === null || isLoadingOlderNotifs) return;
    setIsLoadingOlderNotifs(true);
    const page = await fetchOlderUserNotifications(uid, activeCompanyId, beforeMs);
    setIsLoadingOlderNotifs(false);
    // (Not if the list has started over since — another person or company.)
    if (!page || notifOldestMsRef.current !== beforeMs) return;
    notifOldestMsRef.current = page.sinceMs;
    setNotifHasOlder(page.hasOlder);
    setNotifRows((prev) => [...prev, ...page.rows.filter((row) => !prev.some((item) => item.id === row.id))]);
  };
  const isNotifOpenRef = useRef(isNotifOpen);
  useEffect(() => {
    isNotifOpenRef.current = isNotifOpen;
  }, [isNotifOpen]);
  // Dev mode's test notifications (the "test in … s" below) are for testing only: once one's been seen it's
  // removed for good — when its pop-up is done, or when Notifications is closed after it was in the list.
  const removeDevTestNotification = (id: string) => {
    const uid = user?.uid;
    if (!uid) return;
    void deleteUserNotification(uid, id).then(() => setNotifRows((prev) => prev.filter((item) => item.id !== id)));
  };
  const notifRowsRef = useRef(notifRows);
  useEffect(() => {
    notifRowsRef.current = notifRows;
  }, [notifRows]);
  const wasNotifOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = wasNotifOpenRef.current;
    wasNotifOpenRef.current = isNotifOpen;
    const uid = user?.uid;
    if (!wasOpen || isNotifOpen || !uid) return;
    for (const row of notifRowsRef.current) {
      if (!isDevTestNotification(row)) continue;
      void deleteUserNotification(uid, row.id).then(() => setNotifRows((prev) => prev.filter((item) => item.id !== row.id)));
    }
  }, [isNotifOpen, user?.uid]);
  // Dev mode: "test in … s" at the top of Notifications (renderDevNotifTest) — how many seconds, and while one's
  // on its way, how many are left.
  const isDevModeOn = useDevModeOn();
  const [devTestSecondsText, setDevTestSecondsText] = useState("5");
  const [devTestSecondsLeft, setDevTestSecondsLeft] = useState<number | null>(null);
  const devTestTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (devTestTimerRef.current) window.clearTimeout(devTestTimerRef.current);
    },
    [],
  );
  const [notifBellWobbleKey, setNotifBellWobbleKey] = useState(0);
  // Matches app-shell.tsx's own breakpoint (min-width: 1024px) — below it, opening notifications
  // shows a full-screen slide-out panel (same treatment as the mobile nav drawer) instead of the
  // small anchored dropdown, which doesn't have room to work well at phone widths.
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  // useLayoutEffect, not useEffect — starts false (mobile-first default) regardless of the real
  // device, same reasoning as app-shell.tsx's own equivalent flag.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktopViewport(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  // Computer: Notifications is a drawer down the whole right side, sliding in and out (the same as a
  // contact's on Contacts) — kept mounted while it slides back out.
  const [isNotifDrawerMounted, setIsNotifDrawerMounted] = useState(false);
  if (isNotifOpen && isDesktopViewport && !isNotifDrawerMounted) setIsNotifDrawerMounted(true);
  // A notification's own menu — right-click it, or press and hold on a phone: Mark as read / unread, Clear,
  // Remind me in… (how many hours or days, kept for next time).
  const [notifMenu, setNotifMenu] = useState<{ row: UserNotificationRow; left: number; top: number; width: number } | null>(null);
  const notifMenuRef = useRef<HTMLDivElement | null>(null);
  const [remindAmount, setRemindAmount] = useState(1);
  const [remindUnit, setRemindUnit] = useState<RemindUnit>("days");
  const notifLongPressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  // The row a press-and-hold opened the menu on: the tap its release fires doesn't also open it.
  const suppressNotifClickRef = useRef("");
  const mobileNotifPanelRef = useRef<HTMLDivElement | null>(null);
  // This component lives outside AppShell's own tree (see app/(staff)/layout.tsx), so the page
  // content it pushes in sync with the panel's slide has to be found by query rather than a ref
  // passed down. Targets the SAME wrapping div app-shell.tsx's own mobile nav drawer pushes
  // (tagged data-app-main-push) — not the inner <main> element itself, which is a different node
  // with its own overflow/height handling that made the push look different/inconsistent here.
  const mainPushRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    mainPushRef.current = document.querySelector<HTMLElement>('[data-app-main-push="true"]');
    // Re-resolved (not just once on mount) because this component can render its real content
    // before AppShell's <main> exists yet — it returns null until there's a registered tab to
    // show (see the early `if (!user || !groupedGlobalTabs.length...) return null` above), which
    // doesn't depend on AppShell having mounted. A one-time empty-deps query could run and find
    // nothing, permanently leaving the panel with no page content to push. Re-querying right
    // before the panel actually opens is guaranteed to run well after <main> exists.
  }, [isNotifOpen]);
  const { shouldRender: shouldRenderMobileNotif, touchHandlers: mobileNotifTouchHandlers } = useSwipeToClose(
    isNotifOpen && !isDesktopViewport,
    () => setIsNotifOpen(false),
    mobileNotifPanelRef,
    // Slides in over the page as frosted glass, the page staying put behind it (app-shell.tsx's
    // mobilePanelGlass) — it no longer shoves the page over.
    { edge: "right" },
  );
  const [pendingActiveAppTabKey, setPendingActiveAppTabKey] = useState(pendingActiveAppTabKeyMemory);
  const [hiddenScopeKeys, setHiddenScopeKeys] = useState<string[]>([]);
  const [draggedGroupKey, setDraggedGroupKey] = useState("");
  const [dragOverGroupKey, setDragOverGroupKey] = useState("");
  const [dragInsertIndex, setDragInsertIndex] = useState<number | null>(null);
  const [draggedGroupWidth, setDraggedGroupWidth] = useState(0);
  const [collapsedDraggedGroupKey, setCollapsedDraggedGroupKey] = useState("");
  // False for the moment a tab is picked up: the picked-up tab vanishes from the row and the tabs
  // after it hold their places in one go, instead of it visibly squeezing away to the left (and the
  // others sliding into its gap and back out). Tabs only animate once the drag is under way.
  const [dragShiftAnimated, setDragShiftAnimated] = useState(false);
  // The tab that was just let go of: hidden in the row while its ghost slides into its place, then
  // shown again (settleGhostInto). settleTokenRef stops an older slide finishing over a newer drag.
  const [settlingGroupKey, setSettlingGroupKey] = useState("");
  // Closing a tab: the space it leaves in the row, which slides shut once the tab has popped away
  // (popAwayClosingTab). index: where it sits among the tabs; collapsed: sliding shut.
  const [closingTabGaps, setClosingTabGaps] = useState<{ id: number; index: number; width: number; collapsed: boolean }[]>([]);
  const closingTabGapIdRef = useRef(0);
  const closingTabTimersRef = useRef<number[]>([]);
  const settleTokenRef = useRef(0);
  const [pressedGroupKey, setPressedGroupKey] = useState("");
  const appTabsMenuRef = useRef<HTMLDivElement | null>(null);
  const appTabsDropdownRef = useRef<HTMLDivElement | null>(null);
  const topTabsStripRef = useRef<HTMLDivElement | null>(null);
  const groupNodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragLayoutRef = useRef<Array<{ groupKey: string; left: number; width: number }>>([]);
  const customDragGhostRef = useRef<HTMLDivElement | null>(null);
  const dragGhostGrabOffsetXRef = useRef(0);
  // Stops the desktop drag ghost following the pointer (see followPointerWithGhost).
  const stopGhostFollowRef = useRef<(() => void) | null>(null);
  // Touch-driven reorder for mobile — native HTML5 draggable/dragstart/dragover never fire from a
  // touch gesture, so desktop's drag system (above) is silently inert on phones; this is a parallel
  // touch implementation that drives the SAME state (draggedGroupKey/dragInsertIndex/etc.) so both
  // share the exact same "make room" shifting/ghost rendering already wired into each tab below.
  // Gated to a genuine long-press (not a quick tap, and not a horizontal swipe-to-scroll) so tapping
  // a tab still switches to it and dragging your finger to scroll the strip still works normally.
  const MOBILE_TAB_LONG_PRESS_MS = 450;
  const MOBILE_TAB_MOVE_CANCEL_PX = 10;
  const mobileTabTouchRef = useRef<{
    groupKey: string;
    startX: number;
    startY: number;
    lastX: number;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    dragging: boolean;
    eligible: boolean;
  } | null>(null);
  // Set right when a touch-drag commits — checked (and cleared) at the top of the tab's own onClick
  // so the synthetic click some browsers still fire right after a touchend doesn't ALSO switch to
  // the tab that just got reordered under the finger.
  const suppressNextTabClickRef = useRef("");

  // Desktop scrolls the document; phones scroll <main> (app-shell.tsx); Quote/Specifications scroll
  // their own data-app-scroll-root. Any of those away from the top means content is under the bar.
  useEffect(() => {
    const read = () => {
      let top = window.scrollY || document.scrollingElement?.scrollTop || 0;
      const main = document.querySelector<HTMLElement>("main");
      if (main) top = Math.max(top, main.scrollTop);
      document.querySelectorAll<HTMLElement>('[data-app-scroll-root="true"]').forEach((el) => {
        top = Math.max(top, el.scrollTop);
      });
      setIsPageScrolledUnder(top > 2);
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (
        target === document ||
        (target instanceof HTMLElement && (target.tagName === "MAIN" || target.getAttribute("data-app-scroll-root") === "true"))
      ) {
        read();
      }
    };
    const frame = window.requestAnimationFrame(read);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", read);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", read);
    };
  }, [pathname]);

  const shellPalette = themeMode === "dark"
    ? {
        panelBg: "#212121",
        panelMuted: "#272727",
        border: "#3f3f46",
        text: "#f1f1f1",
        textMuted: "#aaaaaa",
        // The page's own dark (--bg-app, the same as a flat page's — lib/flat-page.ts), on every page.
        stripBg: "rgba(11,13,18,0.4)",
        tabIdleBg: "rgba(255,255,255,0.05)",
        stripHighlight: "rgba(255,255,255,0.07)",
      }
    : {
        panelBg: "#ffffff",
        panelMuted: "#F8FAFC",
        border: "#D8DEE8",
        text: "#0F172A",
        textMuted: "#475467",
        // The page grey (--bg-app, the same as a flat page's — lib/flat-page.ts).
        stripBg: "rgba(245,247,250,0.4)",
        tabIdleBg: "rgba(255,255,255,0.55)",
        stripHighlight: "rgba(255,255,255,0.55)",
      };

  const currentScopeKey = useMemo(() => scopeKeyForPath(String(pathname || "").trim() || "/"), [pathname]);
  const visibleGlobalAppTabs = useMemo(
    () => globalAppTabs.filter((tab) => !hiddenScopeKeys.includes(tab.scopeKey)),
    [globalAppTabs, hiddenScopeKeys],
  );
  const requestedProjectLiveTabId = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return String(new URLSearchParams(window.location.search).get("liveTab") || "").trim();
  }, [pathname]);
  const currentScopeActiveTabKey = useMemo(() => {
    const scopedTabs = visibleGlobalAppTabs.filter((tab) => tab.scopeKey === currentScopeKey);
    if (!scopedTabs.length) {
      return "";
    }
    if (requestedProjectLiveTabId && currentScopeKey.startsWith("project:")) {
      const requestedKey = `${currentScopeKey}:${requestedProjectLiveTabId}`;
      if (scopedTabs.some((tab) => tab.key === requestedKey)) {
        return requestedKey;
      }
    }
    const cleanPath = String(pathname || "").trim() || "/";
    const pathMatchedTab =
      scopedTabs.find((tab) => String(tab.href || "").split("?")[0] === cleanPath) ??
      scopedTabs.find((tab) => tab.active);
    return pathMatchedTab?.key ?? scopedTabs[0]?.key ?? "";
  }, [currentScopeKey, pathname, requestedProjectLiveTabId, visibleGlobalAppTabs]);
  const activeGlobalTabKey = useMemo(
    () => visibleGlobalAppTabs.find((tab) => tab.active)?.key ?? visibleGlobalAppTabs[0]?.key ?? "",
    [visibleGlobalAppTabs],
  );
  // Dashboard is synthesized purely for rendering (see groupedGlobalTabs below) —
  // it never actually exists in visibleGlobalAppTabs, so currentScopeActiveTabKey
  // can never resolve to it. Without this, being on /dashboard with no real tab
  // registered for it fell straight through to whatever tab (e.g. a stale project
  // tab restored from localStorage) happened to have `active: true` — highlighting
  // the wrong tab on reload instead of Dashboard.
  const isOnDashboardRoute = (String(pathname || "").trim() || "/") === "/dashboard";
  // Deliberately NO further fallback to "whatever tab is marked active" once the
  // above two don't resolve — a route with no tabs registered for its own scope
  // (Company Settings, Calendar, Archived, User Settings, etc.) must show
  // NO tab highlighted at all, not whatever unrelated tab was last active before
  // navigating here. That fallback used to exist and is exactly what caused a
  // previously-visited project's tab to stay lit up while sitting on a page that
  // never activates any tab of its own.
  const displayActiveAppTabKey =
    pendingActiveAppTabKey ||
    currentScopeActiveTabKey ||
    (isOnDashboardRoute ? "route:/dashboard" : "");
  const groupedGlobalTabs = useMemo(() => {
    const groups: Array<{
      groupKey: string;
      groupLabel: string;
      tabs: AppWorkspaceTab[];
      order: number;
      isDashboard: boolean;
    }> = [];
    for (const tab of visibleGlobalAppTabs) {
      const groupKey = String(tab.groupKey || tab.key);
      const groupLabel = String(tab.groupLabel || tab.label);
      let group = groups.find((item) => item.groupKey === groupKey);
      if (!group) {
        group = {
          groupKey,
          groupLabel,
          tabs: [],
          order: Number(tab.order) || Number.MAX_SAFE_INTEGER,
          isDashboard: String(tab.href || "").trim() === "/dashboard",
        };
        groups.push(group);
      }
      group.tabs.push(tab);
      group.order = Math.min(group.order, Number(tab.order) || Number.MAX_SAFE_INTEGER);
      if (String(tab.href || "").trim() === "/dashboard") {
        group.isDashboard = true;
      }
    }
    // Dashboard is a permanent home button, not a dynamically-registered tab —
    // nothing else in the app ever registers one for it (auto path-based
    // registration was removed in an earlier refactor), so synthesize it here
    // whenever no real registration already provided one. Skip this on the
    // handful of routes outside the app shell (login/onboarding) — the bar
    // has never shown there and shouldn't start now.
    const cleanPathname = String(pathname || "").trim() || "/";
    const isOutsideAppShell =
      cleanPathname === "/" || cleanPathname.startsWith("/login") || cleanPathname.startsWith("/company-onboarding");
    if (!isOutsideAppShell && !groups.some((group) => group.isDashboard)) {
      groups.unshift({
        groupKey: "route:/dashboard",
        groupLabel: "Dashboard",
        tabs: [{ key: "route:/dashboard", label: "Dashboard", href: "/dashboard", scopeKey: "route:/dashboard" }],
        order: -1,
        isDashboard: true,
      });
    }
    return groups.slice().sort((a, b) => {
      if (a.isDashboard && !b.isDashboard) return -1;
      if (!a.isDashboard && b.isDashboard) return 1;
      return a.order - b.order;
    });
  }, [pathname, visibleGlobalAppTabs]);
  const dashboardTabGroup = useMemo(
    () => groupedGlobalTabs.find((group) => group.isDashboard) ?? null,
    [groupedGlobalTabs],
  );
  const scrollableTabGroups = useMemo(
    () => groupedGlobalTabs.filter((group) => !group.isDashboard),
    [groupedGlobalTabs],
  );

  useLayoutEffect(() => {
    const nextMode = readThemeMode();
    setThemeMode(nextMode);
    applyThemeMode(nextMode);
    if (typeof window === "undefined") return;
    const onThemeModeUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mode: ThemeMode }>).detail;
      const next = detail?.mode === "dark" ? "dark" : "light";
      setThemeMode(next);
      applyThemeMode(next);
    };
    window.addEventListener(THEME_MODE_UPDATED_EVENT, onThemeModeUpdated as EventListener);
    return () => {
      window.removeEventListener(THEME_MODE_UPDATED_EVENT, onThemeModeUpdated as EventListener);
    };
  }, []);


  useEffect(() => {
    restoreScope(currentScopeKey);
    setHiddenScopeKeys((prev) => (prev.includes(currentScopeKey) ? prev.filter((key) => key !== currentScopeKey) : prev));
  }, [currentScopeKey, restoreScope]);

  useEffect(() => {
    if (!pendingActiveAppTabKey) return;
    if (
      pendingActiveAppTabKey === currentScopeActiveTabKey ||
      pendingActiveAppTabKey === activeGlobalTabKey
    ) {
      pendingActiveAppTabKeyMemory = "";
      setPendingActiveAppTabKey("");
    }
  }, [activeGlobalTabKey, currentScopeActiveTabKey, pendingActiveAppTabKey]);

  // The optimistic "tab I just clicked" highlight (pendingActiveAppTabKey, set in selectAppTab) only
  // ever gets CONFIRMED-cleared above — if navigation instead lands somewhere that never matches it
  // (e.g. clicking a project tab, then navigating to Company Settings, a route with no tabs of its
  // own at all), that match never happens and the stale key stays set forever, highlighting a tab
  // that isn't actually open anywhere. Once the pathname has genuinely changed, the brief optimistic
  // window this exists for is over regardless of whether it matched — the real computed active-tab
  // value should always take over from there, so drop it unconditionally on every real navigation.
  useEffect(() => {
    pendingActiveAppTabKeyMemory = "";
    setPendingActiveAppTabKey("");
  }, [pathname]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onPointerDown = (event: PointerEvent) => {
      const targetNode = event.target as Node;
      const isInsideTopBar = appTabsMenuRef.current?.contains(targetNode);
      const isInsideDropdown = appTabsDropdownRef.current?.contains(targetNode);
      if (!isInsideTopBar && !isInsideDropdown) {
        setIsAppTabsMenuOpen("");
        setAppTabsMenuPos(null);
      }
      const isInsideNotifDropdown = notifDropdownRef.current?.contains(targetNode);
      // The mobile notif panel is a separate portaled subtree (mobileNotifPanelRef), not
      // notifDropdownRef (the desktop dropdown) — without also checking it here, this listener
      // treated every tap inside the OPEN mobile panel as "outside" and closed it immediately, so
      // tapping a notification row (or anywhere else in the panel) never got the chance to do
      // anything else first. Closing it should only ever come from its own explicit controls (the
      // header's close button, the backdrop tap, the swipe-to-close drag) or genuinely tapping
      // outside it, not from this desktop-oriented outside-click check.
      const isInsideMobileNotifPanel = mobileNotifPanelRef.current?.contains(targetNode);
      // A notification's menu is its own portal — a press in it is still inside Notifications. So is one in a
      // dropdown's list opened from it (Remind me in's minutes / hours / days), which is a portal of its own.
      const isInsideNotifMenu =
        notifMenuRef.current?.contains(targetNode) || Boolean((targetNode as Element | null)?.closest?.('[data-glass-dropdown-menu="true"]'));
      // The bell toggles it itself; anywhere else — the rest of the top bar included (a tab, an empty part) —
      // is off it, and closes it.
      const isOnNotifBell = notifBtnRef.current?.contains(targetNode);
      if (isNotifOpen && !isOnNotifBell && !isInsideNotifDropdown && !isInsideMobileNotifPanel && !isInsideNotifMenu) {
        setIsNotifOpen(false);
        // That press only closes notifications — it doesn't also act on whatever it landed on.
        swallowNextClick();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isNotifOpen, setIsNotifOpen]);

  // A notification's menu closes on a press outside it (that press doing nothing else), Escape, a scroll or
  // a resize.
  useEffect(() => {
    if (!notifMenu) return;
    const close = () => setNotifMenu(null);
    const onPointerDown = (event: PointerEvent) => {
      if (notifMenuRef.current?.contains(event.target as Node)) return;
      // Its unit dropdown's list (a portal of its own) is part of it.
      if ((event.target as Element | null)?.closest?.('[data-glass-dropdown-menu="true"]')) return;
      close();
      swallowNextClick();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    const onScroll = (event: Event) => {
      if (notifMenuRef.current && event.target instanceof Node && notifMenuRef.current.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [notifMenu]);
  // Escape closes the computer's drawer (a notification's open menu takes it first, above).
  useEffect(() => {
    if (!isNotifOpen || !isDesktopViewport) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsNotifOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isNotifOpen, isDesktopViewport, setIsNotifOpen]);

  useEffect(() => {
    const uid = String(user?.uid || "").trim();
    if (!uid) {
      setNotifRows([]);
      return;
    }
    let cancelled = false;
    let lastSignature = "";
    let isFirstLoad = true;
    seenNotifIdsRef.current = null;
    notifSinceMsRef.current = null;
    notifOldestMsRef.current = null;
    const load = async () => {
      // A hidden tab doesn't need fresh notifications; it catches up on the next poll after it's shown.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (notifSinceMsRef.current === null) {
        notifSinceMsRef.current = Date.now() - NOTIFICATIONS_PAGE_MS;
        notifOldestMsRef.current = notifSinceMsRef.current;
      }
      const sinceMs = notifSinceMsRef.current;
      const { rows, hasOlder } = await fetchUserNotifications(uid, activeCompanyId, sinceMs);
      if (cancelled) return;
      // Until "Load more" has been used: whether there's anything before these two weeks.
      if (notifOldestMsRef.current === sinceMs) setNotifHasOlder(hasOlder);
      setNotifsLoadedKey(`${uid}|${activeCompanyId}`);
      // Any unread one that wasn't there last time pops up in the corner (on a computer, while the list
      // itself isn't open).
      const seen = seenNotifIdsRef.current;
      seenNotifIdsRef.current = new Set(rows.map((row) => row.id));
      if (seen && !isNotifOpenRef.current && canPopUpNotifications()) {
        const fresh = rows.filter((row) => !row.read && !seen.has(row.id));
        if (fresh.length > 0) {
          setNotifToasts((prev) => [...fresh, ...prev.filter((toast) => !fresh.some((row) => row.id === toast.id))].slice(0, 3));
        }
      }
      // Only update (and so re-render the top bar) when something actually changed.
      const signature = JSON.stringify(rows);
      if (signature === lastSignature) return;
      lastSignature = signature;
      if (isFirstLoad) {
        isFirstLoad = false;
        setNotifRows(rows);
        return;
      }
      // What "Load more" added (older than these two weeks) stays as it is.
      setNotifRows((prev) => [
        ...rows,
        ...prev.filter((row) => (Date.parse(row.createdAtIso) || 0) < sinceMs && !rows.some((item) => item.id === row.id)),
      ]);
    };
    // The first load waits a moment, so it doesn't compete with the page's own data on open (opening
    // Notifications before then loads it straight away — see below).
    const firstLoadTimer = window.setTimeout(() => void load(), 2000);
    const intervalId = window.setInterval(() => void load(), NOTIF_POLL_INTERVAL_MS);
    // Coming back to the tab: caught up straight away, not at the next poll (a hidden tab skips them).
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    loadNotifsNowRef.current = () => void load();
    return () => {
      cancelled = true;
      window.clearTimeout(firstLoadTimer);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      loadNotifsNowRef.current = null;
    };
  }, [activeCompanyId, user?.uid]);
  // Opening Notifications loads the list straight away — so it's never waiting on the first load or the next poll.
  useEffect(() => {
    if (isNotifOpen) loadNotifsNowRef.current?.();
  }, [isNotifOpen]);
  // A push arriving while CutSmart's open: the service worker asks first (public/sw.js). On a computer, with it on
  // screen, it's shown here (popped up, or in the open list) instead of as the system's notification — so not
  // twice — and the list is checked straight away rather than at the next poll.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; push?: { title?: string; body?: string; url?: string; tag?: string } } | null;
      if (data?.type !== "cutsmart-push") return;
      // A dev mode test isn't in the list, so it pops up from the push itself (even with the list open).
      const tag = String(data.push?.tag || "");
      if (tag.startsWith("dev-test-")) {
        const showHere = canPopUpNotifications();
        event.ports[0]?.postMessage({ shownInApp: showHere });
        if (!showHere) return;
        const test: NotifToastItem = {
          id: tag,
          // Its kind is in its tag: dev-test-<kind>-<time>.
          type: tag.slice("dev-test-".length).replace(/-\d+$/, ""),
          title: String(data.push?.title || "CutSmart"),
          message: String(data.push?.body || ""),
          read: false,
          createdAtIso: new Date().toISOString(),
          testUrl: String(data.push?.url || "") || "/dashboard",
        };
        setNotifToasts((prev) => [test, ...prev.filter((toast) => toast.id !== test.id)].slice(0, 3));
        return;
      }
      const load = loadNotifsNowRef.current;
      event.ports[0]?.postMessage({ shownInApp: Boolean(load) && canPopUpNotifications() });
      load?.();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  const blurTopTabTarget = (target?: EventTarget | null) => {
    const element = target instanceof HTMLElement ? target : null;
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        element?.blur();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });
    }
  };

  // Which slot the dragged tab is over: compared by the tab's own centre (where its ghost is), against
  // the other tabs' centres as they were when it was picked up. Only the tab's sideways position
  // counts — the pointer doesn't have to be over the bar.
  const updateInsertIndexForGhost = (sourceKey: string, ghostCentreX: number) => {
    const remainingLayouts = dragLayoutRef.current.filter((item) => item.groupKey !== sourceKey);
    let nextInsertIndex = remainingLayouts.length;
    for (let index = 0; index < remainingLayouts.length; index += 1) {
      const layout = remainingLayouts[index];
      if (ghostCentreX < layout.left + layout.width / 2) {
        nextInsertIndex = index;
        break;
      }
    }
    setDragInsertIndex(nextInsertIndex);
    setDragOverGroupKey(remainingLayouts[nextInsertIndex]?.groupKey || "");
  };

  // Desktop: the dragged tab's ghost follows the pointer from the moment it's picked up — listening
  // straight away (not once React has re-rendered with the drag state, which missed the first moments
  // of every drag and left it trailing behind), and moved once per frame with a GPU transform. The
  // whole page accepts the drop (so letting go anywhere puts the tab where it's shown), but nothing on
  // the page receives it — the drag is finished in handleGroupDragEnd.
  const followPointerWithGhost = (ghost: HTMLElement, startX: number, sourceKey: string, ghostWidth: number) => {
    stopGhostFollowRef.current?.();
    const baseLeft = startX - dragGhostGrabOffsetXRef.current;
    let pendingX = startX;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const left = pendingX - dragGhostGrabOffsetXRef.current;
      ghost.style.transform = `translate3d(${left - baseLeft}px, 0, 0)`;
      updateInsertIndexForGhost(sourceKey, left + ghostWidth / 2);
    };
    const onMove = (event: DragEvent) => {
      if (event.type === "dragover") {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      }
      // The very last drag event of a drag reports 0,0 — ignore it.
      if (!event.clientX && !event.clientY) return;
      pendingX = event.clientX;
      if (!frame) frame = window.requestAnimationFrame(paint);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    ghost.style.left = `${baseLeft}px`;
    ghost.style.transition = "none";
    ghost.style.willChange = "transform";
    document.addEventListener("drag", onMove, true);
    document.addEventListener("dragover", onMove, true);
    document.addEventListener("drop", onDrop, true);
    stopGhostFollowRef.current = () => {
      document.removeEventListener("drag", onMove, true);
      document.removeEventListener("dragover", onMove, true);
      document.removeEventListener("drop", onDrop, true);
      if (frame) window.cancelAnimationFrame(frame);
      stopGhostFollowRef.current = null;
    };
  };

  // Let go of: the ghost slides from where it was dropped into the tab's place in the row (where the
  // gap was), then the real tab shows again in its place.
  const settleGhostInto = (groupKey: string) => {
    const ghost = customDragGhostRef.current;
    if (!ghost || !groupKey || typeof window === "undefined") {
      removeCustomDragGhost();
      return;
    }
    stopGhostFollowRef.current?.();
    const token = ++settleTokenRef.current;
    setSettlingGroupKey(groupKey);
    const fromLeft = ghost.getBoundingClientRect().left;
    ghost.style.transition = "none";
    ghost.style.transform = "none";
    ghost.style.left = `${fromLeft}px`;
    const finish = () => {
      if (token !== settleTokenRef.current) return;
      setSettlingGroupKey("");
      // Once the real tab is showing again.
      window.requestAnimationFrame(() => {
        if (token === settleTokenRef.current) removeCustomDragGhost();
      });
    };
    // After the row has re-rendered with the tab back in it.
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        if (token !== settleTokenRef.current) return;
        const toLeft = groupNodeRefs.current[groupKey]?.getBoundingClientRect().left;
        if (toLeft === undefined) {
          finish();
          return;
        }
        ghost.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
        ghost.style.transform = `translate3d(${toLeft - fromLeft}px, 0, 0)`;
        window.setTimeout(finish, 240);
      }),
    );
  };

  // Closing a tab with its X: it pops away the same way a button leaving the Quote window's bottom bar
  // does — a copy of it on the spot swells a touch, then shrinks and fades (floating-bar-slot-pop,
  // 180ms) — and only then does the row slide shut over the space it left (300ms), the same order as
  // FloatingBarSlot in the project page. The tab itself is closed straight away; the copy and the
  // space are just left behind for the animation.
  const popAwayClosingTab = (groupKey: string) => {
    const node = groupNodeRefs.current[groupKey];
    const index = scrollableTabGroups.findIndex((group) => group.groupKey === groupKey);
    if (!node || index < 0 || typeof window === "undefined") return;
    const rect = node.getBoundingClientRect();
    if (!rect.width) return;
    const ghost = node.cloneNode(true) as HTMLDivElement;
    ghost.removeAttribute("data-app-tab-group");
    // Its X was just clicked: the copy keeps the red outline that showed while the X was hovered
    // (globals.css).
    ghost.setAttribute("data-closing", "true");
    ghost.classList.add("floating-bar-slot-pop");
    ghost.style.position = "fixed";
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.margin = "0";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "9999";
    ghost.style.transform = "none";
    ghost.style.transition = "none";
    document.body.appendChild(ghost);
    const id = ++closingTabGapIdRef.current;
    setClosingTabGaps((prev) => [...prev, { id, index, width: rect.width, collapsed: false }]);
    closingTabTimersRef.current.push(
      window.setTimeout(() => {
        ghost.remove();
        setClosingTabGaps((prev) => prev.map((gap) => (gap.id === id ? { ...gap, collapsed: true } : gap)));
      }, 180),
      window.setTimeout(() => setClosingTabGaps((prev) => prev.filter((gap) => gap.id !== id)), 180 + 320),
    );
  };

  useEffect(() => {
    const timers = closingTabTimersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  // The tab row with the spaces closed tabs left, each where its tab was (tabNodes: one per
  // scrollableTabGroups entry). A space slides shut by its width, and by the row's 6px gap (gap-1.5)
  // next to it, so nothing's left once it's gone.
  const withClosingTabGaps = (tabNodes: ReactNode[]) => {
    if (!closingTabGaps.length) return tabNodes;
    const renderGap = (gap: (typeof closingTabGaps)[number]) => (
      <div
        key={`closing-tab-gap-${gap.id}`}
        aria-hidden="true"
        className="h-9 shrink-0"
        style={{
          width: gap.collapsed ? 0 : gap.width,
          marginRight: gap.collapsed ? -6 : 0,
          transition: "width 300ms ease-in-out, margin-right 300ms ease-in-out",
        }}
      />
    );
    const out: ReactNode[] = [];
    tabNodes.forEach((node, index) => {
      closingTabGaps.filter((gap) => gap.index === index).forEach((gap) => out.push(renderGap(gap)));
      out.push(node);
    });
    closingTabGaps.filter((gap) => gap.index >= tabNodes.length).forEach((gap) => out.push(renderGap(gap)));
    return out;
  };

  // A new drag while the last one is still sliding into place: that one just finishes.
  const cancelSettle = () => {
    settleTokenRef.current += 1;
    setSettlingGroupKey("");
    removeCustomDragGhost();
  };

  // Ends a drag (desktop or touch): puts the tab where it was shown (commit), or back where it was,
  // then slides it into place.
  const finishTabDrag = (sourceKey: string, commit: boolean) => {
    stopGhostFollowRef.current?.();
    if (commit && sourceKey && dragInsertIndex !== null) {
      reorderGroupToIndex(sourceKey, dragInsertIndex);
    }
    setDraggedGroupKey("");
    setDragOverGroupKey("");
    setDragInsertIndex(null);
    setDraggedGroupWidth(0);
    setCollapsedDraggedGroupKey("");
    setPressedGroupKey("");
    dragLayoutRef.current = [];
    settleGhostInto(sourceKey);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const clearPressedGroup = () => setPressedGroupKey("");
    window.addEventListener("mouseup", clearPressedGroup);
    window.addEventListener("dragend", clearPressedGroup);
    return () => {
      window.removeEventListener("mouseup", clearPressedGroup);
      window.removeEventListener("dragend", clearPressedGroup);
    };
  }, []);

  const handleTopTabMouseDown = (groupKey: string, event: React.MouseEvent<HTMLButtonElement>) => {
    setPressedGroupKey(String(groupKey || "").trim());
    blurTopTabTarget(event.currentTarget);
  };

  const handleAuxButtonMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    blurTopTabTarget(event.currentTarget);
  };

  const handleGroupDragStart = (groupKey: string, event: ReactDragEvent<HTMLElement>) => {
    const normalizedGroupKey = String(groupKey || "").trim();
    if (!normalizedGroupKey) return;
    cancelSettle();
    setDraggedGroupKey(normalizedGroupKey);
    setDragOverGroupKey(normalizedGroupKey);
    const groupNode = groupNodeRefs.current[normalizedGroupKey];
    const groupRect = groupNode?.getBoundingClientRect();
    setDraggedGroupWidth(groupRect?.width ? Math.round(groupRect.width) : 0);
    dragLayoutRef.current = scrollableTabGroups
      .map((group) => {
        const node = groupNodeRefs.current[group.groupKey];
        const rect = node?.getBoundingClientRect();
        return rect
          ? {
              groupKey: group.groupKey,
              left: rect.left,
              width: rect.width,
            }
          : null;
      })
      .filter(Boolean) as Array<{ groupKey: string; left: number; width: number }>;
    setIsAppTabsMenuOpen("");
    setAppTabsMenuPos(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", normalizedGroupKey);
    setDragShiftAnimated(false);
    setDragInsertIndex(Math.max(0, scrollableTabGroups.findIndex((group) => group.groupKey === normalizedGroupKey)));
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        setCollapsedDraggedGroupKey(normalizedGroupKey);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => setDragShiftAnimated(true)));
      });
    } else {
      setCollapsedDraggedGroupKey(normalizedGroupKey);
      setDragShiftAnimated(true);
    }
    if (groupNode && groupRect) {
      // Suppress the browser's native drag-image entirely (it always tracks the
      // cursor's real X *and* Y, which reads as the tab bobbing up and down).
      // Instead we render our own fixed-top clone below and slide it by X only,
      // driven from clientX on dragover — the row's Y position never moves.
      const emptyDragImage = new Image();
      emptyDragImage.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7";
      event.dataTransfer.setDragImage(emptyDragImage, 0, 0);

      const ghost = groupNode.cloneNode(true) as HTMLDivElement;
      ghost.style.position = "fixed";
      ghost.style.left = `${Math.round(groupRect.left)}px`;
      ghost.style.top = `${Math.round(groupRect.top)}px`;
      ghost.style.width = `${Math.round(groupRect.width)}px`;
      ghost.style.height = `${Math.round(groupRect.height)}px`;
      ghost.style.margin = "0";
      ghost.style.pointerEvents = "none";
      ghost.style.zIndex = "9999";
      ghost.style.transform = "none";
      ghost.style.opacity = "0.92";
      document.body.appendChild(ghost);
      customDragGhostRef.current = ghost;
      dragGhostGrabOffsetXRef.current = event.clientX - groupRect.left;
      followPointerWithGhost(ghost, event.clientX, normalizedGroupKey, groupRect.width);
    }
  };

  const removeCustomDragGhost = () => {
    stopGhostFollowRef.current?.();
    customDragGhostRef.current?.remove();
    customDragGhostRef.current = null;
  };

  // The drop itself is caught page-wide while a tab is dragged (followPointerWithGhost), so these only
  // keep the tab row a valid place to drop; the drag is finished by handleGroupDragEnd.
  const handleGroupDrop = (_groupKey: string, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
  };

  // Escape, or letting go outside the window, cancels (dropEffect "none") — the tab goes back where it
  // was; anywhere else, it goes where it's shown.
  const handleGroupDragEnd = (event: ReactDragEvent<HTMLElement>) => {
    finishTabDrag(draggedGroupKey, event.dataTransfer?.dropEffect !== "none");
  };

  const handleTabsStripDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggedGroupKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleTabsStripDragLeave = () => {
    // Leaving the bar doesn't matter — where the tab goes follows the tab itself (see
    // updateInsertIndexForGhost), not the pointer.
  };

  const handleTabsStripDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggedGroupKey) return;
    event.preventDefault();
  };

  const getRemainingGroupIndex = (groupKey: string) => {
    const remainingKeys = scrollableTabGroups
      .map((group) => group.groupKey)
      .filter((key) => key !== draggedGroupKey);
    return remainingKeys.indexOf(groupKey);
  };

  const getDraggedGroupShiftX = (groupKey: string) => {
    if (!draggedGroupKey || dragInsertIndex === null || draggedGroupWidth <= 0 || groupKey === draggedGroupKey) {
      return 0;
    }
    const remainingIndex = getRemainingGroupIndex(groupKey);
    if (remainingIndex < 0) {
      return 0;
    }
    return remainingIndex >= dragInsertIndex ? draggedGroupWidth + 4 : 0;
  };

  // Touch equivalent of handleGroupDragStart — same ghost-clone/dragLayoutRef setup, just sourced
  // from a touch point instead of a native DragEvent (which never arrives on mobile at all).
  const beginMobileTabDrag = (groupKey: string, touch: { clientX: number; clientY: number }) => {
    cancelSettle();
    const groupNode = groupNodeRefs.current[groupKey];
    const groupRect = groupNode?.getBoundingClientRect();
    if (!groupNode || !groupRect) return;
    setDraggedGroupKey(groupKey);
    setDragOverGroupKey(groupKey);
    setDraggedGroupWidth(Math.round(groupRect.width));
    dragLayoutRef.current = scrollableTabGroups
      .map((group) => {
        const node = groupNodeRefs.current[group.groupKey];
        const rect = node?.getBoundingClientRect();
        return rect ? { groupKey: group.groupKey, left: rect.left, width: rect.width } : null;
      })
      .filter(Boolean) as Array<{ groupKey: string; left: number; width: number }>;
    setIsAppTabsMenuOpen("");
    setAppTabsMenuPos(null);
    // No requestAnimationFrame delay here (unlike the desktop path) — that delay exists only to
    // let the browser's native drag-image snapshot capture the element before it collapses; touch
    // dragging has no native drag image, and the clone below is taken synchronously from the still-
    // uncollapsed DOM regardless of when the collapse state actually re-renders.
    setDragShiftAnimated(false);
    setDragInsertIndex(Math.max(0, scrollableTabGroups.findIndex((group) => group.groupKey === groupKey)));
    setCollapsedDraggedGroupKey(groupKey);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setDragShiftAnimated(true)));
    dragGhostGrabOffsetXRef.current = touch.clientX - groupRect.left;
    const ghost = groupNode.cloneNode(true) as HTMLDivElement;
    ghost.style.position = "fixed";
    ghost.style.left = `${Math.round(groupRect.left)}px`;
    ghost.style.top = `${Math.round(groupRect.top)}px`;
    ghost.style.width = `${Math.round(groupRect.width)}px`;
    ghost.style.height = `${Math.round(groupRect.height)}px`;
    ghost.style.margin = "0";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "9999";
    ghost.style.transform = "none";
    ghost.style.opacity = "0.92";
    document.body.appendChild(ghost);
    customDragGhostRef.current = ghost;
    if (typeof document !== "undefined") document.body.style.touchAction = "none";
  };

  const onTabTouchStart = (groupKey: string, event: ReactTouchEvent<HTMLButtonElement>) => {
    if (isDesktopViewport) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (mobileTabTouchRef.current?.longPressTimer) {
      clearTimeout(mobileTabTouchRef.current.longPressTimer);
    }
    const state: NonNullable<typeof mobileTabTouchRef.current> = {
      groupKey,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      longPressTimer: null,
      dragging: false,
      eligible: true,
    };
    state.longPressTimer = setTimeout(() => {
      const current = mobileTabTouchRef.current;
      if (!current || current.groupKey !== groupKey || !current.eligible || current.dragging) return;
      current.dragging = true;
      beginMobileTabDrag(groupKey, { clientX: current.lastX, clientY: touch.clientY });
    }, MOBILE_TAB_LONG_PRESS_MS);
    mobileTabTouchRef.current = state;
  };

  const onTabTouchMove = (event: ReactTouchEvent<HTMLButtonElement>) => {
    const state = mobileTabTouchRef.current;
    if (!state) return;
    const touch = event.touches[0];
    if (!touch) return;
    state.lastX = touch.clientX;
    if (!state.dragging) {
      // Moved before the long-press fired — this is a scroll/tap, not a pick-up. Cancel the timer
      // and leave the touch alone (no preventDefault) so the strip's own horizontal touch-scroll
      // keeps working exactly as if this handler weren't here.
      const dx = Math.abs(touch.clientX - state.startX);
      const dy = Math.abs(touch.clientY - state.startY);
      if (dx > MOBILE_TAB_MOVE_CANCEL_PX || dy > MOBILE_TAB_MOVE_CANCEL_PX) {
        state.eligible = false;
        if (state.longPressTimer) {
          clearTimeout(state.longPressTimer);
          state.longPressTimer = null;
        }
      }
      return;
    }
    event.preventDefault();
    const ghost = customDragGhostRef.current;
    if (ghost) {
      ghost.style.left = `${touch.clientX - dragGhostGrabOffsetXRef.current}px`;
    }
    const remainingLayouts = dragLayoutRef.current.filter((item) => item.groupKey !== state.groupKey);
    if (!remainingLayouts.length) {
      setDragOverGroupKey("");
      setDragInsertIndex(0);
      return;
    }
    const clientX = touch.clientX - dragGhostGrabOffsetXRef.current + draggedGroupWidth / 2;
    let nextInsertIndex = remainingLayouts.length;
    for (let index = 0; index < remainingLayouts.length; index += 1) {
      const layout = remainingLayouts[index];
      const midpoint = layout.left + layout.width / 2;
      if (clientX < midpoint) {
        nextInsertIndex = index;
        break;
      }
    }
    setDragInsertIndex(nextInsertIndex);
    const nextGroupKey = remainingLayouts[nextInsertIndex]?.groupKey || "";
    setDragOverGroupKey(nextGroupKey || "");
  };

  const endMobileTabDrag = (commit: boolean) => {
    const state = mobileTabTouchRef.current;
    mobileTabTouchRef.current = null;
    if (typeof document !== "undefined") document.body.style.touchAction = "";
    if (!state) return;
    if (state.longPressTimer) clearTimeout(state.longPressTimer);
    if (!state.dragging) return;
    suppressNextTabClickRef.current = state.groupKey;
    finishTabDrag(state.groupKey, commit);
  };

  const onTabTouchEnd = () => endMobileTabDrag(true);
  const onTabTouchCancel = () => endMobileTabDrag(false);

  const selectAppTab = (tab: AppWorkspaceTab, target?: EventTarget | null) => {
    blurTopTabTarget(target);
    pendingActiveAppTabKeyMemory = tab.key;
    setPendingActiveAppTabKey(tab.key);
    setIsAppTabsMenuOpen("");
    setAppTabsMenuPos(null);
    if (tab.scopeKey === currentScopeKey) {
      const action = actionsByKey[tab.key];
      if (action?.onSelect) {
        action.onSelect();
        return;
      }
    }
    router.push(tab.href);
  };

  // Opening a project's tab quickly: its page's code is fetched ahead for every open tab (below), and its
  // project starts loading the moment the tab is pointed at or touched — the project page picks that up
  // (prefetchProjectById in lib/firestore-data.ts) instead of only starting once it's open.
  const warmProjectTab = (groupKey: string) => {
    const projectId = groupKey.startsWith("project:") ? groupKey.slice("project:".length) : "";
    if (!projectId || !user?.uid) return;
    let storedCompanyId = "";
    try {
      storedCompanyId = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
    } catch {
      // No stored company — the user's own is looked up.
    }
    prefetchProjectById(projectId, user.uid, [storedCompanyId, String(user.companyId || "").trim()].filter(Boolean));
  };

  // Each open tab's page, fetched ahead (its code and route), so opening it doesn't wait on that.
  const tabPrefetchKey = scrollableTabGroups
    .map((group) => (group.tabs.find((tab) => tab.active) ?? group.tabs[0])?.href ?? "")
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    if (!tabPrefetchKey) return;
    tabPrefetchKey.split("|").forEach((href) => router.prefetch(href));
  }, [tabPrefetchKey, router]);

  // Clicking a project's tab reopens whichever sub-view (Sales > Initial Cutlist, Production >
  // Nesting, etc.) that project was last left on, rather than always jumping to General — same
  // priority as the `activeTab` used for the tab's own label/title below: prefer the tab actually
  // marked as the current route, then whichever one the project page itself flagged `active`
  // (its own last-active-view bookkeeping), falling back to the first tab only if neither exists.
  const selectGroupPrimaryTab = (group: (typeof groupedGlobalTabs)[number], target?: EventTarget | null) => {
    const lastActiveTab =
      group.tabs.find((tab) => tab.key === displayActiveAppTabKey) ??
      group.tabs.find((tab) => tab.active) ??
      group.tabs[0];
    if (lastActiveTab) {
      selectAppTab(lastActiveTab, target);
      return;
    }
    blurTopTabTarget(target);
    pendingActiveAppTabKeyMemory = "";
    setPendingActiveAppTabKey("");
    setIsAppTabsMenuOpen("");
    setAppTabsMenuPos(null);
    const projectId = group.groupKey.startsWith("project:") ? group.groupKey.slice("project:".length) : "";
    router.push(projectId ? `/projects/${projectId}?tab=general` : "/dashboard");
  };

  // Closes a tab/tab-group immediately on its own X click — no confirm dialog, always saving first
  // (matches what "Save & Close" used to do; the discard option this replaced was unreachable from
  // this button anyway, since both paths that could fire from it already bypassed save/discard
  // entirely below).
  const closeAppTab = (tabKey: string) => {
    const isClosingScope = tabKey.startsWith(CLOSING_SCOPE_PREFIX);
    const closingScopeKey = isClosingScope ? tabKey.slice(CLOSING_SCOPE_PREFIX.length) : "";
    const closingTab = isClosingScope
      ? visibleGlobalAppTabs.find((tab) => tab.scopeKey === closingScopeKey && tab.key === displayActiveAppTabKey) ??
        visibleGlobalAppTabs.find((tab) => tab.scopeKey === closingScopeKey)
      : visibleGlobalAppTabs.find((tab) => tab.key === tabKey);
    if (!closingTab) {
      setIsAppTabsMenuOpen("");
      setAppTabsMenuPos(null);
      return;
    }
    const scopedTabs = visibleGlobalAppTabs.filter((tab) => tab.scopeKey === closingTab.scopeKey);
    const isClosingCurrentScope = closingTab.scopeKey === currentScopeKey;
    if (isClosingScope || (isClosingCurrentScope && scopedTabs.length === 1)) {
      setHiddenScopeKeys((prev) => (prev.includes(closingTab.scopeKey) ? prev : [...prev, closingTab.scopeKey]));
      suppressScope(closingTab.scopeKey);
      pendingActiveAppTabKeyMemory = "";
      setPendingActiveAppTabKey("");
      setIsAppTabsMenuOpen("");
      setAppTabsMenuPos(null);
      // Closing a tab only closes it — it never opens another one. Only when it's the page being looked at
      // does that page have to go, and then it's for the Dashboard. (The page saves as it's left, as always.)
      if (isClosingCurrentScope) router.push("/dashboard");
      return;
    }
    if (closingTab && isClosingCurrentScope) {
      suppressTab(tabKey);
      actionsByKey[tabKey]?.onCloseSave?.();
    } else {
      closeTab(tabKey);
    }
    if (!isClosingScope && tabKey === pendingActiveAppTabKey) {
      pendingActiveAppTabKeyMemory = "";
      setPendingActiveAppTabKey("");
    }
    setIsAppTabsMenuOpen("");
    setAppTabsMenuPos(null);
  };

  // Deliberately no "hide while this page's data is still loading" gate here anymore — that used to
  // hide-then-reshow the bar on almost every navigation (any route with a real data fetch), which
  // read as a visible flash/reload despite never actually remounting. The sidebar (app-shell.tsx)
  // never does this — it just stays mounted and visible continuously — so the bar now matches that:
  // always rendered whenever there's an authenticated user with tabs to show, full stop.
  //
  // Without the `!user` check specifically, tabs rehydrated from localStorage (lib/app-tabs-context's
  // own persistence) would survive a logout/session-expiry and render right over the login screen —
  // this component has no other way to know whether the app underneath it is actually open versus
  // just showing the login form.
  //
  // The pathname check covers a narrower, confirmed gap that check alone doesn't: app/page.tsx keeps
  // showing its own "Opening your workspace..." splash (shouldHoldLoginScreen) for a beat AFTER `user`
  // already resolves truthy, while it resolves which company to route to — during exactly that window,
  // `!user` is already false, so leftover tabs rehydrated from a previous session would otherwise pop
  // this bar in right over that splash screen, before the app (and its sidebar) has actually opened.
  // The tab bar is only ever meaningful inside the authenticated (app) routes to begin with, so simply
  // never showing it on the pre-app "/" (or "/company-onboarding") routes closes that gap directly,
  // without needing any new readiness signal threaded in from those pages.
  // "/client/..." is the public, no-login client hub page (app/client/hub/[shareId]) —
  // if a signed-in staff member opens the link themselves (e.g. to preview it), this bar must
  // still stay hidden rather than rendering internal app chrome on top of a page an external
  // client might also be looking at.
  const isPreAppRoute = pathname === "/" || pathname === "/company-onboarding" || pathname.startsWith("/client/");
  if (!user || !groupedGlobalTabs.length || chromeHidden || isPreAppRoute) {
    return null;
  }

  // Shared between the desktop anchored dropdown and the mobile full-screen panel — same rows,
  // same click behavior, just presented inside a differently shaped container.
  // "app_version" notifications are created (app-shell.tsx) with the full changelog "whatsNew"
  // body as their message — fine for the changelog page itself, but far too much to show in this
  // small dropdown row. The version number is the only part of that notification worth showing
  // here; it's parsed back out of the title (created as `New version ${version}`) rather than
  // needing a schema change, so this also cleans up historical notifications already in Firestore.
  const appVersionFromNotifTitle = (title: string) => String(title || "").replace(/^New version\s*/i, "").trim();
  // Its icon (see NOTIF_TYPE_ICONS) and title — a new version's as "New version 1.2.3".
  const notifIconOf = (row: UserNotificationRow): LucideIcon =>
    NOTIF_TYPE_ICONS[String(row.type ?? "")] ?? NOTIF_CATEGORY_ICONS[pushNotificationCategoryOf(row.type)] ?? Bell;
  const notifTitleOf = (row: UserNotificationRow) =>
    row.type === "app_version" ? `New version ${appVersionFromNotifTitle(row.title)}` : row.title || "Notification";
  // Opening one (its row in the list, or its pop-up): it's read, and to what it's about.
  const openNotification = (row: UserNotificationRow) => {
    if (!user?.uid) return;
    setNotifRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, read: true } : item)));
    void markUserNotificationRead(user.uid, row.id);
    setIsNotifOpen(false);
    if (row.type === "app_version") {
      // Straight to that version's What's New page, over whatever page this is.
      openWhatsNew(appVersionFromNotifTitle(row.title));
    } else if (row.type === "calendar_reminder" && row.eventId) {
      router.push(`/calendar?event=${encodeURIComponent(row.eventId)}`);
    } else if (row.projectId) {
      router.push(`/projects/${row.projectId}`);
    } else if (String(row.type || "").startsWith("lead_")) {
      router.push("/leads");
    }
  };

  // ---- A notification's menu.
  // Where it opens: at the pointer / finger, kept on screen (a phone's or tablet's is a little bigger).
  function openNotifMenu(row: UserNotificationRow, x: number, y: number) {
    const big = window.matchMedia("(max-width: 1023px)").matches;
    const width = big ? 272 : 244;
    const height = big ? 330 : 270;
    const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
    const top = y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y;
    setNotifMenu({ row, left, top, width });
  }
  function startNotifLongPress(row: UserNotificationRow, event: ReactTouchEvent) {
    const touch = event.touches[0];
    if (!touch || event.touches.length !== 1) return;
    const x = touch.clientX;
    const y = touch.clientY;
    const timer = window.setTimeout(() => {
      notifLongPressRef.current = null;
      suppressNotifClickRef.current = row.id;
      openNotifMenu(row, x, y);
    }, 480);
    notifLongPressRef.current = { timer, x, y };
  }
  function moveNotifLongPress(event: ReactTouchEvent) {
    const press = notifLongPressRef.current;
    const touch = event.touches[0];
    if (!press || !touch) return;
    if (Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > 10) endNotifLongPress();
  }
  function endNotifLongPress() {
    const press = notifLongPressRef.current;
    if (press) window.clearTimeout(press.timer);
    notifLongPressRef.current = null;
  }
  function setNotifRead(row: UserNotificationRow, read: boolean) {
    setNotifMenu(null);
    if (!user?.uid) return;
    setNotifRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, read } : item)));
    void setUserNotificationRead(user.uid, row.id, read);
  }
  function clearNotif(row: UserNotificationRow) {
    setNotifMenu(null);
    if (!user?.uid) return;
    setNotifRows((prev) => prev.filter((item) => item.id !== row.id));
    void deleteUserNotification(user.uid, row.id);
  }
  // Remind me in…: gone from the list until then, then back as new and unread — and sent to their
  // phone/desktop again then (the scheduled job).
  function remindNotifLater(row: UserNotificationRow) {
    setNotifMenu(null);
    const uid = user?.uid;
    if (!uid) return;
    const dueAtMs = Date.now() + remindAmount * REMIND_UNITS[remindUnit].ms;
    setNotifRows((prev) => prev.filter((item) => item.id !== row.id));
    // Gone until it's due, so it pops up as new then (see the polling's seenNotifIdsRef).
    seenNotifIdsRef.current?.delete(row.id);
    void snoozeUserNotification(uid, row.id, new Date(dueAtMs).toISOString()).then((ok) => {
      if (ok) requestNotificationReminderPush(row.id, dueAtMs);
    });
  }
  const remindMax = REMIND_UNITS[remindUnit].max;
  const remindLabel = `${remindAmount} ${remindAmount === 1 ? REMIND_UNITS[remindUnit].one : REMIND_UNITS[remindUnit].many}`;

  // Each one: its category's icon, its title, its message (two lines at most) and how long ago under them,
  // and a blue dot on the right while it's unread — no lines between them; a soft rounded highlight on hover.
  // Phones and tablets (the full-screen panel, below lg) get them a little bigger.
  // Dev mode only — "test in [5] s": after that many seconds, a real notification (a random kind, with made-up
  // details — lib/push-dev-test.ts) is added to their own list, the same way any other one is: on the bell, in
  // the list, popped up on a computer, and to their phone/desktop if that's on. Counts down meanwhile (closing
  // Notifications doesn't stop it — on a computer, close it to see the pop-up). Marked as a test, so it's gone
  // once it's been seen (removeDevTestNotification).
  function startDevNotifTest() {
    const uid = user?.uid;
    if (!uid) return;
    if (devTestTimerRef.current) window.clearTimeout(devTestTimerRef.current);
    let secondsLeft = Math.min(600, Number.parseInt(devTestSecondsText, 10) || 0);
    const tick = () => {
      if (secondsLeft <= 0) {
        devTestTimerRef.current = null;
        setDevTestSecondsLeft(null);
        const kind = DEV_TEST_LIST_KINDS[Math.floor(Math.random() * DEV_TEST_LIST_KINDS.length)] ?? "other";
        const sample = devTestListSample(kind);
        if (!sample) return;
        void addUserNotification(uid, { ...sample, type: kind, companyId: activeCompanyId || undefined, devTest: true }).then((ok) => {
          // Straight into the list (and popped up), rather than at the next check.
          if (ok) loadNotifsNowRef.current?.();
        });
        return;
      }
      setDevTestSecondsLeft(secondsLeft);
      secondsLeft -= 1;
      devTestTimerRef.current = window.setTimeout(tick, 1000);
    };
    tick();
  }
  function renderDevNotifTest() {
    if (!isDevModeOn) return null;
    const waiting = devTestSecondsLeft !== null;
    const devStyle = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" };
    return (
      <div className="mx-4 mb-1 flex shrink-0 items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
        <span>dev · test in</span>
        <input
          type="text"
          inputMode="numeric"
          value={devTestSecondsText}
          onChange={(e) => setDevTestSecondsText(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !waiting) {
              e.preventDefault();
              startDevNotifTest();
            }
          }}
          disabled={waiting}
          aria-label="Test notification in how many seconds"
          className={`w-[38px] text-center outline-none ${devButtonClass(true)}`}
          style={devStyle}
        />
        <span>s</span>
        <button type="button" onClick={startDevNotifTest} disabled={waiting} className={devButtonClass(true)} style={devStyle}>
          {waiting ? `in ${devTestSecondsLeft}s` : "send"}
        </button>
      </div>
    );
  }

  function renderNotifRows() {
    // Still loading: a few faint rows the shape of the real ones.
    if (!isNotifListLoaded && notifRows.length === 0) {
      return (
        <div className="space-y-0.5 p-2" aria-busy="true" aria-label="Loading notifications">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-start gap-3 rounded-[14px] px-2.5 py-2.5 max-lg:px-3 max-lg:py-3">
              <span className="h-9 w-9 shrink-0 animate-pulse rounded-full max-lg:h-10 max-lg:w-10" style={{ backgroundColor: NOTIF_ICON_BG }} />
              <span className="min-w-0 flex-1 space-y-2 pt-1.5">
                <span className="block h-3 w-3/5 animate-pulse rounded-full" style={{ backgroundColor: NOTIF_ICON_BG }} />
                <span className="block h-2.5 w-4/5 animate-pulse rounded-full" style={{ backgroundColor: NOTIF_ICON_BG }} />
              </span>
            </div>
          ))}
        </div>
      );
    }
    if (notifRows.length === 0) {
      return (
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: NOTIF_ICON_BG, color: "var(--text-muted)" }}>
            <Bell size={18} />
          </span>
          <p className="text-[14px] font-medium" style={{ color: "var(--text-main)" }}>You&apos;re all caught up</p>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-muted)" }}>New notifications will show up here.</p>
          {renderLoadOlderNotifs()}
        </div>
      );
    }
    return (
      <div className="space-y-0.5 p-2">
        {notifRows.map((row) => {
      const isAppVersion = row.type === "app_version";
      const appVersion = isAppVersion ? appVersionFromNotifTitle(row.title) : "";
      const Icon = notifIconOf(row);
      return (
        <button
          key={row.id}
          type="button"
          onMouseDown={handleAuxButtonMouseDown}
          onContextMenu={(event) => {
            event.preventDefault();
            endNotifLongPress();
            openNotifMenu(row, event.clientX, event.clientY);
          }}
          onTouchStart={(event) => startNotifLongPress(row, event)}
          onTouchMove={moveNotifLongPress}
          onTouchEnd={endNotifLongPress}
          onTouchCancel={endNotifLongPress}
          onClick={() => {
            // Letting go of a press-and-hold (its menu's open) isn't a tap on it.
            if (suppressNotifClickRef.current === row.id) {
              suppressNotifClickRef.current = "";
              return;
            }
            openNotification(row);
          }}
          className="flex w-full items-start gap-3 rounded-[14px] px-2.5 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] max-lg:px-3 max-lg:py-3"
          // Press and hold opens its menu, not the phone's own text selection / callout.
          style={{
            WebkitTouchCallout: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
            backgroundColor: notifMenu?.row.id === row.id ? "color-mix(in srgb, var(--text-main) 6%, transparent)" : undefined,
          }}
        >
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full max-lg:h-10 max-lg:w-10"
            style={{ backgroundColor: NOTIF_ICON_BG, color: "var(--text-main)" }}
          >
            <Icon size={16} />
          </span>
          <span className="min-w-0 flex-1 pt-0.5">
            <span
              className={`block truncate text-[13.5px] max-lg:text-[15px] ${row.read ? "font-medium" : "font-semibold"}`}
              style={{ color: "var(--text-main)" }}
            >
              {!row.read ? <span className="sr-only">Unread: </span> : null}
              {isAppVersion ? `New version ${appVersion}` : row.title || "Notification"}
            </span>
            {!isAppVersion && row.message ? (
              <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug max-lg:text-[13.5px]" style={{ color: "var(--text-muted)" }}>
                {row.message}
              </span>
            ) : null}
            {/* How long ago, under the text. */}
            <span className="mt-1 block text-[11.5px] max-lg:text-[12.5px]" style={{ color: "var(--text-muted)", opacity: 0.8 }} title={formatNotificationTime(row.createdAtIso)}>
              {relativeNotifTime(row.createdAtIso)}
            </span>
          </span>
          {/* Unread: a blue dot on the right, centred on the row. */}
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 self-center rounded-full"
            style={{ backgroundColor: row.read ? "transparent" : "var(--brand)" }}
          />
        </button>
      );
        })}
        {renderLoadOlderNotifs()}
      </div>
    );
  }

  // At the bottom of the list, while there are older notifications than it reaches back to: the two weeks before.
  function renderLoadOlderNotifs() {
    if (!notifHasOlder) return null;
    return (
      <div className="flex justify-center px-2 pb-2 pt-3">
        <button
          type="button"
          onMouseDown={handleAuxButtonMouseDown}
          onClick={() => void loadOlderNotifs()}
          disabled={isLoadingOlderNotifs}
          className="inline-flex h-9 items-center justify-center rounded-full border px-4 text-[12.5px] font-medium transition hover:brightness-95 disabled:opacity-60 max-lg:h-10 max-lg:text-[13.5px]"
          style={{ borderColor: "var(--glass-border)", backgroundColor: NOTIF_ICON_BG, color: "var(--text-main)" }}
        >
          {isLoadingOlderNotifs ? "Loading…" : "Load more"}
        </button>
      </div>
    );
  }

  return (
    <>
      {notifToasts.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <div aria-live="polite" className="pointer-events-none fixed right-4 top-[60px] z-[1500] flex w-[340px] flex-col gap-2">
              {notifToasts.map((row) => (
                <NotifToast
                  key={row.id}
                  icon={notifIconOf(row)}
                  title={notifTitleOf(row)}
                  message={row.type === "app_version" ? "" : row.message || ""}
                  bellRef={notifBtnRef}
                  onOpen={() => {
                    if (row.testUrl) router.push(row.testUrl);
                    else openNotification(row);
                  }}
                  onDone={() => {
                    setNotifToasts((prev) => prev.filter((toast) => toast.id !== row.id));
                    // A test, seen now — gone.
                    if (!row.testUrl && isDevTestNotification(row)) removeDevTestNotification(row.id);
                  }}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
      <div
        data-app-top-bar="true"
        className="app-top-bar-sidebar-offset fixed left-0 right-0 top-0 z-[95] h-12 px-2"
        style={{ color: shellPalette.text }}
      >
        {/* The bar's glass: see-through at the top of a page, fading in once the page scrolls under
            it (isPageScrolledUnder) — and while the phone pull-down menu is open (app-shell.tsx
            marks the bar data-pulling; see globals.css). Its own layer, so the bar's height can
            still be changed by that pull-down without touching this fade. */}
        <div
          data-app-top-bar-glass="true"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundColor: shellPalette.stripBg,
            backdropFilter: "blur(12px) saturate(220%)",
            WebkitBackdropFilter: "blur(12px) saturate(220%)",
            // No var(--shadow-glass) here — it's a downward drop-shadow (0 8px 32px) that bleeds
            // into whatever sits directly below this fixed bar on every page, reading as a visible
            // gap even when the content below is genuinely flush against it.
            boxShadow: `inset 0 1px 0 ${shellPalette.stripHighlight}`,
            opacity: isPageScrolledUnder ? 1 : 0,
            transition: "opacity 240ms ease",
          }}
        />
        {/* Rendered as its own layer (not a border on this container) so the active
            tab's connector/notch pieces below can reliably paint over it via normal
            DOM-order stacking, instead of depending on an ancestor's own border layer.
            Only with the glass — at the top of a page there's no line under the bar. */}
        <div
          data-app-top-bar-glass="true"
          data-app-top-bar-line="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{ backgroundColor: "var(--glass-border)", opacity: isPageScrolledUnder ? 1 : 0, transition: "opacity 240ms ease" }}
        />
        {/* data-app-top-bar-content, separate from the outer bar's own data-app-top-bar — the
            pulldown gesture (app-shell.tsx) fades THIS (hamburger/tabs/bell) out while leaving
            the outer bar's own background/blur/border fully visible and growing its height, so
            the persistent bar surface never disappears — only its content swaps out for the
            pulldown menu's own icons, which fade in on top of the same bar. */}
        <div ref={appTabsMenuRef} data-app-top-bar-content="true" className="relative flex h-full items-center gap-1.5">
          {/* Mobile-only — this bar is now the ONLY sticky header on phones (the separate
              hamburger/logo header app-shell.tsx used to render below it was removed), so the
              menu button that used to live there is folded in here instead, at the same leading
              position the Dashboard pill occupies on larger screens (see its `lg:flex` below). */}
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            onMouseDown={handleAuxButtonMouseDown}
            className="mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] lg:hidden"
            style={{ color: shellPalette.textMuted }}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          {dashboardTabGroup ? (
            // Hidden below `lg` — that's exactly where app-shell.tsx swaps the persistent sidebar
            // for its own hamburger + drawer nav (Dashboard link included there instead), so this
            // never leaves Dashboard unreachable; it just frees up the tab row's limited width for
            // project tabs on the same screens that already lost the sidebar.
            <div className="hidden h-full shrink-0 items-center pr-2.5 mr-1 lg:flex">
              {(() => {
                const group = dashboardTabGroup;
                const onlyTab = group.tabs[0];
                if (!onlyTab) return null;
                const isActiveTab = onlyTab.key === displayActiveAppTabKey;
                return (
                  <button
                    type="button"
                    onClick={(event) => selectAppTab(onlyTab, event.currentTarget)}
                    onMouseDown={handleAuxButtonMouseDown}
                    // The tabs' hover look (globals.css) — only on hover here, never kept while it's open.
                    data-app-top-tab="true"
                    className="relative isolate inline-flex h-9 min-w-[100px] max-w-[200px] shrink-0 items-center gap-2 rounded-full px-4 text-left text-[12px] font-bold transition-colors"
                    style={{
                      backgroundColor: isActiveTab ? shellPalette.panelBg : shellPalette.tabIdleBg,
                      boxShadow: isActiveTab ? "none" : "var(--shadow-sm)",
                      color: isActiveTab ? shellPalette.text : shellPalette.textMuted,
                    }}
                    title={formatSingleTabLabel(onlyTab, group.groupLabel)}
                  >
                    <LayoutDashboard size={14} />
                    <span className="truncate">{formatSingleTabLabel(onlyTab, group.groupLabel)}</span>
                  </button>
                );
              })()}
            </div>
          ) : null}
          <div
            ref={topTabsStripRef}
            data-app-tabs-strip="1"
            onDragOver={handleTabsStripDragOver}
            onDragLeave={handleTabsStripDragLeave}
            onDrop={handleTabsStripDrop}
            // hide-native-scrollbar: never shows a scrollbar (width or height) here either way.
            // Mobile keeps overflow-x-auto so the strip is still pull/swipe-scrollable by touch;
            // desktop's own tabs shrink to fit instead (see their shrink/min-w below), with
            // overflow-x-auto left on only as a defensive fallback if that floor is ever hit.
            className="hide-native-scrollbar flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden"
          >
            {withClosingTabGaps(scrollableTabGroups.map((group) => {
              // Which sub-view represents this project's tab: whichever one is the current route,
              // else whichever one the project page itself flagged `active` (its own last-active-
              // view bookkeeping — this is what makes clicking the tab reopen wherever the user
              // left off, e.g. Sales > Initial Cutlist or Production > Nesting, instead of always
              // landing on General), else just the first.
              const activeTab =
                group.tabs.find((tab) => tab.key === displayActiveAppTabKey) ??
                group.tabs.find((tab) => tab.active) ??
                group.tabs[0];
              if (!activeTab) return null;
              const isActiveTab = group.tabs.some((tab) => tab.key === displayActiveAppTabKey);
              const isDragActive = draggedGroupKey === group.groupKey;
              const isCollapsedDragSource = collapsedDraggedGroupKey === group.groupKey;
              const groupShiftX = getDraggedGroupShiftX(group.groupKey);
              const isPressed = pressedGroupKey === group.groupKey || isDragActive;
              return (
                <div
                  key={group.groupKey}
                  ref={(node) => {
                    groupNodeRefs.current[group.groupKey] = node;
                  }}
                  data-app-tab-group={group.groupKey}
                  // Its project starts loading as soon as it's pointed at or touched (warmProjectTab).
                  onPointerEnter={() => warmProjectTab(group.groupKey)}
                  onPointerDown={() => warmProjectTab(group.groupKey)}
                  // Hover / open look: globals.css.
                  data-app-top-tab="true"
                  data-active={isActiveTab ? "true" : undefined}
                  // Mobile: fixed min/max width, never shrinks — the strip scrolls (by touch)
                  // instead. Desktop: each tab is as wide as its name (plus its padding and close
                  // button), so tabs differ in size; when they no longer all fit they shrink in
                  // proportion, down to the min-width floor, instead of the strip needing to scroll.
                  className={
                    isDesktopViewport
                      ? "group relative isolate inline-flex h-9 min-w-[90px] max-w-[280px] shrink items-center gap-1.5 rounded-full pl-4 pr-1.5 transition-colors"
                      : "group relative isolate inline-flex h-9 max-w-[320px] shrink-0 items-center gap-1.5 rounded-full pl-4 pr-1.5 transition-colors"
                  }
                  onDrop={(event) => handleGroupDrop(group.groupKey, event)}
                  style={{
                    backgroundColor: isActiveTab ? shellPalette.panelBg : shellPalette.tabIdleBg,
                    boxShadow: isActiveTab ? "none" : "var(--shadow-sm)",
                    opacity: isCollapsedDragSource || settlingGroupKey === group.groupKey ? 0 : 1,
                    transform: groupShiftX > 0 ? `translateX(${groupShiftX}px)` : "translateX(0)",
                    // While dragging, only the other tabs sliding aside animates — the picked-up tab
                    // itself disappears from the row at once (see dragShiftAnimated).
                    transition: draggedGroupKey
                      ? dragShiftAnimated
                        ? "transform 180ms ease, box-shadow 180ms ease"
                        : "none"
                      : "background-color 120ms ease, box-shadow 180ms ease, outline-color 140ms ease",
                    cursor: isPressed ? "grabbing" : "pointer",
                    width: isCollapsedDragSource ? 0 : undefined,
                    minWidth: isCollapsedDragSource ? 0 : undefined,
                    maxWidth: isCollapsedDragSource ? 0 : undefined,
                    paddingLeft: isCollapsedDragSource ? 0 : undefined,
                    paddingRight: isCollapsedDragSource ? 0 : undefined,
                    borderWidth: isCollapsedDragSource ? 0 : undefined,
                    gap: isCollapsedDragSource ? 0 : undefined,
                    overflow: isCollapsedDragSource ? "hidden" : undefined,
                    pointerEvents: isCollapsedDragSource ? "none" : undefined,
                  }}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      // Set the instant a touch-drag reorder commits (see endMobileTabDrag) — the
                      // synthetic click some browsers still fire right after that touchend would
                      // otherwise ALSO switch to whichever tab the finger happened to release over.
                      if (suppressNextTabClickRef.current === group.groupKey) {
                        suppressNextTabClickRef.current = "";
                        return;
                      }
                      // The project that's already open (or opening): nothing to reopen.
                      if (isActiveTab) {
                        blurTopTabTarget(event.currentTarget);
                        return;
                      }
                      selectGroupPrimaryTab(group, event.currentTarget);
                    }}
                    onMouseDown={(event) => handleTopTabMouseDown(group.groupKey, event)}
                    draggable={isDesktopViewport}
                    onDragStart={(event) => handleGroupDragStart(group.groupKey, event)}
                    onDragEnd={handleGroupDragEnd}
                    onMouseUp={() => setPressedGroupKey("")}
                    onTouchStart={(event) => onTabTouchStart(group.groupKey, event)}
                    onTouchMove={onTabTouchMove}
                    onTouchEnd={onTabTouchEnd}
                    onTouchCancel={onTabTouchCancel}
                    className="min-w-0 flex-1 truncate text-left text-[12px] font-bold"
                    style={{
                      color: isActiveTab ? shellPalette.text : shellPalette.textMuted,
                      cursor: isPressed ? "grabbing" : isActiveTab ? "default" : "pointer",
                      // Long-press on mobile is how you pick a tab up to reorder it — without these,
                      // the browser's own default long-press UI (text-selection callout, tap-color
                      // flash) fires first and visually fights with/masks the pick-up.
                      WebkitTouchCallout: "none",
                      WebkitUserSelect: "none",
                      userSelect: "none",
                      WebkitTapHighlightColor: "transparent",
                    }}
                    title={formatSingleTabLabel(activeTab, group.groupLabel)}
                  >
                    {formatSingleTabLabel(activeTab, group.groupLabel)}
                  </button>
                  <button
                    type="button"
                    onMouseDown={handleAuxButtonMouseDown}
                    onClick={() => {
                      popAwayClosingTab(group.groupKey);
                      closeAppTab(group.tabs.length > 1 ? `${CLOSING_SCOPE_PREFIX}${group.groupKey}` : activeTab.key);
                    }}
                    // Hovering it turns the tab's outline red (globals.css).
                    data-app-top-tab-close="true"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--panel-border)]"
                    style={{ color: shellPalette.textMuted }}
                    aria-label={`Close ${group.groupLabel}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            }))}
          </div>
          {user?.uid ? (
            <button
              type="button"
              ref={notifBtnRef}
              // On a computer, the pointer reaching the bell starts loading the list if it hasn't yet — a head
              // start on the click.
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse" && !isNotifListLoaded) loadNotifsNowRef.current?.();
              }}
              onMouseDown={handleAuxButtonMouseDown}
              onClick={(event) => {
                if (isNotifOpen) {
                  setIsNotifOpen(false);
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                const viewportWidth = Math.max(120, document.documentElement?.clientWidth || window.innerWidth);
                const width = Math.min(380, Math.max(240, viewportWidth - 16));
                setNotifPos({
                  left: Math.min(Math.max(8, rect.right - width), Math.max(8, viewportWidth - width - 8)),
                  top: rect.bottom + 6,
                  width,
                });
                setIsNotifOpen(true);
                setNotifBellWobbleKey((prev) => prev + 1);
              }}
              className="relative ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] transition-colors"
              style={{ color: shellPalette.textMuted }}
              aria-label="Notifications"
              title="Notifications"
            >
              {/* notifBellWobbleKey starts at 0 (never clicked) — only apply the wobble class once
                  it's actually incremented by a click, so mounting this button on page load
                  doesn't itself play the animation. */}
              <span key={notifBellWobbleKey} className={notifBellWobbleKey > 0 ? "inline-flex bell-wobble" : "inline-flex"}>
                <Bell size={16} />
              </span>
              {notifUnreadCount > 0 ? (
                // How many are unread, on a small pill in the solid red of the app's red X buttons
                // (--danger-gradient, white text). notif-count-pill (globals.css) centres the number exactly.
                <span
                  className="notif-count-pill pointer-events-none absolute right-[3px] top-[4px] inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3.5px] text-[9px] font-semibold leading-none text-white tabular-nums"
                  style={{ backgroundImage: "var(--danger-gradient)" }}
                  aria-label={`${notifUnreadCount} unread`}
                >
                  {notifUnreadCount > 99 ? "99+" : notifUnreadCount}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
      </div>
      {isNotifDrawerMounted && isDesktopViewport && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={notifDropdownRef}
              // Slides in from the right (notif-drawer-in, globals.css) and back out (the transform below),
              // unmounting once it's gone.
              className="fixed inset-y-0 right-0 z-[210] flex w-[400px] max-w-[calc(100vw-16px)] flex-col overflow-hidden border-l motion-reduce:!animate-none"
              style={{
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--bg-app)",
                boxShadow: "-16px 0 48px rgba(15, 23, 42, 0.18)",
                ...(isNotifOpen
                  ? { animation: "notif-drawer-in 260ms cubic-bezier(0.32, 0.72, 0, 1)" }
                  : { transform: "translate3d(100%, 0, 0)", transition: "transform 260ms cubic-bezier(0.32, 0.72, 0, 1)" }),
              }}
              onTransitionEnd={(event) => {
                if (event.target === event.currentTarget && !isNotifOpen) setIsNotifDrawerMounted(false);
              }}
              aria-hidden={!isNotifOpen}
              inert={!isNotifOpen}
            >
              <div className="flex shrink-0 items-center gap-3 px-5 pb-2 pt-4">
                {/* The bell, then the title. */}
                <p className="flex min-w-0 flex-1 items-center gap-2 text-[18px] font-medium" style={{ color: "var(--text-main)" }}>
                  <Bell size={18} className="shrink-0" aria-hidden="true" />
                  Notifications
                </p>
                {/* Only while there's something unread. */}
                {notifUnreadCount > 0 ? (
                  <button
                    type="button"
                    onMouseDown={handleAuxButtonMouseDown}
                    onClick={async () => {
                      if (!user?.uid) return;
                      setNotifRows((prev) => prev.map((row) => ({ ...row, read: true })));
                      await setAllUserNotificationsRead(user.uid, true, activeCompanyId);
                    }}
                    className="text-[12px] font-medium transition-opacity hover:opacity-75"
                    style={{ color: "var(--brand-strong)" }}
                  >
                    Mark all read
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setIsNotifOpen(false)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition hover:brightness-95"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" }}
                  aria-label="Close notifications"
                  title="Close"
                >
                  <X size={15} />
                </button>
              </div>
              {renderDevNotifTest()}
              <div className="min-h-0 flex-1 overflow-auto">{renderNotifRows()}</div>
            </div>,
            document.body,
          )
        : null}
      {shouldRenderMobileNotif && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[210] lg:hidden">
              <button
                type="button"
                data-swipe-backdrop="true"
                className="absolute inset-0 bg-transparent"
                onClick={() => setIsNotifOpen(false)}
                aria-label="Close notifications backdrop"
              />
              <div
                ref={mobileNotifPanelRef}
                {...mobileNotifTouchHandlers}
                // Queried from app-shell.tsx's own live open-drag handler (a different component,
                // so no direct ref access) — same cross-component pattern as this file's own
                // mainPushRef lookup by data-app-main-push above.
                data-mobile-notif-panel="true"
                className="relative ml-auto flex h-full w-full flex-col overflow-hidden"
                style={{
                  // Frosted glass over the page (the same as the phone menu's — app-shell.tsx).
                  backgroundColor: themeMode === "dark" ? "rgba(11, 13, 18, 0.62)" : "rgba(245, 247, 250, 0.62)",
                  backdropFilter: "blur(22px) saturate(180%)",
                  WebkitBackdropFilter: "blur(22px) saturate(180%)",
                  touchAction: "pan-y",
                }}
              >
                <div className="relative flex shrink-0 items-center px-4 py-3">
                  {/* Alongside the swipe-to-close gesture — an explicit tap target in the top-left corner, its
                      arrow pointing the way the panel goes (right, since it slides back out to the right;
                      mirrors the mobile nav drawer's own left-pointing close arrow). A circle, the same as
                      the drawer's. */}
                  <button
                    type="button"
                    onClick={() => setIsNotifOpen(false)}
                    className="relative z-[1] inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
                    style={{ borderColor: shellPalette.border, backgroundColor: shellPalette.panelBg, color: shellPalette.textMuted }}
                    aria-label="Close notifications"
                  >
                    <ChevronRight size={20} />
                  </button>
                  {/* The bell, then the title — the two centred on the screen, whatever is beside them. */}
                  <p className="pointer-events-none absolute inset-x-0 flex items-center justify-center gap-2 text-[19px] font-medium" style={{ color: "var(--text-main)" }}>
                    <Bell size={19} className="shrink-0" aria-hidden="true" />
                    Notifications
                  </p>
                  {/* Mark all read, opposite the back button — only while there's something unread. */}
                  {notifUnreadCount > 0 ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!user?.uid) return;
                        setNotifRows((prev) => prev.map((row) => ({ ...row, read: true })));
                        await setAllUserNotificationsRead(user.uid, true, activeCompanyId);
                      }}
                      className="relative z-[1] ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
                      style={{ borderColor: shellPalette.border, backgroundColor: shellPalette.panelBg, color: "var(--brand-strong)" }}
                      aria-label="Mark all read"
                      title="Mark all read"
                    >
                      <CheckCheck size={19} />
                    </button>
                  ) : null}
                </div>
                {renderDevNotifTest()}
                <div className="min-h-0 flex-1 overflow-auto">{renderNotifRows()}</div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {/* A notification's menu (right-click, or press and hold on a phone). */}
      {notifMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={notifMenuRef}
              role="menu"
              aria-label="Notification"
              className="fixed z-[2147483647] rounded-[14px] border p-1.5 shadow-[var(--shadow-md)] max-lg:rounded-[16px]"
              style={{
                left: notifMenu.left,
                top: notifMenu.top,
                width: notifMenu.width,
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--glass-modal-bg)",
                backdropFilter: "blur(16px) saturate(200%)",
                WebkitBackdropFilter: "blur(16px) saturate(200%)",
              }}
            >
              {notifMenu.row.read ? (
                <button type="button" role="menuitem" onClick={() => setNotifRead(notifMenu.row, false)} className="flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] max-lg:h-11 max-lg:text-[15px]" style={{ color: "var(--text-main)" }}>
                  <Mail size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  Mark as unread
                </button>
              ) : (
                <button type="button" role="menuitem" onClick={() => setNotifRead(notifMenu.row, true)} className="flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] max-lg:h-11 max-lg:text-[15px]" style={{ color: "var(--text-main)" }}>
                  <Check size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  Mark as read
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => clearNotif(notifMenu.row)} className="flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] max-lg:h-11 max-lg:text-[15px]" style={{ color: "var(--danger)" }}>
                <Trash2 size={16} className="shrink-0" />
                Clear
              </button>
              <div className="mx-1 my-1.5 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
              {/* Remind me in: how many (- / +, or typed), minutes, hours or days (a dropdown), then the button that sets it. */}
              <div className="px-2.5 pb-1 pt-1">
                <p className="text-[12px] font-medium max-lg:text-[13.5px]" style={{ color: "var(--text-muted)" }}>Remind me in</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={remindAmount <= 1}
                      onClick={() => setRemindAmount((value) => stepRemindAmount(value, remindUnit, -1))}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border disabled:opacity-40 max-lg:h-9 max-lg:w-9"
                      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                      aria-label="Fewer"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={String(remindAmount)}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        const typed = Number.parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
                        setRemindAmount(Math.min(remindMax, Math.max(1, Number.isFinite(typed) ? typed : 1)));
                      }}
                      aria-label="Remind me in how many"
                      className="h-8 w-9 rounded-[8px] bg-transparent text-center text-[15px] font-medium tabular-nums outline-none focus:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] max-lg:h-9 max-lg:text-[16px]"
                      style={{ color: "var(--text-main)" }}
                    />
                    <button
                      type="button"
                      disabled={remindAmount >= remindMax}
                      onClick={() => setRemindAmount((value) => stepRemindAmount(value, remindUnit, 1))}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border disabled:opacity-40 max-lg:h-9 max-lg:w-9"
                      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                      aria-label="More"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <GlassDropdown
                    value={remindUnit}
                    options={REMIND_UNIT_OPTIONS}
                    onChange={(next) => {
                      const unit = next as RemindUnit;
                      setRemindUnit(unit);
                      setRemindAmount((value) => Math.min(value, REMIND_UNITS[unit].max));
                    }}
                    ariaLabel="Remind me in minutes, hours or days"
                    menuMinWidth={110}
                    menuAlign="right"
                    triggerClassName="h-8 min-w-[100px] justify-between rounded-full border px-3 text-[12.5px] font-medium max-lg:h-9 max-lg:min-w-[112px] max-lg:text-[14px]"
                    triggerStyle={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                  />
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => remindNotifLater(notifMenu.row)}
                  className="mt-2.5 h-9 w-full rounded-full text-[13px] font-medium text-white transition hover:brightness-105 max-lg:h-11 max-lg:text-[15px]"
                  style={{ backgroundImage: "var(--brand-gradient)" }}
                >
                  Remind me in {remindLabel}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
