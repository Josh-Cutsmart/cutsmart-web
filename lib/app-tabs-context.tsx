"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";

export type AppWorkspaceTab = {
  key: string;
  label: string;
  href: string;
  scopeKey: string;
  groupKey?: string;
  groupLabel?: string;
  active?: boolean;
  order?: number;
};

export type AppWorkspaceTabAction = {
  onSelect?: () => void;
  onCloseSave?: () => void;
  onCloseDiscard?: () => void;
};

type AppTabsContextValue = {
  tabs: AppWorkspaceTab[];
  actionsByKey: Record<string, AppWorkspaceTabAction>;
  registerScopeTabs: (
    scopeKey: string,
    tabs: AppWorkspaceTab[],
    actions?: Record<string, AppWorkspaceTabAction>,
  ) => void;
  closeTab: (key: string) => void;
  reorderGroupToIndex: (draggedGroupKey: string, targetIndex: number) => void;
  suppressScope: (scopeKey: string) => void;
  restoreScope: (scopeKey: string) => void;
  suppressTab: (key: string) => void;
  chromeHidden: boolean;
  setChromeHidden: (hidden: boolean) => void;
  fillMainViewport: boolean;
  setFillMainViewport: (fill: boolean) => void;
  // Shared so GlobalAppTabsBar's mobile hamburger button (rendered as a sibling of AppShell, not
  // a child of it — see app/(staff)/layout.tsx) can open the same drawer AppShell owns and renders.
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
};

const APP_TABS_STORAGE_KEY = "cutsmart_global_app_tabs_v1";
// Same key/precedence company-settings, dashboard, leads, etc. already use to resolve "which
// company is active" — a manual override in localStorage first, falling back to the signed-in
// account's own membership.
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

type AppTabOrderRegistry = {
  tabOrders: Record<string, number>;
  scopeOrders: Record<string, number>;
  groupOrders: Record<string, number>;
};

function buildOrderRegistry(tabs: AppWorkspaceTab[]): AppTabOrderRegistry {
  return tabs.reduce<AppTabOrderRegistry>(
    (registry, tab) => {
      const order = Number(tab.order) || 0;
      const groupKey = String(tab.groupKey || tab.key);
      if (order > 0) {
        registry.tabOrders[tab.key] = order;
        registry.scopeOrders[tab.scopeKey] = Math.min(registry.scopeOrders[tab.scopeKey] ?? order, order);
        registry.groupOrders[groupKey] = Math.min(registry.groupOrders[groupKey] ?? order, order);
      }
      return registry;
    },
    { tabOrders: {}, scopeOrders: {}, groupOrders: {} },
  );
}

const AppTabsContext = createContext<AppTabsContextValue | null>(null);

export function AppTabsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [tabs, setTabs] = useState<AppWorkspaceTab[]>([]);
  const [actionsByKey, setActionsByKey] = useState<Record<string, AppWorkspaceTabAction>>({});
  const [chromeHidden, setChromeHidden] = useState(false);
  const [fillMainViewport, setFillMainViewport] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const suppressedScopeKeysRef = useRef<Set<string>>(new Set());
  const suppressedTabKeysRef = useRef<Set<string>>(new Set());
  const orderRegistryRef = useRef<AppTabOrderRegistry>({
    tabOrders: {},
    scopeOrders: {},
    groupOrders: {},
  });
  // Persisted tabs used to live under one single, unscoped key — meaning an account that left one
  // company and created/joined another kept seeing that OLD company's project tabs forever (the
  // tab itself is harmless — it just 404s as "project not found" — but it shouldn't be there at
  // all once nothing left in this browser's auth/company context can actually reach it). Scoping
  // the storage key to whichever company is currently active isolates one company's tabs from
  // another's, same precedence (stored override, else the account's own membership) already used
  // to resolve "the active company" elsewhere — see e.g. company-settings/page.tsx's
  // loadCompanyAccess.
  const activeCompanyId = useMemo(() => {
    if (typeof window === "undefined") return String(user?.companyId || "").trim();
    const stored = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
    return stored || String(user?.companyId || "").trim();
  }, [user?.companyId]);
  const tabsStorageKey = activeCompanyId ? `${APP_TABS_STORAGE_KEY}:${activeCompanyId}` : APP_TABS_STORAGE_KEY;
  // Set synchronously by the hydration effect below and consumed synchronously by the persist
  // effect right after it (both effects run in the same commit) — without this, the persist
  // effect would fire first with the PREVIOUS company's still-in-state `tabs` and immediately
  // overwrite the newly-hydrated company's storage with stale data, before React has even applied
  // the setTabs() call the hydration effect just made.
  const skipNextPersistRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    skipNextPersistRef.current = true;
    try {
      const raw = window.localStorage.getItem(tabsStorageKey);
      if (!raw) {
        setTabs([]);
        return;
      }
      const parsed = JSON.parse(raw) as AppWorkspaceTab[];
      if (!Array.isArray(parsed)) {
        setTabs([]);
        return;
      }
      const normalizedTabs = parsed
        .filter((tab) => {
          if (!tab || typeof tab !== "object") return false;
          return Boolean(tab.key && tab.label && tab.href && tab.scopeKey);
        })
        .map((tab, index) => ({
          ...tab,
          order: Number.isFinite(Number(tab.order)) ? Number(tab.order) : index + 1,
        }));
      orderRegistryRef.current = buildOrderRegistry(normalizedTabs);
      setTabs(normalizedTabs);
    } catch {
      // Ignore bad local storage state.
      setTabs([]);
    }
  }, [tabsStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(tabsStorageKey, JSON.stringify(tabs));
    } catch {
      // Ignore local storage write failures.
    }
  }, [tabs, tabsStorageKey]);

  const registerScopeTabs = useCallback((
    scopeKey: string,
    nextTabs: AppWorkspaceTab[],
    nextActions?: Record<string, AppWorkspaceTabAction>,
  ) => {
    if (suppressedScopeKeysRef.current.has(scopeKey)) {
      return;
    }
    setActionsByKey((prev) => {
      const next: Record<string, AppWorkspaceTabAction> = { ...prev };
      nextTabs.forEach((tab) => {
        if (nextActions?.[tab.key]) {
          next[tab.key] = nextActions[tab.key];
        }
      });
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => {
          const prevAction = prev[key];
          const nextAction = next[key];
          return (
            prevAction?.onSelect === nextAction?.onSelect &&
            prevAction?.onCloseSave === nextAction?.onCloseSave &&
            prevAction?.onCloseDiscard === nextAction?.onCloseDiscard
          );
        })
      ) {
        return prev;
      }
      return next;
    });
    setTabs((prev) => {
      const rawIncomingKeys = new Set(nextTabs.map((tab) => tab.key));
      const incomingTabs = nextTabs.filter((tab) => !suppressedTabKeysRef.current.has(tab.key));
      Array.from(suppressedTabKeysRef.current).forEach((key) => {
        if (!rawIncomingKeys.has(key)) {
          suppressedTabKeysRef.current.delete(key);
        }
      });
      const maxPrevOrder = prev.reduce((max, tab) => Math.max(max, Number(tab.order) || 0), 0);
      let nextOrder = maxPrevOrder + 1;
      const incoming = incomingTabs.map((tab) => {
        const existing = prev.find((existingTab) => existingTab.key === tab.key);
        const groupKey = String(tab.groupKey || tab.key);
        const rememberedOrder =
          orderRegistryRef.current.tabOrders[tab.key] ??
          orderRegistryRef.current.groupOrders[groupKey] ??
          orderRegistryRef.current.scopeOrders[scopeKey];
        if (existing) {
          const incomingGroupLabel = String(tab.groupLabel || "").trim();
          const existingGroupLabel = String(existing.groupLabel || "").trim();
          return {
            ...tab,
            scopeKey,
            order: existing.order,
            groupLabel:
              incomingGroupLabel && incomingGroupLabel.toLowerCase() !== "project"
                ? tab.groupLabel
                : existingGroupLabel || tab.groupLabel,
          };
        }
        if (Number.isFinite(Number(rememberedOrder)) && Number(rememberedOrder) > 0) {
          return { ...tab, scopeKey, order: Number(rememberedOrder) };
        }
        const assignedOrder = nextOrder;
        nextOrder += 1;
        return { ...tab, scopeKey, order: assignedOrder };
      });
      const incomingByKey = new Map(incoming.map((tab) => [tab.key, tab]));
      const updated = prev
        .filter((tab) => tab.scopeKey !== scopeKey || incomingByKey.has(tab.key))
        .map((tab) => incomingByKey.get(tab.key) ?? tab);
      const newTabs = incoming.filter((tab) => !prev.some((existingTab) => existingTab.key === tab.key));
      const next = [...updated, ...newTabs];
      if (
        next.length === prev.length &&
        next.every((tab, index) => {
          const existing = prev[index];
          return (
            existing &&
            existing.key === tab.key &&
            existing.label === tab.label &&
            existing.href === tab.href &&
            existing.scopeKey === tab.scopeKey &&
            existing.groupKey === tab.groupKey &&
            existing.groupLabel === tab.groupLabel &&
            Boolean(existing.active) === Boolean(tab.active) &&
            Number(existing.order) === Number(tab.order)
          );
        })
      ) {
        return prev;
      }
      const nextRegistry = buildOrderRegistry(next);
      orderRegistryRef.current.tabOrders = {
        ...orderRegistryRef.current.tabOrders,
        ...nextRegistry.tabOrders,
      };
      orderRegistryRef.current.scopeOrders = {
        ...orderRegistryRef.current.scopeOrders,
        ...nextRegistry.scopeOrders,
      };
      orderRegistryRef.current.groupOrders = {
        ...orderRegistryRef.current.groupOrders,
        ...nextRegistry.groupOrders,
      };
      return next;
      });
  }, []);

  const closeTab = useCallback((key: string) => {
    setTabs((prev) => {
      const closingTab = prev.find((tab) => tab.key === key);
      if (!closingTab) {
        return prev;
      }
      const remaining = prev.filter((tab) => tab.key !== key);
      delete orderRegistryRef.current.tabOrders[key];
      if (!remaining.some((tab) => tab.scopeKey === closingTab.scopeKey)) {
        delete orderRegistryRef.current.scopeOrders[closingTab.scopeKey];
      }
      const closingGroupKey = String(closingTab.groupKey || closingTab.key);
      if (!remaining.some((tab) => String(tab.groupKey || tab.key) === closingGroupKey)) {
        delete orderRegistryRef.current.groupOrders[closingGroupKey];
      }
      return remaining;
    });
    setActionsByKey((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const reorderGroupToIndex = useCallback((draggedGroupKey: string, targetIndex: number) => {
    const sourceKey = String(draggedGroupKey || "").trim();
    const requestedIndex = Number.isFinite(targetIndex) ? Math.max(0, Math.floor(targetIndex)) : 0;
    if (!sourceKey) return;
    setTabs((prev) => {
      const sortedTabs = prev
        .slice()
        .sort((a, b) => (Number(a.order) || Number.MAX_SAFE_INTEGER) - (Number(b.order) || Number.MAX_SAFE_INTEGER));
      const groups: Array<{
        groupKey: string;
        tabs: AppWorkspaceTab[];
        isDashboard: boolean;
      }> = [];
      for (const tab of sortedTabs) {
        const groupKey = String(tab.groupKey || tab.key);
        let group = groups.find((item) => item.groupKey === groupKey);
        if (!group) {
          group = {
            groupKey,
            tabs: [],
            isDashboard: String(tab.href || "").trim() === "/dashboard",
          };
          groups.push(group);
        }
        group.tabs.push(tab);
        if (String(tab.href || "").trim() === "/dashboard") {
          group.isDashboard = true;
        }
      }
      const movableGroups = groups.filter((group) => !group.isDashboard);
      const sourceIndex = movableGroups.findIndex((group) => group.groupKey === sourceKey);
      if (sourceIndex < 0) {
        return prev;
      }
      const nextMovableGroups = movableGroups.slice();
      const [movedGroup] = nextMovableGroups.splice(sourceIndex, 1);
      if (!movedGroup) {
        return prev;
      }
      const insertionIndex = Math.max(0, Math.min(nextMovableGroups.length, requestedIndex));
      nextMovableGroups.splice(insertionIndex, 0, movedGroup);
      const orderedGroups = [...groups.filter((group) => group.isDashboard), ...nextMovableGroups];
      let nextOrder = 1;
      const reorderedTabs = orderedGroups.flatMap((group) =>
        group.tabs
          .slice()
          .sort((a, b) => (Number(a.order) || Number.MAX_SAFE_INTEGER) - (Number(b.order) || Number.MAX_SAFE_INTEGER))
          .map((tab) => ({ ...tab, order: nextOrder++ })),
      );
      if (
        reorderedTabs.length === prev.length &&
        reorderedTabs.every((tab, index) => {
          const existing = prev[index];
          return existing?.key === tab.key && Number(existing.order) === Number(tab.order);
        })
      ) {
        return prev;
      }
      const nextRegistry = buildOrderRegistry(reorderedTabs);
      orderRegistryRef.current.tabOrders = {
        ...orderRegistryRef.current.tabOrders,
        ...nextRegistry.tabOrders,
      };
      orderRegistryRef.current.scopeOrders = {
        ...orderRegistryRef.current.scopeOrders,
        ...nextRegistry.scopeOrders,
      };
      orderRegistryRef.current.groupOrders = {
        ...orderRegistryRef.current.groupOrders,
        ...nextRegistry.groupOrders,
      };
      return reorderedTabs;
    });
  }, []);

  const suppressScope = useCallback((scopeKey: string) => {
    const normalizedScopeKey = String(scopeKey || "").trim();
    if (!normalizedScopeKey) return;
    suppressedScopeKeysRef.current.add(normalizedScopeKey);
    setTabs((prev) => prev.filter((tab) => tab.scopeKey !== normalizedScopeKey));
    setActionsByKey((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([key]) => !tabs.some((tab) => tab.key === key && tab.scopeKey === normalizedScopeKey)),
      );
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length) {
        return prev;
      }
      return next;
    });
  }, [tabs]);

  const restoreScope = useCallback((scopeKey: string) => {
    const normalizedScopeKey = String(scopeKey || "").trim();
    if (!normalizedScopeKey) return;
    suppressedScopeKeysRef.current.delete(normalizedScopeKey);
  }, []);

  const suppressTab = useCallback((key: string) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;
    suppressedTabKeysRef.current.add(normalizedKey);
    setTabs((prev) => prev.filter((tab) => tab.key !== normalizedKey));
    setActionsByKey((prev) => {
      if (!prev[normalizedKey]) return prev;
      const next = { ...prev };
      delete next[normalizedKey];
      return next;
    });
  }, []);

  const value = useMemo<AppTabsContextValue>(
    () => ({
      tabs,
      actionsByKey,
      registerScopeTabs,
      closeTab,
      reorderGroupToIndex,
      suppressScope,
      restoreScope,
      suppressTab,
      chromeHidden,
      setChromeHidden,
      fillMainViewport,
      setFillMainViewport,
      mobileNavOpen,
      setMobileNavOpen,
    }),
    [
      actionsByKey,
      chromeHidden,
      closeTab,
      fillMainViewport,
      mobileNavOpen,
      registerScopeTabs,
      reorderGroupToIndex,
      restoreScope,
      suppressScope,
      suppressTab,
      tabs,
    ],
  );

  return <AppTabsContext.Provider value={value}>{children}</AppTabsContext.Provider>;
}

export function useAppTabs() {
  const context = useContext(AppTabsContext);
  if (!context) {
    throw new Error("useAppTabs must be used within AppTabsProvider");
  }
  return context;
}
