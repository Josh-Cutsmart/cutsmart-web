"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { doc, getDoc, onSnapshot } from "@/lib/firestore-client";
import type { Project } from "@/lib/types";
import {
  cutlistDataRev,
  extractLegacySalesFieldFromRawDoc,
  fetchCutlistData,
  hasOfflineCutlistChange,
  parseCutlistRows,
  reportCutlistListenerFromCache,
  resolveProjectDocRef,
  saveCutlistData,
  sendOfflineCutlistChanges,
  subscribeOfflineCutlistChanges,
} from "@/lib/firestore-data";

export type CutlistDataKind = "production" | "initialMeasure";

export interface ProjectCutlistRawState {
  status: "idle" | "loading" | "ready" | "error";
  rawRows: unknown[];
  // The rows' revision (cutlistDataRev) — what a save adds one to.
  rev: number;
  error: unknown;
  retry: () => void;
  // Lets a save function optimistically advance the last-known rows right after a successful
  // write, without waiting for a re-fetch — mirrors the old `setProject(prev => ({...prev,
  // cutlist: nextCutlist}))` pattern this hook replaces.
  setRawRowsOptimistic: (rows: unknown[], rev?: number) => void;
  // The rows and revision as last heard of, now — not as of the render a save was started in (a save waiting for the
  // one before it to finish would otherwise merge onto rows from before that one).
  latest: () => { rawRows: unknown[]; rev: number };
  // Whether its saves have reached the server: offline (the browser says so, or the database has stayed on this
  // device's copy), and whether it has changes made here not sent yet (kept from being offline — lib/firestore-data.ts —
  // or the database's own flag) — a cutlist's save chip.
  sync: CutlistSyncState;
}

export type CutlistSyncState = { offline: boolean; pending: boolean };

// The database on this device's copy for a moment — as a listener starts, before the server's caught up with it — isn't
// being offline: only once it's stayed so this long.
const CACHE_ONLY_OFFLINE_AFTER_MS = 2000;

// Lazily fetches one project's cutlist rows from their own subcollection (fetchCutlistData/
// saveCutlistData in lib/firestore-data.ts), only once `enabled` (the owning tab is actually
// open) — falling back to the legacy embedded `cutlist`/`cutlistJson` job-doc fields for a
// project that hasn't been touched since that subcollection shipped. normalizeProject no longer
// parses those legacy fields into `project.cutlist` at all, so this fallback is a fresh, separate
// `getDoc`, not something recoverable from already-loaded `project` state. On a legacy hit, fires
// a non-blocking write to migrate this project's cutlist to the subcollection immediately (rather
// than waiting for the next edit) — safe because viewing a job doc and writing to it require the
// same permission in this app's Firestore rules.
// Once loaded, kept up to date: someone else's save in the same cutlist shows here as they make it (an older copy
// arriving after a newer one — told apart by its revision — is passed over). What the screen then does with rows that
// change under it is the project page's (its hydrate effects, which keep any edits there not saved yet).
export function useProjectCutlistRaw(
  project: Project | null,
  kind: CutlistDataKind,
  enabled: boolean,
): ProjectCutlistRawState {
  const [state, setStateRaw] = useState<Omit<ProjectCutlistRawState, "retry" | "setRawRowsOptimistic" | "latest" | "sync">>({
    status: "idle",
    rawRows: [],
    rev: 0,
    error: null,
  });
  const [retryTick, setRetryTick] = useState(0);
  const latestRowsRef = useRef<{ rawRows: unknown[]; rev: number }>({ rawRows: [], rev: 0 });
  // Its live listener's news: from this device's copy only (not the server's), and changes here not sent yet.
  const [listenerSync, setListenerSync] = useState<{ fromCache: boolean; pending: boolean }>({ fromCache: false, pending: false });
  // ...and it's been so CACHE_ONLY_OFFLINE_AFTER_MS.
  const [cacheOnlySettled, setCacheOnlySettled] = useState(false);
  // Where it is in the database (once found): what's kept from being offline is by it.
  const [docPath, setDocPath] = useState("");
  const keptOffline = useSyncExternalStore(
    subscribeOfflineCutlistChanges,
    () => (docPath ? hasOfflineCutlistChange(docPath, kind) : false),
    () => false,
  );
  // The browser's own online / offline.
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
  const setState = useCallback((next: Omit<ProjectCutlistRawState, "retry" | "setRawRowsOptimistic" | "latest" | "sync">) => {
    latestRowsRef.current = { rawRows: next.rawRows, rev: next.rev };
    setStateRaw(next);
  }, []);

  // Re-fetch only for a different project (id/company) — not on every change to the project object,
  // which the project page makes on every save (it used to re-download all of this each time). Saves
  // here update this hook's own state directly; the latest project object is read when it does run.
  const latestProjectRef = useRef(project);
  useEffect(() => {
    latestProjectRef.current = project;
  }, [project]);
  const projectKey = project?.id ? `${project.companyId ?? ""}::${project.id}` : "";

  useEffect(() => {
    const project = latestProjectRef.current;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let settleTimer: number | null = null;

    const listen = async () => {
      const ref = project ? await resolveProjectDocRef(project) : null;
      if (cancelled || !ref) return;
      setDocPath(ref.path);
      unsubscribe = onSnapshot(
        doc(ref, "cutlistData", kind),
        // (With its metadata's changes too: a save reaching the server, the connection going and coming.)
        { includeMetadataChanges: true },
        (snap) => {
          const fromCache = snap.metadata.fromCache;
          const pending = snap.metadata.hasPendingWrites;
          reportCutlistListenerFromCache(fromCache);
          setListenerSync((prev) => (prev.fromCache === fromCache && prev.pending === pending ? prev : { fromCache, pending }));
          if (fromCache) {
            if (settleTimer === null) {
              settleTimer = window.setTimeout(() => {
                settleTimer = null;
                setCacheOnlySettled(true);
              }, CACHE_ONLY_OFFLINE_AFTER_MS);
            }
          } else {
            if (settleTimer !== null) window.clearTimeout(settleTimer);
            settleTimer = null;
            setCacheOnlySettled(false);
            // Hearing from the server again: changes kept here from being offline sent now.
            if (hasOfflineCutlistChange(ref.path, kind)) void sendOfflineCutlistChanges({ path: ref.path, kind });
          }
          if (!snap.exists()) return;
          const data = snap.data() as Record<string, unknown>;
          const rows = Array.isArray(data.rows) ? data.rows : [];
          const rev = cutlistDataRev(data);
          const current = latestRowsRef.current;
          // (No revision — saved by a screen from before them, still open somewhere: taken as it comes.)
          if (rev && rev < current.rev) return;
          const nextRev = Math.max(rev, current.rev);
          if (JSON.stringify(rows) === JSON.stringify(current.rawRows)) {
            if (nextRev !== current.rev) setState({ status: "ready", rawRows: current.rawRows, rev: nextRev, error: null });
            return;
          }
          setState({ status: "ready", rawRows: rows, rev: nextRev, error: null });
        },
        (error) => console.warn(`[useProjectCutlistRaw] ${kind} listener failed:`, error),
      );
    };

    const run = async () => {
      if (!enabled || !project?.id) {
        if (!cancelled) setState({ status: "idle", rawRows: [], rev: 0, error: null });
        return;
      }

      if (!cancelled) setStateRaw((prev) => ({ ...prev, status: "loading", error: null }));

      try {
        const stored = await fetchCutlistData(project, kind);
        if (cancelled) return;
        if (stored) {
          setState({ status: "ready", rawRows: stored.rows, rev: stored.rev, error: null });
          void listen();
          return;
        }

        // Not migrated yet — read the legacy fields directly. Production's legacy source is a
        // top-level `cutlist`/`cutlistJson` field; Initial Measure's is nested inside the sales
        // blob (`sales.initialCutlist.rows`), same candidate-priority resolution as every other
        // sales field.
        const ref = await resolveProjectDocRef(project);
        const snap = ref ? await getDoc(ref) : null;
        const rawData = snap?.exists() ? (snap.data() as Record<string, unknown>) : null;
        const legacyRows = !rawData
          ? []
          : kind === "production"
            ? parseCutlistRows(rawData)
            : (() => {
                const initialCutlist = extractLegacySalesFieldFromRawDoc(rawData, "initialCutlist");
                const rows =
                  initialCutlist && typeof initialCutlist === "object"
                    ? (initialCutlist as Record<string, unknown>).rows
                    : undefined;
                return Array.isArray(rows) ? rows : [];
              })();
        if (cancelled) return;
        setState({ status: "ready", rawRows: legacyRows, rev: 0, error: null });
        // Self-heal: write straight to the subcollection now that we've read the legacy data,
        // instead of waiting for the user to make an actual edit.
        void saveCutlistData(project, kind, legacyRows);
        void listen();
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", rawRows: [], rev: 0, error });
      }
    };

    void run();
    return () => {
      cancelled = true;
      unsubscribe?.();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      setListenerSync({ fromCache: false, pending: false });
      setCacheOnlySettled(false);
      setDocPath("");
      // (Nothing listening now to say it's offline.)
      reportCutlistListenerFromCache(false);
    };
  }, [projectKey, kind, enabled, retryTick, setState]);

  const retry = useCallback(() => setRetryTick((tick) => tick + 1), []);
  const setRawRowsOptimistic = useCallback(
    (rows: unknown[], rev?: number) => {
      setState({ status: "ready", rawRows: rows, rev: Math.max(latestRowsRef.current.rev, rev ?? 0), error: null });
    },
    [setState],
  );
  const latest = useCallback(() => latestRowsRef.current, []);
  const offline = browserOffline || (listenerSync.fromCache && cacheOnlySettled);
  const pending = listenerSync.pending || keptOffline;
  const sync = useMemo<CutlistSyncState>(() => ({ offline, pending }), [offline, pending]);

  return { ...state, retry, setRawRowsOptimistic, latest, sync };
}
