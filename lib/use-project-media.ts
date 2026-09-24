"use client";

import { useCallback, useEffect, useState } from "react";
import { getDoc } from "firebase/firestore";
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
    error: null,
  });
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!project?.id) {
        if (!cancelled) {
          setState({ status: "idle", projectImages: [], projectImageItems: [], projectFiles: [], error: null });
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
        setState({ status: "ready", projectImages, projectImageItems, projectFiles, error: null });
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", projectImages: [], projectImageItems: [], projectFiles: [], error });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [project, retryTick]);

  const retry = useCallback(() => setRetryTick((tick) => tick + 1), []);

  return { ...state, retry };
}
