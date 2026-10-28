"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useFloatingNotice } from "@/components/floating-notice";

// The Undo bar — after anything's deleted, anywhere in the app: the yellow glass pill along the bottom of the screen
// ("Blum removed · Undo") for 7 seconds, and for as long as the mouse is over it; pressed, it puts back what went (the
// delete's own `undo`). One at a time — a
// newer delete's takes its place (the one before staying deleted). While it shows, the other bars along the bottom
// (marked data-bottom-bar: the pages' floating bars and buttons, their bottom bars, the Preview's) step aside for it,
// coming back as it goes (app/globals.css).
//
// `const offerUndo = useUndo();` then, after a delete, `offerUndo("Patel Kitchen deleted", () => putItBack())`.
//
// A delete too big to put back once it's done (a project and everything under it): hidden straight away, but done only as
// the bar goes without Undo being pressed (its time up, or closed) — `offerUndo(message, () => showItAgain(), { commit: ()
// => reallyDeleteIt() })`. Done then too when another delete takes the bar's place, or the page is left.
export type OfferUndo = (message: string, undo: () => void | Promise<unknown>, options?: { commit?: () => void | Promise<unknown> }) => void;

const UNDO_MS = 7000;
const UndoContext = createContext<OfferUndo | null>(null);

export function UndoBarProvider({ children }: { children: ReactNode }) {
  // The delete waiting on the bar (its commit, if it has one) — done as the bar goes, unless it's undone.
  const pendingRef = useRef<{ commit?: () => void | Promise<unknown> } | null>(null);
  const flush = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    if (pending.commit) {
      void Promise.resolve()
        .then(pending.commit)
        .catch((error) => console.warn("[undo] couldn't finish the delete:", error));
    }
  }, []);
  // (Its time up — held while the mouse is over it — or closed: what's waiting is done.)
  const notice = useFloatingNotice({ durationMs: UNDO_MS, tone: "yellow", takesBottom: true, onHidden: flush });
  // (The latest show — useFloatingNotice's is new each render — so offerUndo stays the same one.)
  const showRef = useRef(notice.show);
  useEffect(() => {
    showRef.current = notice.show;
  });
  useEffect(() => {
    // (Leaving the page: what's waiting is done now.)
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);
  const offerUndo = useCallback<OfferUndo>(
    (message, undo, options) => {
      flush();
      const entry = { commit: options?.commit };
      pendingRef.current = entry;
      showRef.current(message, null, {
        label: "Undo",
        onClick: () => {
          if (pendingRef.current === entry) pendingRef.current = null;
          void Promise.resolve()
            .then(undo)
            .catch((error) => console.warn("[undo] couldn't put it back:", error));
        },
      });
    },
    [flush],
  );
  return (
    <UndoContext.Provider value={offerUndo}>
      {children}
      {notice.element}
    </UndoContext.Provider>
  );
}

// (Outside the provider — nothing to show it in: a commit's done at once.)
const noUndo: OfferUndo = (_message, _undo, options) => {
  if (options?.commit) void Promise.resolve().then(options.commit);
};

export function useUndo(): OfferUndo {
  return useContext(UndoContext) ?? noUndo;
}
