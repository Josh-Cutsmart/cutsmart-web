"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onSnapshot } from "@/lib/firestore-client";
import { projectLiveReader, resolveProjectDocRef } from "@/lib/firestore-data";
import type { Project } from "@/lib/types";
import type { CutlistSyncState } from "@/lib/use-project-cutlist";

// The project's own document kept up to date while it's open, as a cutlist is (lib/use-project-cutlist.ts): anyone's change
// to its details, settings or hardware reaches `onProject` as it reaches the database, and a change made here at once. And
// whether this screen's changes have reached the database (its save chip).

// The database on this device's copy for a moment, as the listener starts, isn't being offline: only once it's stayed so
// this long (as a cutlist's).
const CACHE_ONLY_OFFLINE_AFTER_MS = 2000;

export function useProjectLive(
  project: Project | null,
  onProject: (fresh: Project) => void,
): { sync: CutlistSyncState; ready: boolean; docPath: string } {
  const [docPath, setDocPath] = useState("");
  const [listener, setListener] = useState({ ready: false, fromCache: false, pending: false });
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

  const latestRef = useRef({ project, onProject });
  useEffect(() => {
    latestRef.current = { project, onProject };
  });
  const projectKey = project?.id ? `${project.companyId ?? ""}::${project.id}` : "";

  useEffect(() => {
    const current = latestRef.current.project;
    if (!projectKey || !current) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let settleTimer: number | null = null;
    let heardFromServer = false;
    let lastJson = "";
    void (async () => {
      const [ref, read] = await Promise.all([resolveProjectDocRef(current), projectLiveReader(current)]);
      if (cancelled || !ref) return;
      setDocPath(ref.path);
      unsubscribe = onSnapshot(
        ref,
        { includeMetadataChanges: true },
        (snap) => {
          const fromCache = snap.metadata.fromCache;
          const pending = snap.metadata.hasPendingWrites;
          setListener((prev) => (prev.ready && prev.fromCache === fromCache && prev.pending === pending ? prev : { ready: true, fromCache, pending }));
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
          }
          if (!snap.exists()) return;
          // (This device's old copy, as it starts: the page already has newer. Not one with a change made here in it.)
          if (fromCache && !pending && !heardFromServer) return;
          const data = snap.data() as Record<string, unknown>;
          const json = JSON.stringify(data);
          if (json === lastJson) return;
          lastJson = json;
          if (data.isPurged === true) return;
          latestRef.current.onProject(read(data));
        },
        (error) => console.warn("[useProjectLive] listener failed:", error),
      );
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      setListener({ ready: false, fromCache: false, pending: false });
      setCacheOnlySettled(false);
    };
  }, [projectKey]);

  const offline = browserOffline || (listener.fromCache && cacheOnlySettled);
  const sync = useMemo<CutlistSyncState>(() => ({ offline, pending: listener.pending }), [offline, listener.pending]);
  return { sync, ready: listener.ready, docPath };
}
