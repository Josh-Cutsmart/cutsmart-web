"use client";

import { useCallback, useEffect, useState } from "react";
import { getDoc } from "firebase/firestore";
import type { Project, ProjectChecklist } from "@/lib/types";
import {
  fetchProjectChecklistsData,
  migrateLegacyProjectChecklists,
  normalizeProjectChecklists,
  resolveProjectDocRef,
} from "@/lib/firestore-data";

export interface ProjectChecklistsState {
  status: "idle" | "loading" | "ready" | "error";
  checklists: ProjectChecklist[];
  error: unknown;
  retry: () => void;
  // Lets a save function optimistically advance the last-known checklists right after a
  // successful write, without waiting for a re-fetch.
  setChecklistsOptimistic: (checklists: ProjectChecklist[]) => void;
}

// Lazily fetches one project's checklists from their own subcollection (one doc per checklist —
// see fetchProjectChecklistsData/saveProjectChecklist/deleteProjectChecklist in
// lib/firestore-data.ts), only once `enabled` (the Project Management modal is actually open).
// Falls back to the legacy embedded `checklists` array on the job doc for a project that hasn't
// been touched since the subcollection shipped — normalizeProject no longer parses that field at
// all, so this fallback is a fresh, separate `getDoc`. On a legacy hit, fires a non-blocking
// write to migrate every checklist to its own subcollection doc immediately, same reasoning as
// use-project-cutlist.ts.
export function useProjectChecklists(project: Project | null, enabled: boolean): ProjectChecklistsState {
  const [state, setState] = useState<Omit<ProjectChecklistsState, "retry" | "setChecklistsOptimistic">>({
    status: "idle",
    checklists: [],
    error: null,
  });
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!enabled || !project?.id) {
        if (!cancelled) setState({ status: "idle", checklists: [], error: null });
        return;
      }

      if (!cancelled) setState((prev) => ({ ...prev, status: "loading", error: null }));

      try {
        const stored = await fetchProjectChecklistsData(project);
        if (cancelled) return;
        if (stored) {
          setState({ status: "ready", checklists: stored, error: null });
          return;
        }

        // Subcollection came back empty — ambiguous (genuinely no checklists yet, or simply not
        // migrated) — check the legacy embedded field directly to tell the two apart.
        const ref = await resolveProjectDocRef(project);
        const snap = ref ? await getDoc(ref) : null;
        const legacy = snap?.exists()
          ? normalizeProjectChecklists((snap.data() as Record<string, unknown>).checklists)
          : [];
        if (cancelled) return;
        setState({ status: "ready", checklists: legacy, error: null });
        if (legacy.length) {
          void migrateLegacyProjectChecklists(project, legacy);
        }
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", checklists: [], error });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [project, enabled, retryTick]);

  const retry = useCallback(() => setRetryTick((tick) => tick + 1), []);
  const setChecklistsOptimistic = useCallback((checklists: ProjectChecklist[]) => {
    setState((prev) => ({ ...prev, status: "ready", checklists, error: null }));
  }, []);

  return { ...state, retry, setChecklistsOptimistic };
}
