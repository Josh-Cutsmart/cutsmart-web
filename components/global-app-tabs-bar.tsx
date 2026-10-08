"use client";

import { activeDateTime } from "@/lib/company-formats";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { isFlatPage } from "@/lib/flat-page";
import { Bell, ChevronLeft, LayoutDashboard, Menu, X } from "lucide-react";
import { useSwipeToClose } from "@/lib/use-swipe-to-close";
import { openWhatsNew } from "@/components/whats-new-sheet";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";
import { useAppTabs, type AppWorkspaceTab } from "@/lib/app-tabs-context";
import { applyThemeMode, readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import { useAuth } from "@/lib/auth-context";
import {
  fetchUserNotifications,
  markUserNotificationRead,
  setAllUserNotificationsRead,
  type UserNotificationRow,
} from "@/lib/firestore-data";

const NOTIF_POLL_INTERVAL_MS = 50000;

// "<date> | 8:57pm" — the date in the company's date format, the time in the viewer's own local time.
function formatNotificationTime(iso: string) {
  return activeDateTime(iso);
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
    { edge: "right", pushRef: mainPushRef },
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
        // Over a flat page (lib/flat-page.ts) it's that page's own colour.
        stripBg: isFlatPage(pathname) ? "rgba(11,13,18,0.4)" : "rgba(10,10,12,0.4)",
        tabIdleBg: "rgba(255,255,255,0.05)",
        stripHighlight: "rgba(255,255,255,0.07)",
      }
    : {
        panelBg: "#ffffff",
        panelMuted: "#F8FAFC",
        border: "#D8DEE8",
        text: "#0F172A",
        textMuted: "#475467",
        // Over a flat page (lib/flat-page.ts) it's that page's own grey.
        stripBg: isFlatPage(pathname) ? "rgba(245,247,250,0.4)" : "rgba(238,241,248,0.4)",
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
      if (isNotifOpen && !isInsideTopBar && !isInsideNotifDropdown && !isInsideMobileNotifPanel) {
        setIsNotifOpen(false);
        // That press only closes notifications — it doesn't also act on whatever it landed on.
        swallowNextClick();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isNotifOpen, setIsNotifOpen]);

  useEffect(() => {
    const uid = String(user?.uid || "").trim();
    if (!uid) {
      setNotifRows([]);
      return;
    }
    let cancelled = false;
    let lastSignature = "";
    const load = async () => {
      // A hidden tab doesn't need fresh notifications; it catches up on the next poll after it's shown.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const rows = await fetchUserNotifications(uid, activeCompanyId);
      if (cancelled) return;
      // Only update (and so re-render the top bar) when something actually changed.
      const signature = JSON.stringify(rows);
      if (signature === lastSignature) return;
      lastSignature = signature;
      setNotifRows(rows);
    };
    // The first load waits a moment, so it doesn't compete with the page's own data on open.
    const firstLoadTimer = window.setTimeout(() => void load(), 2000);
    const intervalId = window.setInterval(() => void load(), NOTIF_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(firstLoadTimer);
      window.clearInterval(intervalId);
    };
  }, [activeCompanyId, user?.uid]);

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

  function renderNotifRows() {
    if (notifRows.length === 0) {
      return (
        <p className="px-3 py-6 text-center text-[12px]" style={{ color: shellPalette.textMuted }}>
          No notifications yet.
        </p>
      );
    }
    return notifRows.slice(0, 10).map((row) => {
      const isAppVersion = row.type === "app_version";
      const appVersion = isAppVersion ? appVersionFromNotifTitle(row.title) : "";
      return (
        <button
          key={row.id}
          type="button"
          onMouseDown={handleAuxButtonMouseDown}
          onClick={() => {
            if (!user?.uid) return;
            setNotifRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, read: true } : item)));
            void markUserNotificationRead(user.uid, row.id);
            setIsNotifOpen(false);
            if (isAppVersion) {
              // Straight to that version's What's New page, over whatever page this is.
              openWhatsNew(appVersion);
            } else if (row.type === "calendar_reminder" && row.eventId) {
              router.push(`/calendar?event=${encodeURIComponent(row.eventId)}`);
            } else if (row.projectId) {
              router.push(`/projects/${row.projectId}`);
            } else if (String(row.type || "").startsWith("lead_")) {
              router.push("/leads");
            }
          }}
          className="block w-full border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--panel-muted)]"
          style={{
            borderBottomColor: shellPalette.border,
            backgroundColor: row.read ? "transparent" : "var(--brand-soft)",
          }}
        >
          <p className="text-[12px] font-bold" style={{ color: shellPalette.text }}>
            {isAppVersion ? `New App Version ${appVersion}` : row.title || "Notification"}
          </p>
          {isAppVersion ? null : (
            <p className="mt-[2px] truncate text-[11px]" style={{ color: shellPalette.textMuted }}>
              {row.message || ""}
            </p>
          )}
          <p className="mt-[2px] text-[10px]" style={{ color: shellPalette.textMuted }}>
            {formatNotificationTime(row.createdAtIso)}
          </p>
        </button>
      );
    });
  }

  return (
    <>
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
                      cursor: isPressed ? "grabbing" : "pointer",
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
              onMouseDown={handleAuxButtonMouseDown}
              onClick={(event) => {
                if (isNotifOpen) {
                  setIsNotifOpen(false);
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                const viewportWidth = Math.max(120, document.documentElement?.clientWidth || window.innerWidth);
                const width = Math.min(340, Math.max(240, viewportWidth - 16));
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
                <span
                  className="absolute right-[6px] top-[6px] h-[9px] w-[9px] rounded-full border-2"
                  style={{ backgroundColor: "var(--danger)", borderColor: shellPalette.stripBg }}
                />
              ) : null}
            </button>
          ) : null}
        </div>
      </div>
      {isNotifOpen && notifPos && isDesktopViewport && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={notifDropdownRef}
              className="fixed z-[210] flex max-h-[420px] flex-col overflow-hidden rounded-[12px] border"
              style={{
                left: notifPos.left,
                top: notifPos.top,
                width: notifPos.width,
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--glass-bg-strong)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
                boxShadow: "var(--shadow-glass)",
              }}
            >
              <div
                className="flex shrink-0 items-center justify-between border-b px-3 py-2"
                style={{ borderBottomColor: shellPalette.border }}
              >
                <p className="text-[12px] font-bold uppercase tracking-[0.5px]" style={{ color: shellPalette.text }}>
                  Notifications
                </p>
                <button
                  type="button"
                  onMouseDown={handleAuxButtonMouseDown}
                  onClick={async () => {
                    if (!user?.uid) return;
                    setNotifRows((prev) => prev.map((row) => ({ ...row, read: true })));
                    await setAllUserNotificationsRead(user.uid, true, activeCompanyId);
                  }}
                  className="text-[11px] font-bold transition-colors hover:opacity-80"
                  style={{ color: "var(--brand)" }}
                >
                  Mark all read
                </button>
              </div>
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
                className="absolute inset-0 bg-[rgba(15,23,42,0.45)]"
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
                  backgroundColor: "var(--panel-bg)",
                  touchAction: "pan-y",
                }}
              >
                <div
                  className="flex shrink-0 items-center gap-3 border-b px-4 py-3"
                  style={{ borderBottomColor: shellPalette.border }}
                >
                  {/* Alongside the swipe-to-close gesture — an explicit tap target in the corner
                      the panel will retreat toward (left, since it slides back out to the right;
                      mirrors the mobile nav drawer's own right-pointing close arrow). */}
                  <button
                    type="button"
                    onClick={() => setIsNotifOpen(false)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border"
                    style={{ borderColor: shellPalette.border, backgroundColor: shellPalette.panelBg, color: shellPalette.textMuted }}
                    aria-label="Close notifications"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <p className="text-[14px] font-bold" style={{ color: shellPalette.text }}>
                    Notifications
                  </p>
                </div>
                <div className="flex shrink-0 items-center justify-end border-b px-4 py-2" style={{ borderBottomColor: shellPalette.border }}>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!user?.uid) return;
                      setNotifRows((prev) => prev.map((row) => ({ ...row, read: true })));
                      await setAllUserNotificationsRead(user.uid, true, activeCompanyId);
                    }}
                    className="text-[12px] font-bold transition-colors hover:opacity-80"
                    style={{ color: "var(--brand)" }}
                  >
                    Mark all read
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">{renderNotifRows()}</div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
