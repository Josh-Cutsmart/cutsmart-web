"use client";

import { useEffect, useRef, useState } from "react";
import { deleteField, doc, onSnapshot, setDoc, type DocumentReference } from "@/lib/firestore-client";
import { resolveProjectDocRef } from "@/lib/firestore-data";
import type { Project } from "@/lib/types";
import type { CutlistDataKind } from "@/lib/use-project-cutlist";

// Who else is in a project's cutlist right now ("Anna is also editing"). Everyone with it open (and able to edit it,
// `announce`) keeps an entry in cutlistData/{kind}Presence — one per open tab, refreshed once a minute while the tab is
// on screen (a write each time, and a read for everyone in that cutlist — kept slow for that), and taken out when they
// leave it, hide the tab or close it. Shown: the others (not this person, in any of their tabs) whose entry was refreshed
// within FRESH_MS, by when it was heard here — not the writer's clock, so a computer with its clock out doesn't make
// anyone look here or gone. Who's shown is looked over every CHECK_MS (nothing read or written for that), so someone
// whose tab closed without saying so is gone about 2½ minutes after their last refresh. An entry left behind like that
// is cleared by the next person in, once it's 10 minutes old.
// (cutlistData/{kind} is open to the project's company in firestore.rules — the same as the cutlist itself.)

type PresenceEntry = { uid?: string; name?: string; at?: string };
// Someone else in the cutlist: who (their emblem's colour is by it) and their name.
export type CutlistPresencePerson = { uid: string; name: string };

const BEAT_MS = 60_000;
// Two refreshes' time and a bit — one that's late or lost on the way doesn't drop anyone.
const FRESH_MS = 130_000;
const CHECK_MS = 15_000;
const LEFT_OVER_MS = 10 * 60_000;
const NO_ONE: CutlistPresencePerson[] = [];

export function useCutlistPresence(
  project: Project | null,
  kind: CutlistDataKind,
  open: boolean,
  announce: boolean,
  me: { uid: string; name: string } | null,
): CutlistPresencePerson[] {
  const latestProjectRef = useRef(project);
  useEffect(() => {
    latestProjectRef.current = project;
  }, [project]);
  const projectKey = project?.id ? `${project.companyId ?? ""}::${project.id}` : "";
  const uid = me?.uid ?? "";
  const name = me?.name ?? "";
  const listenKey = open && projectKey && uid ? `${projectKey}::${kind}` : "";
  const [tabKey] = useState(() => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const [others, setOthers] = useState<{ key: string; people: CutlistPresencePerson[] }>({ key: "", people: NO_ONE });

  useEffect(() => {
    const project = latestProjectRef.current;
    if (!listenKey || !project) return;
    let cancelled = false;
    let unsubscribe = () => {};
    let ref: DocumentReference | null = null;
    let latest: Record<string, PresenceEntry> = {};
    // When each entry was last heard to change, here.
    const heard = new Map<string, { at: string; heardMs: number }>();

    const refresh = () => {
      const nowMs = Date.now();
      const byUid = new Map<string, string>();
      for (const [key, entry] of Object.entries(latest)) {
        if (key === tabKey || !entry || typeof entry !== "object" || entry.uid === uid) continue;
        const heardMs = heard.get(key)?.heardMs ?? 0;
        const writtenMs = Date.parse(String(entry.at || ""));
        if (!(nowMs - heardMs < FRESH_MS) || !(Math.abs(nowMs - writtenMs) < LEFT_OVER_MS)) continue;
        const entryUid = String(entry.uid || key);
        if (!byUid.has(entryUid)) byUid.set(entryUid, String(entry.name || "").trim() || "Someone");
      }
      const people = [...byUid.entries()].map(([uid, name]) => ({ uid, name })).sort((a, b) => a.name.localeCompare(b.name));
      const sameAs = (list: CutlistPresencePerson[]) => list.map((person) => `${person.uid}:${person.name}`).join("\n");
      setOthers((prev) =>
        prev.key === listenKey && sameAs(prev.people) === sameAs(people) ? prev : { key: listenKey, people: people.length ? people : NO_ONE },
      );
    };
    const beat = () => {
      refresh();
      if (!ref || !announce || document.hidden) return;
      const nowMs = Date.now();
      const leftOver = Object.entries(latest)
        .filter(([key, entry]) => key !== tabKey && !(nowMs - Date.parse(String(entry?.at || "")) < LEFT_OVER_MS))
        .map(([key]) => [key, deleteField()]);
      void setDoc(
        ref,
        { viewers: { ...Object.fromEntries(leftOver), [tabKey]: { uid, name, at: new Date(nowMs).toISOString() } } },
        { merge: true },
      ).catch(() => undefined);
    };
    const leave = () => {
      if (!ref || !announce) return;
      void setDoc(ref, { viewers: { [tabKey]: deleteField() } }, { merge: true }).catch(() => undefined);
    };
    const onVisibility = () => (document.hidden ? leave() : beat());
    const timer = window.setInterval(beat, BEAT_MS);
    const checkTimer = window.setInterval(refresh, CHECK_MS);

    void resolveProjectDocRef(project).then((projectRef) => {
      if (cancelled || !projectRef) return;
      ref = doc(projectRef, "cutlistData", `${kind}Presence`);
      unsubscribe = onSnapshot(
        ref,
        (snap) => {
          const viewers = (snap.data()?.viewers ?? {}) as Record<string, PresenceEntry>;
          latest = viewers && typeof viewers === "object" ? viewers : {};
          for (const [key, entry] of Object.entries(latest)) {
            const at = String(entry?.at || "");
            if (heard.get(key)?.at !== at) heard.set(key, { at, heardMs: Date.now() });
          }
          refresh();
        },
        () => undefined,
      );
      beat();
    });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", leave);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearInterval(checkTimer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [listenKey, kind, announce, uid, name, tabKey]);

  return listenKey && others.key === listenKey ? others.people : NO_ONE;
}

// "Anna is also editing", "Anna and Ben are also editing", "Anna, Ben and 2 others are also editing".
export function alsoEditingText(names: string[]): string {
  if (!names.length) return "";
  const who =
    names.length === 1
      ? names[0]
      : names.length <= 3
        ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
        : `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
  return `${who} ${names.length === 1 ? "is" : "are"} also editing`;
}
