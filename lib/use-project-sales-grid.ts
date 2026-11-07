"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { doc, getDoc, onSnapshot } from "@/lib/firestore-client";
import type { Project } from "@/lib/types";
import { normalizeSpecsGrid, type SpecsGrid } from "@/lib/specs-grid-types";
import { mergeSpecsGrids } from "@/lib/specs-grid-merge";
import {
  extractLegacySalesFieldFromRawDoc,
  fetchSalesGridData,
  hasKeptSalesGrid,
  keepSalesGridEdit,
  readKeptSalesGrid,
  resolveProjectDocRef,
  saveSalesGridData,
  saveSalesGridMerged,
  sendKeptSalesGrids,
  subscribeOfflineCutlistChanges,
} from "@/lib/firestore-data";
import type { CutlistSyncState } from "@/lib/use-project-cutlist";

export type SalesGridKind = "quote" | "specifications";

export interface ProjectSalesGridState {
  status: "idle" | "loading" | "ready" | "error";
  // null while loading/idle/error, OR once confirmed ready with genuinely no grid yet (a brand
  // new project whose live grid hasn't been cloned from the company template yet) — the caller
  // (the page's own hydration effect) is what decides whether "ready + null" means "clone from
  // template now".
  grid: SpecsGrid | null;
  error: unknown;
  retry: () => void;
  // Lets a save function optimistically advance the last-known grid right after a successful
  // write, without waiting for a re-fetch.
  setGridOptimistic: (grid: SpecsGrid) => void;
  // Someone else's change arriving: the sheet as it is in the database now, and as it was before (what to put it onto any
  // edits on the screen with — mergeSpecsGrids). A new object each time.
  remote: { base: SpecsGrid | null; grid: SpecsGrid } | null;
  // An edit kept on this device at once (it survives a reload or the app closing)...
  keep: (grid: SpecsGrid) => void;
  // ...then sent: only what changed here, put onto everyone else's latest. Offline, it's sent when the connection's back.
  save: (grid: SpecsGrid) => Promise<boolean>;
  // Whether its saves have reached the server (the save pill).
  sync: CutlistSyncState;
}

const LEGACY_KEY_BY_KIND: Record<SalesGridKind, string> = {
  quote: "quoteGrid",
  specifications: "specificationsGrid",
};

// The database on this device's copy for a moment, as the listener starts, isn't being offline: only once it's stayed so
// this long (as a cutlist's).
const CACHE_ONLY_OFFLINE_AFTER_MS = 2000;

// Lazily fetches one project's live Quote grid or Specifications grid from its own subcollection
// doc (fetchSalesGridData/saveSalesGridData in lib/firestore-data.ts), only once `enabled` (the
// owning Sales sub-nav is actually open) — falling back to the legacy embedded `sales.quoteGrid`/
// `sales.specificationsGrid` field for a project that hasn't been touched since the subcollection
// shipped. normalizeProject no longer parses either field into `project` at all, so this fallback
// is a fresh, separate `getDoc`. On a legacy hit, fires a non-blocking write to migrate it
// immediately, same reasoning as use-project-cutlist.ts/use-project-checklists.ts.
// Once loaded, kept up to date as a cutlist is: someone else's save reaches `remote` as they make it.
export function useProjectSalesGrid(project: Project | null, kind: SalesGridKind, enabled: boolean): ProjectSalesGridState {
  const [state, setState] = useState<{ status: ProjectSalesGridState["status"]; grid: SpecsGrid | null; error: unknown }>({
    status: "idle",
    grid: null,
    error: null,
  });
  const [retryTick, setRetryTick] = useState(0);
  const [remote, setRemote] = useState<ProjectSalesGridState["remote"]>(null);
  // Read inside the effect instead of closing over `project` directly — the effect's own deps key
  // off project?.id (below), not the whole object, specifically so an unrelated field on `project`
  // changing (the caller re-creates that object on practically every unrelated edit elsewhere on the
  // page) can't cancel an in-flight fetch and restart it from scratch. A project whose id hasn't
  // changed resolves to the same Firestore doc either way, so the slightly-stale object this reads is
  // never actually wrong for that purpose — just not re-triggering work that doesn't need to rerun.
  const projectRef = useRef(project);
  projectRef.current = project;
  // The sheet as last heard of from the database: what a save's changes are told apart by.
  const baseRef = useRef<SpecsGrid | null>(null);
  const [docPath, setDocPath] = useState("");
  const docPathRef = useRef("");
  const keptHere = useSyncExternalStore(
    subscribeOfflineCutlistChanges,
    () => (docPath ? hasKeptSalesGrid(docPath, kind) : false),
    () => false,
  );
  const [listener, setListener] = useState({ fromCache: false, pending: false });
  const [cacheOnlySettled, setCacheOnlySettled] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const update = () => setBrowserOffline(navigator.onLine === false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let settleTimer: number | null = null;

    const listen = (ref: NonNullable<Awaited<ReturnType<typeof resolveProjectDocRef>>>) => {
      let heardFromServer = false;
      let lastJson = JSON.stringify(baseRef.current);
      unsubscribe = onSnapshot(
        doc(ref, "salesGrids", kind),
        { includeMetadataChanges: true },
        (snap) => {
          const fromCache = snap.metadata.fromCache;
          const pending = snap.metadata.hasPendingWrites;
          setListener((prev) => (prev.fromCache === fromCache && prev.pending === pending ? prev : { fromCache, pending }));
          if (fromCache) {
            if (settleTimer === null) {
              settleTimer = window.setTimeout(() => {
                settleTimer = null;
                setCacheOnlySettled(true);
              }, CACHE_ONLY_OFFLINE_AFTER_MS);
            }
          } else {
            heardFromServer = true;
            if (settleTimer !== null) window.clearTimeout(settleTimer);
            settleTimer = null;
            setCacheOnlySettled(false);
            if (hasKeptSalesGrid(ref.path, kind)) void sendKeptSalesGrids();
          }
          if (!snap.exists()) return;
          // (This device's old copy, as it starts: the page already has newer. Not one with a change made here in it.)
          if (fromCache && !pending && !heardFromServer) return;
          const grid = normalizeSpecsGrid((snap.data() as Record<string, unknown>).grid);
          if (!grid) return;
          const json = JSON.stringify(grid);
          const known = JSON.stringify(baseRef.current);
          if (json === lastJson || json === known) {
            lastJson = json;
            return;
          }
          lastJson = json;
          const before = baseRef.current;
          baseRef.current = grid;
          // (A sheet someone else has just started, with none here yet: this is it.)
          setState((prev) => (prev.status === "ready" && !prev.grid ? { ...prev, grid } : prev));
          setRemote({ base: before, grid });
        },
        (error) => console.warn(`[useProjectSalesGrid] ${kind} listener failed:`, error),
      );
    };

    const run = async () => {
      const currentProject = projectRef.current;
      if (!enabled || !currentProject?.id) {
        baseRef.current = null;
        if (!cancelled) {
          setState({ status: "idle", grid: null, error: null });
          setRemote(null);
        }
        return;
      }

      if (!cancelled) setState((prev) => ({ ...prev, status: "loading", error: null }));

      try {
        const ref = await resolveProjectDocRef(currentProject);
        if (cancelled) return;
        if (ref) {
          docPathRef.current = ref.path;
          setDocPath(ref.path);
        }
        const kept = ref ? readKeptSalesGrid(ref.path, kind) : null;
        const stored = await fetchSalesGridData(currentProject, kind);
        if (cancelled) return;
        if (stored) {
          baseRef.current = stored.grid;
          // (Edits from last time still waiting on this device: on top of what's there now.)
          setState({ status: "ready", grid: kept ? mergeSpecsGrids(kept.base ?? stored.grid, kept.here, stored.grid) : stored.grid, error: null });
          if (kept) void sendKeptSalesGrids();
          if (ref) listen(ref);
          return;
        }
        if (kept) {
          setState({ status: "ready", grid: kept.here, error: null });
          if (ref) listen(ref);
          return;
        }

        const snap = ref ? await getDoc(ref) : null;
        const legacyRaw = snap?.exists()
          ? extractLegacySalesFieldFromRawDoc(snap.data() as Record<string, unknown>, LEGACY_KEY_BY_KIND[kind])
          : undefined;
        const legacyGrid = normalizeSpecsGrid(legacyRaw);
        if (cancelled) return;
        baseRef.current = legacyGrid;
        setState({ status: "ready", grid: legacyGrid, error: null });
        if (legacyGrid) {
          void saveSalesGridData(currentProject, kind, legacyGrid);
        }
        if (ref) listen(ref);
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", grid: null, error });
      }
    };

    void run();
    return () => {
      cancelled = true;
      unsubscribe?.();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      setListener({ fromCache: false, pending: false });
      setCacheOnlySettled(false);
    };
  }, [project?.id, kind, enabled, retryTick]);

  const retry = useCallback(() => setRetryTick((tick) => tick + 1), []);
  const setGridOptimistic = useCallback((grid: SpecsGrid) => {
    setState((prev) => ({ ...prev, status: "ready", grid, error: null }));
  }, []);
  const keep = useCallback(
    (grid: SpecsGrid) => {
      if (docPathRef.current) keepSalesGridEdit(docPathRef.current, kind, baseRef.current, grid);
    },
    [kind],
  );
  const save = useCallback(
    async (grid: SpecsGrid) => {
      const currentProject = projectRef.current;
      if (!currentProject) return false;
      const saved = await saveSalesGridMerged(currentProject, kind, baseRef.current, grid);
      if (saved.ok && saved.reachedServer) baseRef.current = normalizeSpecsGrid(saved.grid) ?? saved.grid;
      return saved.ok;
    },
    [kind],
  );
  const offline = browserOffline || (listener.fromCache && cacheOnlySettled);
  const pending = listener.pending || keptHere;
  const sync = useMemo<CutlistSyncState>(() => ({ offline, pending }), [offline, pending]);

  return { ...state, retry, setGridOptimistic, remote, keep, save, sync };
}
