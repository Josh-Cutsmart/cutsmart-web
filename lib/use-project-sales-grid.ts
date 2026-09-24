"use client";

import { useCallback, useEffect, useState } from "react";
import { getDoc } from "firebase/firestore";
import type { Project } from "@/lib/types";
import { normalizeSpecsGrid, type SpecsGrid } from "@/lib/specs-grid-types";
import {
  extractLegacySalesFieldFromRawDoc,
  fetchSalesGridData,
  resolveProjectDocRef,
  saveSalesGridData,
} from "@/lib/firestore-data";

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
}

const LEGACY_KEY_BY_KIND: Record<SalesGridKind, string> = {
  quote: "quoteGrid",
  specifications: "specificationsGrid",
};

// Lazily fetches one project's live Quote grid or Specifications grid from its own subcollection
// doc (fetchSalesGridData/saveSalesGridData in lib/firestore-data.ts), only once `enabled` (the
// owning Sales sub-nav is actually open) — falling back to the legacy embedded `sales.quoteGrid`/
// `sales.specificationsGrid` field for a project that hasn't been touched since the subcollection
// shipped. normalizeProject no longer parses either field into `project` at all, so this fallback
// is a fresh, separate `getDoc`. On a legacy hit, fires a non-blocking write to migrate it
// immediately, same reasoning as use-project-cutlist.ts/use-project-checklists.ts.
export function useProjectSalesGrid(project: Project | null, kind: SalesGridKind, enabled: boolean): ProjectSalesGridState {
  const [state, setState] = useState<Omit<ProjectSalesGridState, "retry" | "setGridOptimistic">>({
    status: "idle",
    grid: null,
    error: null,
  });
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!enabled || !project?.id) {
        if (!cancelled) setState({ status: "idle", grid: null, error: null });
        return;
      }

      if (!cancelled) setState((prev) => ({ ...prev, status: "loading", error: null }));

      try {
        const stored = await fetchSalesGridData(project, kind);
        if (cancelled) return;
        if (stored) {
          setState({ status: "ready", grid: stored.grid, error: null });
          return;
        }

        const ref = await resolveProjectDocRef(project);
        const snap = ref ? await getDoc(ref) : null;
        const legacyRaw = snap?.exists()
          ? extractLegacySalesFieldFromRawDoc(snap.data() as Record<string, unknown>, LEGACY_KEY_BY_KIND[kind])
          : undefined;
        const legacyGrid = normalizeSpecsGrid(legacyRaw);
        if (cancelled) return;
        setState({ status: "ready", grid: legacyGrid, error: null });
        if (legacyGrid) {
          void saveSalesGridData(project, kind, legacyGrid);
        }
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", grid: null, error });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [project, kind, enabled, retryTick]);

  const retry = useCallback(() => setRetryTick((tick) => tick + 1), []);
  const setGridOptimistic = useCallback((grid: SpecsGrid) => {
    setState((prev) => ({ ...prev, status: "ready", grid, error: null }));
  }, []);

  return { ...state, retry, setGridOptimistic };
}
