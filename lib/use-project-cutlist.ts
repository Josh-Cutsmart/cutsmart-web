"use client";

import { useCallback, useEffect, useState } from "react";
import { getDoc } from "firebase/firestore";
import type { Project } from "@/lib/types";
import {
  extractLegacySalesFieldFromRawDoc,
  fetchCutlistData,
  parseCutlistRows,
  resolveProjectDocRef,
  saveCutlistData,
} from "@/lib/firestore-data";

export type CutlistDataKind = "production" | "initialMeasure";

export interface ProjectCutlistRawState {
  status: "idle" | "loading" | "ready" | "error";
  rawRows: unknown[];
  error: unknown;
  retry: () => void;
  // Lets a save function optimistically advance the last-known rows right after a successful
  // write, without waiting for a re-fetch — mirrors the old `setProject(prev => ({...prev,
  // cutlist: nextCutlist}))` pattern this hook replaces.
  setRawRowsOptimistic: (rows: unknown[]) => void;
}

// Lazily fetches one project's cutlist rows from their own subcollection (fetchCutlistData/
// saveCutlistData in lib/firestore-data.ts), only once `enabled` (the owning tab is actually
// open) — falling back to the legacy embedded `cutlist`/`cutlistJson` job-doc fields for a
// project that hasn't been touched since that subcollection shipped. normalizeProject no longer
// parses those legacy fields into `project.cutlist` at all, so this fallback is a fresh, separate
// `getDoc`, not something recoverable from already-loaded `project` state. On a legacy hit, fires
// a non-blocking write to migrate this project's cutlist to the subcollection immediately (rather
// than waiting for the next edit) — safe because viewing a job doc and writing to it require the
// same permission in this app's Firestore rules.
export function useProjectCutlistRaw(
  project: Project | null,
  kind: CutlistDataKind,
  enabled: boolean,
): ProjectCutlistRawState {
  const [state, setState] = useState<Omit<ProjectCutlistRawState, "retry" | "setRawRowsOptimistic">>({
    status: "idle",
    rawRows: [],
    error: null,
  });
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!enabled || !project?.id) {
        if (!cancelled) setState({ status: "idle", rawRows: [], error: null });
        return;
      }

      if (!cancelled) setState((prev) => ({ ...prev, status: "loading", error: null }));

      try {
        const stored = await fetchCutlistData(project, kind);
        if (cancelled) return;
        if (stored) {
          setState({ status: "ready", rawRows: stored.rows, error: null });
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
        setState({ status: "ready", rawRows: legacyRows, error: null });
        // Self-heal: write straight to the subcollection now that we've read the legacy data,
        // instead of waiting for the user to make an actual edit.
        void saveCutlistData(project, kind, legacyRows);
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", rawRows: [], error });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [project, kind, enabled, retryTick]);

  const retry = useCallback(() => setRetryTick((tick) => tick + 1), []);
  const setRawRowsOptimistic = useCallback((rows: unknown[]) => {
    setState((prev) => ({ ...prev, status: "ready", rawRows: rows, error: null }));
  }, []);

  return { ...state, retry, setRawRowsOptimistic };
}
