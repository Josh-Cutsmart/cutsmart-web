"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { onSnapshot } from "@/lib/firestore-client";
import {
  hasOfflineCutlistChange,
  ORDER_LIST_FIELD,
  resolveProjectDocRef,
  sendOfflineCutlistChanges,
  subscribeOfflineCutlistChanges,
  type OrderListKind,
} from "@/lib/firestore-data";
import type { Project } from "@/lib/types";
import type { CutlistSyncState } from "@/lib/use-project-cutlist";

// Production › Order's lists — its hinges, other items and misc lines (the project's settings' ORDER_LIST_FIELD fields,
// by hardware category) — kept up to date as a cutlist is (lib/use-project-cutlist.ts), while `enabled` (Order open):
// someone else's change to them reaches `onLists` as it reaches the database (what the screen does with it — putting it
// onto any edits there not saved yet — is the project page's), and whether this screen's changes to them have reached the
// database (its save chip). Changes kept on this device from being offline (lib/firestore-data.ts) are sent the moment
// it hears from the server again.

// Each of the lists, as stored — by its field (ORDER_LIST_FIELD's); null: none yet.
export type OrderLists = Record<string, unknown>;

const ORDER_KINDS = Object.keys(ORDER_LIST_FIELD) as OrderListKind[];
// The database on this device's copy for a moment — as the listener starts — isn't being offline: only once it's stayed so
// this long (as a cutlist's).
const CACHE_ONLY_OFFLINE_AFTER_MS = 2000;

// The project's settings as stored: an object (or, on one not saved since they moved, its old JSON copy).
function storedSettings(data: Record<string, unknown>): Record<string, unknown> {
  const settings = data.projectSettings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) return settings as Record<string, unknown>;
  if (typeof data.projectSettingsJson === "string") {
    try {
      const parsed: unknown = JSON.parse(data.projectSettingsJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export function useProjectOrderLive(
  project: Project | null,
  enabled: boolean,
  onLists: (lists: OrderLists) => void,
): { ready: boolean; sync: CutlistSyncState } {
  const onListsRef = useRef(onLists);
  useEffect(() => {
    onListsRef.current = onLists;
  });
  const latestProjectRef = useRef(project);
  useEffect(() => {
    latestProjectRef.current = project;
  }, [project]);
  const projectKey = project?.id ? `${project.companyId ?? ""}::${project.id}` : "";
  const listenKey = enabled && projectKey ? projectKey : "";

  // Its listener's news (for the project it's listening to — `key`): from this device's copy only, changes not sent yet,
  // and where the project is in the database (what's kept from being offline is by it).
  const [heard, setHeard] = useState<{ key: string; path: string; fromCache: boolean; pending: boolean }>({
    key: "",
    path: "",
    fromCache: false,
    pending: false,
  });
  // ...and it's been on this device's copy CACHE_ONLY_OFFLINE_AFTER_MS.
  const [cacheOnlySettledKey, setCacheOnlySettledKey] = useState("");
  const path = heard.key === listenKey ? heard.path : "";
  const keptOffline = useSyncExternalStore(
    subscribeOfflineCutlistChanges,
    () => Boolean(path) && ORDER_KINDS.some((kind) => hasOfflineCutlistChange(path, kind)),
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

  useEffect(() => {
    const project = latestProjectRef.current;
    if (!listenKey || !project) return;
    let cancelled = false;
    let unsubscribe = () => {};
    let settleTimer: number | null = null;
    // The lists as last passed on (only a change to them is).
    let lastLists = "";

    void resolveProjectDocRef(project).then((ref) => {
      if (cancelled || !ref) return;
      unsubscribe = onSnapshot(
        ref,
        // (With its metadata's changes too: a save reaching the server, the connection going and coming.)
        { includeMetadataChanges: true },
        (snap) => {
          const fromCache = snap.metadata.fromCache;
          const pending = snap.metadata.hasPendingWrites;
          setHeard((prev) =>
            prev.key === listenKey && prev.path === ref.path && prev.fromCache === fromCache && prev.pending === pending
              ? prev
              : { key: listenKey, path: ref.path, fromCache, pending },
          );
          if (fromCache) {
            if (settleTimer === null) {
              settleTimer = window.setTimeout(() => {
                settleTimer = null;
                setCacheOnlySettledKey(listenKey);
              }, CACHE_ONLY_OFFLINE_AFTER_MS);
            }
          } else {
            if (settleTimer !== null) window.clearTimeout(settleTimer);
            settleTimer = null;
            setCacheOnlySettledKey("");
            // Hearing from the server again: Order's changes kept here from being offline sent now.
            for (const kind of ORDER_KINDS) {
              if (hasOfflineCutlistChange(ref.path, kind)) void sendOfflineCutlistChanges({ path: ref.path, kind });
            }
          }
          if (!snap.exists()) return;
          const settings = storedSettings(snap.data() as Record<string, unknown>);
          const lists: OrderLists = Object.fromEntries(Object.values(ORDER_LIST_FIELD).map((field) => [field, settings[field] ?? null]));
          const signature = JSON.stringify(lists);
          if (signature === lastLists) return;
          lastLists = signature;
          onListsRef.current(lists);
        },
        (error) => console.warn("[useProjectOrderLive] listener failed:", error),
      );
    });
    return () => {
      cancelled = true;
      unsubscribe();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, [listenKey]);

  const ready = Boolean(listenKey) && heard.key === listenKey;
  const offline = browserOffline || (ready && heard.fromCache && cacheOnlySettledKey === listenKey);
  const pending = (ready && heard.pending) || keptOffline;
  const sync = useMemo<CutlistSyncState>(() => ({ offline, pending }), [offline, pending]);
  return { ready, sync };
}
