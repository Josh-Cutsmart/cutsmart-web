"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc, onSnapshot } from "@/lib/firestore-client";
import type { Project, ProjectImageItem } from "@/lib/types";
import {
  fetchProjectMediaData,
  normalizeProjectImageItems,
  resolveProjectDocRef,
  saveProjectFilesData,
  saveProjectImagesData,
} from "@/lib/firestore-data";

export interface ProjectMediaState {
  status: "idle" | "loading" | "ready" | "error";
  projectImages: string[];
  projectImageItems: ProjectImageItem[];
  projectFiles: Record<string, unknown>[];
  // Goes up when someone's change to them arrives, after they're first read.
  liveRev: number;
  error: unknown;
  retry: () => void;
}

// Fetches one project's images and files from their own subcollection docs
// (fetchProjectMediaData/saveProjectImagesData/saveProjectFilesData in lib/firestore-data.ts).
// NOT tab-gated — the Images/Files sections are always-mounted on the project page rather than
// behind a tab click, so there's no "closed" state to defer the fetch behind; this simply fires
// as soon as the project itself resolves, in parallel with everything else, instead of being
// embedded in (and blocking) the initial project fetch. Falls back to the legacy embedded fields
// for a project that hasn't been touched since the subcollection shipped, self-healing (a
// non-blocking migrate write) on a legacy hit — same pattern as every other lazy hook in this
// migration.
export function useProjectMedia(project: Project | null): ProjectMediaState {
  const [state, setState] = useState<Omit<ProjectMediaState, "retry">>({
    status: "idle",
    projectImages: [],
    projectImageItems: [],
    projectFiles: [],
    liveRev: 0,
    error: null,
  });
  const [retryTick, setRetryTick] = useState(0);

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
    const unsubscribes: Array<() => void> = [];

    const run = async () => {
      if (!project?.id) {
        if (!cancelled) {
          setState({ status: "idle", projectImages: [], projectImageItems: [], projectFiles: [], liveRev: 0, error: null });
        }
        return;
      }

      if (!cancelled) setState((prev) => ({ ...prev, status: "loading", error: null }));

      try {
        const [imagesDoc, filesDoc] = await Promise.all([
          fetchProjectMediaData(project, "images"),
          fetchProjectMediaData(project, "files"),
        ]);
        if (cancelled) return;

        let projectImages: string[] = Array.isArray(imagesDoc?.projectImages)
          ? (imagesDoc.projectImages as unknown[]).map(String).filter(Boolean)
          : [];
        let projectImageItems: ProjectImageItem[] = imagesDoc
          ? normalizeProjectImageItems(imagesDoc.projectImageItems)
          : [];
        let projectFiles: Record<string, unknown>[] = Array.isArray(filesDoc?.projectFiles)
          ? (filesDoc.projectFiles as Record<string, unknown>[])
          : [];

        const needsLegacyImages = !imagesDoc;
        const needsLegacyFiles = !filesDoc;
        if (needsLegacyImages || needsLegacyFiles) {
          const ref = await resolveProjectDocRef(project);
          const snap = ref ? await getDoc(ref) : null;
          const rawData = snap?.exists() ? (snap.data() as Record<string, unknown>) : null;

          if (needsLegacyImages) {
            const legacyItems = normalizeProjectImageItems(rawData?.projectImageItems);
            const legacyDirect = Array.isArray(rawData?.projectImages)
              ? (rawData?.projectImages as unknown[]).map(String).filter(Boolean)
              : [];
            projectImageItems = legacyItems;
            projectImages = legacyDirect.length ? legacyDirect : legacyItems.map((item) => item.url);
            void saveProjectImagesData(project, projectImages, projectImageItems);
          }
          if (needsLegacyFiles) {
            projectFiles = Array.isArray(rawData?.projectFiles) ? (rawData?.projectFiles as Record<string, unknown>[]) : [];
            void saveProjectFilesData(project, projectFiles);
          }
        }

        if (cancelled) return;
        setState({ status: "ready", projectImages, projectImageItems, projectFiles, liveRev: 0, error: null });
        // From here, kept up to date: images and files anyone adds, changes or takes away.
        const ref = await resolveProjectDocRef(project);
        if (cancelled || !ref) return;
        let lastImages = JSON.stringify([projectImages, projectImageItems]);
        let lastFiles = JSON.stringify(projectFiles);
        unsubscribes.push(
          onSnapshot(doc(ref, "projectMedia", "images"), (snap) => {
            if (!snap.exists() || (snap.metadata.fromCache && !snap.metadata.hasPendingWrites)) return;
            const data = snap.data() as Record<string, unknown>;
            const items = normalizeProjectImageItems(data.projectImageItems);
            const urls = Array.isArray(data.projectImages) ? (data.projectImages as unknown[]).map(String).filter(Boolean) : [];
            const json = JSON.stringify([urls, items]);
            if (json === lastImages) return;
            lastImages = json;
            setState((prev) => ({ ...prev, projectImages: urls, projectImageItems: items, liveRev: prev.liveRev + 1 }));
          }),
          onSnapshot(doc(ref, "projectMedia", "files"), (snap) => {
            if (!snap.exists() || (snap.metadata.fromCache && !snap.metadata.hasPendingWrites)) return;
            const files = (snap.data() as Record<string, unknown>).projectFiles;
            const rows = Array.isArray(files) ? (files as Record<string, unknown>[]) : [];
            const json = JSON.stringify(rows);
            if (json === lastFiles) return;
            lastFiles = json;
            setState((prev) => ({ ...prev, projectFiles: rows, liveRev: prev.liveRev + 1 }));
          }),
        );
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", projectImages: [], projectImageItems: [], projectFiles: [], liveRev: 0, error });
      }
    };

    void run();
    return () => {
      cancelled = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [projectKey, retryTick]);

  const retry = useCallback(() => setRetryTick((tick) => tick + 1), []);

  return { ...state, retry };
}
