"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloudCheck, CloudOff, CloudUpload } from "lucide-react";
import { CutlistPresenceEmblems } from "@/components/cutlist-presence-bubbles";
import { useDevModeOn } from "@/lib/dev-mode";
import { isPreviewMode } from "@/lib/preview-mode";
import type { CutlistPresencePerson } from "@/lib/use-cutlist-presence";
import type { CutlistSyncState } from "@/lib/use-project-cutlist";

// A glass bar floating at the bottom right over everything, the same as a page's floating bottom bar and on the same line
// as it (bottom-6, p-1.5, 36px inside), on every page whether that page has one or not. It holds:
//   - the save status, which only comes up when a change has been made: it pops in as it saves, says Saved, and pops away
//     SAVED_SHOWN_MS later. Offline, with changes waiting on this device, it stays up to say so until they've gone. Someone
//     else's changes don't bring it up. In dev mode it's always there (to see where it sits);
//   - to its right, who else is here: an eye and their emblems, which open a pop-up of who's editing and who's viewing.
// The bar never takes a tap from what's under it: only those emblems take one.

const SAVED_SHOWN_MS = 2000;
const POP_AWAY_MS = 180;

type Showing = "saving" | "saved" | "offline";

const LOOKS: Record<Showing, { label: string; title: string; Icon: typeof CloudCheck; color: string; bg: string; border: string }> = {
  offline: {
    label: "Offline — saved on this device",
    title: "You're offline. Your changes are saved on this device and will sync when you're back online.",
    Icon: CloudOff,
    color: "color-mix(in srgb, var(--accent-amber) 72%, var(--text-main))",
    bg: "color-mix(in srgb, var(--accent-amber) 16%, transparent)",
    border: "color-mix(in srgb, var(--accent-amber) 55%, transparent)",
  },
  saving: {
    label: "Saving…",
    title: "Saving your changes…",
    Icon: CloudUpload,
    color: "var(--text-muted)",
    bg: "var(--panel-bg)",
    border: "var(--glass-border)",
  },
  saved: {
    label: "Saved",
    title: "All changes saved",
    Icon: CloudCheck,
    color: "var(--success-strong)",
    bg: "var(--success-soft)",
    border: "var(--success-border)",
  },
};

export function FloatingSavePill({
  sync,
  people,
  colorOf,
  initialsOf,
}: {
  sync: CutlistSyncState;
  people: CutlistPresencePerson[];
  colorOf: (uid: string) => string;
  initialsOf: (name: string) => string;
}) {
  const { offline, pending } = sync;
  const devModeOn = useDevModeOn();
  const [showing, setShowing] = useState<Showing | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Whether a change has been on its way since it last went away: the only thing that can make it say Saved.
  const changeOnItsWayRef = useRef(false);

  /* eslint-disable react-hooks/set-state-in-effect -- the pill follows the save state as it changes, with its own timers */
  useEffect(() => {
    if (pending) {
      changeOnItsWayRef.current = true;
      setLeaving(false);
      setShowing(offline ? "offline" : "saving");
      return;
    }
    if (!changeOnItsWayRef.current) return;
    changeOnItsWayRef.current = false;
    setLeaving(false);
    setShowing("saved");
    let goneTimer = 0;
    const leaveTimer = window.setTimeout(() => {
      setLeaving(true);
      goneTimer = window.setTimeout(() => {
        setShowing(null);
        setLeaving(false);
      }, POP_AWAY_MS);
    }, SAVED_SHOWN_MS);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(goneTimer);
    };
  }, [pending, offline]);

  // The last person leaving: the bar stays a moment for them to pop away.
  const hasPeople = people.length > 0;
  const [peopleLeaving, setPeopleLeaving] = useState(false);
  const hadPeopleRef = useRef(false);
  useEffect(() => {
    if (hasPeople) {
      hadPeopleRef.current = true;
      setPeopleLeaving(false);
      return;
    }
    if (!hadPeopleRef.current) return;
    hadPeopleRef.current = false;
    setPeopleLeaving(true);
    const timer = window.setTimeout(() => setPeopleLeaving(false), POP_AWAY_MS);
    return () => window.clearTimeout(timer);
  }, [hasPeople]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // (The CutSmart Preview's database never hears back from a server, so it would say Saving for ever.)
  const realStatus = isPreviewMode() ? null : showing;
  const status = realStatus ?? (devModeOn ? "saved" : null);
  const statusLeaving = leaving && !devModeOn;
  if ((!status && !hasPeople && !peopleLeaving) || typeof document === "undefined") return null;
  const barLeaving = !hasPeople && ((statusLeaving && !peopleLeaving) || (peopleLeaving && !status));
  const look = status ? LOOKS[status] : null;
  return createPortal(
    <div
      className={`pointer-events-none fixed z-[2147483000] flex max-w-[calc(100vw-24px)] items-center gap-1.5 rounded-full border p-1.5 ${barLeaving ? "glass-bar-pop-away" : "glass-bar-pop"}`}
      style={{
        right: "calc(16px + env(safe-area-inset-right))",
        bottom: 24,
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-modal-bg)",
        backdropFilter: "blur(16px) saturate(200%)",
        WebkitBackdropFilter: "blur(16px) saturate(200%)",
        boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass), 0 16px 40px rgba(15,23,42,0.25)",
      }}
    >
      {look ? (
        <span
          role="status"
          aria-live="polite"
          title={look.title}
          className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-[12px] font-medium ${statusLeaving ? "glass-bar-pop-away" : "glass-bubble-pop"}`}
          style={{ color: look.color, backgroundColor: look.bg, borderColor: look.border }}
        >
          <look.Icon size={15} className="shrink-0" />
          <span className="whitespace-nowrap">{look.label}</span>
        </span>
      ) : null}
      <CutlistPresenceEmblems people={people} colorOf={colorOf} initialsOf={initialsOf} />
    </div>,
    document.body,
  );
}
