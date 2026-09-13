"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LayoutDashboard, Menu, X } from "lucide-react";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
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

function formatNotificationTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
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

export function GlobalAppTabsBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { tabs: globalAppTabs, actionsByKey, closeTab, reorderGroupToIndex, suppressScope, restoreScope, suppressTab, chromeHidden, setMobileNavOpen } = useAppTabs();
  const { user } = useAuth();
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [isAppTabsMenuOpen, setIsAppTabsMenuOpen] = useState("");
  const [appTabsMenuPos, setAppTabsMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [closingAppTabKey, setClosingAppTabKey] = useState("");
  const [closeTabModalOrigin, setCloseTabModalOrigin] = useState<GlassModalOrigin>(null);
  const closeTabModalPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderCloseTabModal = useGlassModalPopOrigin(Boolean(closingAppTabKey), closeTabModalOrigin, closeTabModalPanelRef);
  const [notifRows, setNotifRows] = useState<UserNotificationRow[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifPos, setNotifPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const notifBtnRef = useRef<HTMLButtonElement | null>(null);
  const notifDropdownRef = useRef<HTMLDivElement | null>(null);
  const notifUnreadCount = notifRows.filter((row) => !row.read).length;
  const [notifBellWobbleKey, setNotifBellWobbleKey] = useState(0);
  const [pendingActiveAppTabKey, setPendingActiveAppTabKey] = useState(pendingActiveAppTabKeyMemory);
  const [hiddenScopeKeys, setHiddenScopeKeys] = useState<string[]>([]);
  const [draggedGroupKey, setDraggedGroupKey] = useState("");
  const [dragOverGroupKey, setDragOverGroupKey] = useState("");
  const [dragInsertIndex, setDragInsertIndex] = useState<number | null>(null);
  const [draggedGroupWidth, setDraggedGroupWidth] = useState(0);
  const [collapsedDraggedGroupKey, setCollapsedDraggedGroupKey] = useState("");
  const [pressedGroupKey, setPressedGroupKey] = useState("");
  const appTabsMenuRef = useRef<HTMLDivElement | null>(null);
  const appTabsDropdownRef = useRef<HTMLDivElement | null>(null);
  const topTabsStripRef = useRef<HTMLDivElement | null>(null);
  const groupNodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragLayoutRef = useRef<Array<{ groupKey: string; left: number; width: number }>>([]);
  const customDragGhostRef = useRef<HTMLDivElement | null>(null);
  const dragGhostGrabOffsetXRef = useRef(0);

  const shellPalette = themeMode === "dark"
    ? {
        panelBg: "#212121",
        panelMuted: "#272727",
        border: "#3f3f46",
        text: "#f1f1f1",
        textMuted: "#aaaaaa",
        stripBg: "rgba(10,10,12,0.4)",
        tabIdleBg: "rgba(255,255,255,0.05)",
        stripHighlight: "rgba(255,255,255,0.07)",
      }
    : {
        panelBg: "#ffffff",
        panelMuted: "#F8FAFC",
        border: "#D8DEE8",
        text: "#0F172A",
        textMuted: "#475467",
        stripBg: "rgba(238,241,248,0.4)",
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
  // (Company Settings, Calendar, Recently Deleted, User Settings, etc.) must show
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
  const closingScopeKey = closingAppTabKey.startsWith(CLOSING_SCOPE_PREFIX)
    ? closingAppTabKey.slice(CLOSING_SCOPE_PREFIX.length)
    : "";
  const closingItemLabel = useMemo(() => {
    if (!closingAppTabKey) return "";
    if (closingScopeKey) {
      const group = groupedGlobalTabs.find((item) => item.groupKey === closingScopeKey);
      return String(group?.groupLabel || "this tab").trim();
    }
    const tab = visibleGlobalAppTabs.find((item) => item.key === closingAppTabKey);
    return String(tab?.label || "this sub-tab").trim();
  }, [closingAppTabKey, closingScopeKey, groupedGlobalTabs, visibleGlobalAppTabs]);
  // Closing a sub-tab that's the only one left in its group closes the whole
  // main tab too (see confirmCloseAppTab's isClosingCurrentScope/scopedTabs.length
  // check) — the dialog wording should match that, not just whether the click
  // came from the group-level close button vs. a sub-tab's own close button.
  const closingPlainTab = !closingScopeKey ? visibleGlobalAppTabs.find((tab) => tab.key === closingAppTabKey) : null;
  const closingPlainTabSiblingCount = closingPlainTab
    ? visibleGlobalAppTabs.filter((tab) => tab.scopeKey === closingPlainTab.scopeKey).length
    : 0;
  const closingWholeTab = Boolean(closingScopeKey) || closingPlainTabSiblingCount <= 1;
  const closingDialogTitle = closingWholeTab ? "Close tab?" : "Close sub-tab?";
  const closingDialogBody = closingWholeTab
    ? `Save ${closingItemLabel || "this tab"} before closing it?`
    : `Save ${closingItemLabel || "this sub-tab"} before closing it?`;

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
    const onPointerDown = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      const isInsideTopBar = appTabsMenuRef.current?.contains(targetNode);
      const isInsideDropdown = appTabsDropdownRef.current?.contains(targetNode);
      if (!isInsideTopBar && !isInsideDropdown) {
        setIsAppTabsMenuOpen("");
        setAppTabsMenuPos(null);
      }
      const isInsideNotifDropdown = notifDropdownRef.current?.contains(targetNode);
      if (!isInsideTopBar && !isInsideNotifDropdown) {
        setIsNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    const uid = String(user?.uid || "").trim();
    if (!uid) {
      setNotifRows([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const rows = await fetchUserNotifications(uid);
      if (!cancelled) setNotifRows(rows);
    };
    void load();
    const intervalId = window.setInterval(() => void load(), NOTIF_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [user?.uid]);

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

  useEffect(() => {
    if (!draggedGroupKey || typeof document === "undefined") return;
    const onDocumentDragOver = (event: DragEvent) => {
      const ghost = customDragGhostRef.current;
      if (!ghost || !event.clientX) return;
      ghost.style.left = `${event.clientX - dragGhostGrabOffsetXRef.current}px`;
    };
    document.addEventListener("dragover", onDocumentDragOver);
    return () => document.removeEventListener("dragover", onDocumentDragOver);
  }, [draggedGroupKey]);

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
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        setCollapsedDraggedGroupKey(normalizedGroupKey);
      });
    } else {
      setCollapsedDraggedGroupKey(normalizedGroupKey);
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
    }
  };

  const removeCustomDragGhost = () => {
    customDragGhostRef.current?.remove();
    customDragGhostRef.current = null;
  };

  const handleGroupDrop = (_groupKey: string, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    const sourceGroupKey =
      String(event.dataTransfer.getData("text/plain") || "").trim() ||
      draggedGroupKey;
    if (sourceGroupKey && dragInsertIndex !== null) {
      reorderGroupToIndex(sourceGroupKey, dragInsertIndex);
    }
    setDraggedGroupKey("");
    setDragOverGroupKey("");
    setDragInsertIndex(null);
    setDraggedGroupWidth(0);
    setCollapsedDraggedGroupKey("");
    removeCustomDragGhost();
  };

  const handleGroupDragEnd = () => {
    setDraggedGroupKey("");
    setDragOverGroupKey("");
    setDragInsertIndex(null);
    setDraggedGroupWidth(0);
    setCollapsedDraggedGroupKey("");
    setPressedGroupKey("");
    dragLayoutRef.current = [];
    removeCustomDragGhost();
  };

  const handleTabsStripDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggedGroupKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = event.target as HTMLElement | null;
    const isInsideStrip = Boolean(target?.closest?.("[data-app-tabs-strip]"));
    if (!isInsideStrip) {
      setDragOverGroupKey("");
      setDragInsertIndex(null);
      return;
    }
    const remainingLayouts = dragLayoutRef.current.filter((item) => item.groupKey !== draggedGroupKey);
    if (!remainingLayouts.length) {
      setDragOverGroupKey("");
      setDragInsertIndex(0);
      return;
    }
    // Use the dragged tab's own visual center (where the ghost actually is),
    // not the raw cursor point — the cursor can be grabbed anywhere within the
    // tab, so comparing its raw X against sibling midpoints made the "make room"
    // shift trigger out of sync with where the dragged tab visibly overlaps.
    const clientX = event.clientX - dragGhostGrabOffsetXRef.current + draggedGroupWidth / 2;
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
    if (!nextGroupKey) {
      setDragOverGroupKey("");
    } else {
      setDragOverGroupKey(nextGroupKey);
    }
  };

  const handleTabsStripDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggedGroupKey) return;
    const nextTarget = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const isStillInsideStrip = Boolean(nextTarget?.closest?.("[data-app-tabs-strip]"));
    if (!isStillInsideStrip) {
      setDragOverGroupKey("");
      setDragInsertIndex(null);
    }
  };

  const handleTabsStripDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggedGroupKey) return;
    event.preventDefault();
    const sourceGroupKey =
      String(event.dataTransfer.getData("text/plain") || "").trim() ||
      draggedGroupKey;
    if (sourceGroupKey && dragInsertIndex !== null) {
      reorderGroupToIndex(sourceGroupKey, dragInsertIndex);
    }
    setDraggedGroupKey("");
    setDragOverGroupKey("");
    setDragInsertIndex(null);
    setDraggedGroupWidth(0);
    setCollapsedDraggedGroupKey("");
    dragLayoutRef.current = [];
    removeCustomDragGhost();
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

  const confirmCloseAppTab = (saveState: boolean) => {
    const isClosingScope = closingAppTabKey.startsWith(CLOSING_SCOPE_PREFIX);
    const closingScopeKey = isClosingScope ? closingAppTabKey.slice(CLOSING_SCOPE_PREFIX.length) : "";
    const closingTab = isClosingScope
      ? visibleGlobalAppTabs.find((tab) => tab.scopeKey === closingScopeKey && tab.key === displayActiveAppTabKey) ??
        visibleGlobalAppTabs.find((tab) => tab.scopeKey === closingScopeKey)
      : visibleGlobalAppTabs.find((tab) => tab.key === closingAppTabKey);
    if (!closingTab) {
      setClosingAppTabKey("");
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
      setClosingAppTabKey("");
      setIsAppTabsMenuOpen("");
      setAppTabsMenuPos(null);
      const fallbackTab =
        visibleGlobalAppTabs
          .filter((tab) => tab.scopeKey !== closingTab.scopeKey)
          .slice()
          .sort((a, b) => (Number(a.order) || Number.MAX_SAFE_INTEGER) - (Number(b.order) || Number.MAX_SAFE_INTEGER))[0] ??
        null;
      router.push(fallbackTab?.href || "/dashboard");
      return;
    }
    if (closingTab && isClosingCurrentScope) {
      suppressTab(closingAppTabKey);
      const action = actionsByKey[closingAppTabKey];
      if (saveState) {
        action?.onCloseSave?.();
      } else {
        action?.onCloseDiscard?.();
      }
    } else {
      closeTab(closingAppTabKey);
    }
    setClosingAppTabKey("");
    if (!isClosingScope && closingAppTabKey === pendingActiveAppTabKey) {
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

  return (
    <>
      <div
        className="fixed left-0 right-0 top-0 z-[95] h-12 px-2 lg:left-[240px]"
        style={{
          backgroundColor: shellPalette.stripBg,
          backdropFilter: "blur(12px) saturate(220%)",
          WebkitBackdropFilter: "blur(12px) saturate(220%)",
          boxShadow: `inset 0 1px 0 ${shellPalette.stripHighlight}, var(--shadow-glass)`,
          color: shellPalette.text,
        }}
      >
        {/* Rendered as its own layer (not a border on this container) so the active
            tab's connector/notch pieces below can reliably paint over it via normal
            DOM-order stacking, instead of depending on an ancestor's own border layer. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{ backgroundColor: "var(--glass-border)" }}
        />
        <div ref={appTabsMenuRef} className="relative flex h-full items-center gap-1.5">
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
                    className="inline-flex h-9 min-w-[100px] max-w-[200px] shrink-0 items-center gap-2 rounded-[10px] px-3 text-left text-[12px] font-bold transition-colors"
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
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
          >
            {scrollableTabGroups.map((group) => {
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
                  className="group relative inline-flex h-9 min-w-[140px] max-w-[320px] shrink-0 items-center gap-1.5 rounded-[10px] px-3 transition-colors"
                  onDrop={(event) => handleGroupDrop(group.groupKey, event)}
                  style={{
                    backgroundColor: isActiveTab ? shellPalette.panelBg : shellPalette.tabIdleBg,
                    boxShadow: isActiveTab ? "none" : "var(--shadow-sm)",
                    opacity: isCollapsedDragSource ? 0 : 1,
                    transform: groupShiftX > 0 ? `translateX(${groupShiftX}px)` : "translateX(0)",
                    transition: draggedGroupKey
                      ? "transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease, width 180ms ease, min-width 180ms ease, max-width 180ms ease, padding 180ms ease, border-width 180ms ease"
                      : "background-color 120ms ease, box-shadow 180ms ease, opacity 180ms ease",
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
                    onClick={(event) => selectGroupPrimaryTab(group, event.currentTarget)}
                    onMouseDown={(event) => handleTopTabMouseDown(group.groupKey, event)}
                    draggable
                    onDragStart={(event) => handleGroupDragStart(group.groupKey, event)}
                    onDragEnd={handleGroupDragEnd}
                    onMouseUp={() => setPressedGroupKey("")}
                    className="min-w-0 flex-1 truncate text-left text-[12px] font-bold"
                    style={{ color: isActiveTab ? shellPalette.text : shellPalette.textMuted, cursor: isPressed ? "grabbing" : "pointer" }}
                    title={formatSingleTabLabel(activeTab, group.groupLabel)}
                  >
                    {formatSingleTabLabel(activeTab, group.groupLabel)}
                  </button>
                  <button
                    type="button"
                    onMouseDown={handleAuxButtonMouseDown}
                    onClick={(e) => {
                      setCloseTabModalOrigin(captureGlassModalOrigin(e));
                      setClosingAppTabKey(group.tabs.length > 1 ? `${CLOSING_SCOPE_PREFIX}${group.groupKey}` : activeTab.key);
                    }}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] transition-colors hover:bg-[var(--panel-border)]"
                    style={{ color: shellPalette.textMuted }}
                    aria-label={`Close ${group.groupLabel}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
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
              <span key={notifBellWobbleKey} className="inline-flex bell-wobble">
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
      {isNotifOpen && notifPos && typeof document !== "undefined"
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
                    await setAllUserNotificationsRead(user.uid, true);
                  }}
                  className="text-[11px] font-bold transition-colors hover:opacity-80"
                  style={{ color: "var(--brand)" }}
                >
                  Mark all read
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {notifRows.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[12px]" style={{ color: shellPalette.textMuted }}>
                    No notifications yet.
                  </p>
                ) : (
                  notifRows.slice(0, 10).map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onMouseDown={handleAuxButtonMouseDown}
                      onClick={() => {
                        if (!user?.uid) return;
                        setNotifRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, read: true } : item)));
                        void markUserNotificationRead(user.uid, row.id);
                        setIsNotifOpen(false);
                        if (row.projectId) {
                          router.push(`/projects/${row.projectId}`);
                        }
                      }}
                      className="block w-full border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--panel-muted)]"
                      style={{
                        borderBottomColor: shellPalette.border,
                        backgroundColor: row.read ? "transparent" : "var(--brand-soft)",
                      }}
                    >
                      <p className="text-[12px] font-bold" style={{ color: shellPalette.text }}>
                        {row.title || "Notification"}
                      </p>
                      <p className="mt-[2px] truncate text-[11px]" style={{ color: shellPalette.textMuted }}>
                        {row.message || ""}
                      </p>
                      <p className="mt-[2px] text-[10px]" style={{ color: shellPalette.textMuted }}>
                        {formatNotificationTime(row.createdAtIso)}
                      </p>
                    </button>
                  ))
                )}
              </div>
              <button
                type="button"
                onMouseDown={handleAuxButtonMouseDown}
                onClick={() => {
                  setIsNotifOpen(false);
                  router.push("/company-settings?section=notifications");
                }}
                className="shrink-0 border-t px-3 py-2 text-center text-[11px] font-bold transition-colors hover:opacity-80"
                style={{ borderTopColor: shellPalette.border, color: "var(--brand)" }}
              >
                View all
              </button>
            </div>,
            document.body,
          )
        : null}
      {shouldRenderCloseTabModal && (
        <div className="fixed inset-0 z-[2600] flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Close dialog backdrop"
            onClick={() => setClosingAppTabKey("")}
            className="glass-modal-backdrop absolute inset-0"
          />
          <div ref={closeTabModalPanelRef} className="glass-modal-panel relative w-full max-w-[420px] overflow-hidden">
            <div className="glass-modal-header px-5 py-4">
              <h3 className="text-[15px] font-bold" style={{ color: "var(--text-main)" }}>{closingDialogTitle}</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-[13px]" style={{ color: "var(--text-main)" }}>
                {closingDialogBody}
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setClosingAppTabKey("")}
                  className="inline-flex h-10 items-center justify-center rounded-[10px] border px-4 text-[12px] font-bold hover:brightness-95"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => confirmCloseAppTab(false)}
                  className="inline-flex h-10 items-center justify-center rounded-[10px] border px-4 text-[12px] font-bold text-white hover:brightness-95"
                  style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                >
                  Close Without Saving
                </button>
                <button
                  type="button"
                  onClick={() => confirmCloseAppTab(true)}
                  className="inline-flex h-10 items-center justify-center rounded-[10px] border px-4 text-[12px] font-bold text-white hover:brightness-95"
                  style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
                >
                  Save & Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
