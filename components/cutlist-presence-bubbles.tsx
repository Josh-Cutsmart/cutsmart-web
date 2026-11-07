"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Users } from "lucide-react";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { glassShineStyle } from "@/lib/glass-shine";
import type { CutlistPresencePerson } from "@/lib/use-cutlist-presence";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

// Who else is on this page, in the floating bar at the bottom right (components/floating-save-pill.tsx): one eye, then
// everyone's emblem together, in their colour (as the project's Creator / Assigned). Someone leaving pops away. Clicking it
// opens a pop-up of who's editing, and below that who's viewing.

// glass-bar-pop-away's length (app/globals.css), and a moment.
const POP_AWAY_MS = 200;

const DOTS = {
  editing: { ping: "#22C55E", solid: "#16A34A" },
  viewing: { ping: "#60A5FA", solid: "#2563EB" },
};

type Row = { person: CutlistPresencePerson; leaving: boolean };

function PulsingDot({ doing }: { doing: "editing" | "viewing" }) {
  const dot = DOTS[doing];
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: dot.ping }} />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dot.solid }} />
    </span>
  );
}

export function CutlistPresenceEmblems({
  people,
  colorOf,
  initialsOf,
}: {
  people: CutlistPresencePerson[];
  colorOf: (uid: string) => string;
  initialsOf: (name: string) => string;
}) {
  const key = people.map((person) => `${person.uid}:${person.name}:${person.editing}`).join("\n");
  const [seen, setSeen] = useState<{ key: string; rows: Row[] }>({ key, rows: people.map((person) => ({ person, leaving: false })) });
  // Who's gone stays a moment, in their place, to pop away.
  if (seen.key !== key) {
    const stay: Row[] = seen.rows.map((row) => {
      const still = people.find((person) => person.uid === row.person.uid);
      return still ? { person: still, leaving: false } : { person: row.person, leaving: true };
    });
    const added = people.filter((person) => !seen.rows.some((row) => row.person.uid === person.uid)).map((person) => ({ person, leaving: false }));
    setSeen({ key, rows: [...stay, ...added] });
  }
  const anyLeaving = seen.rows.some((row) => row.leaving);
  useEffect(() => {
    if (!anyLeaving) return;
    const timer = window.setTimeout(() => setSeen((prev) => ({ ...prev, rows: prev.rows.filter((row) => !row.leaving) })), POP_AWAY_MS);
    return () => window.clearTimeout(timer);
  }, [anyLeaving, key]);

  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<GlassModalOrigin>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = useGlassModalPopOrigin(open, origin, panelRef);
  // (Everyone gone while it's open: nothing to show.)
  const hasPeople = people.length > 0;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!hasPeople) setOpen(false);
  }, [hasPeople]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const emblem = (person: CutlistPresencePerson, size: string) => (
    <span
      className={`glass-shine inline-flex ${size} shrink-0 items-center justify-center rounded-full font-bold text-white`}
      style={glassShineStyle(colorOf(person.uid))}
    >
      {initialsOf(person.name)}
    </span>
  );
  const lists = [
    { doing: "editing" as const, title: "Editing", rows: people.filter((person) => person.editing) },
    { doing: "viewing" as const, title: "Viewing", rows: people.filter((person) => !person.editing) },
  ];
  const allLeaving = seen.rows.length > 0 && seen.rows.every((row) => row.leaving);
  return (
    <>
      {seen.rows.length ? (
        <button
          type="button"
          aria-label={`${people.length} ${people.length === 1 ? "person" : "people"} on this page. Show who's editing and viewing`}
          title="Who's here"
          onClick={(event) => {
            setOrigin(captureGlassModalOrigin(event));
            setOpen(true);
          }}
          className={`${allLeaving ? "glass-bar-pop-away" : "glass-bar-pop"} pointer-events-auto inline-flex h-9 min-w-0 shrink items-center gap-1 overflow-hidden rounded-full px-1.5`}
          style={{ color: "var(--text-muted)" }}
        >
          <Eye size={17} className="mr-0.5 shrink-0" aria-hidden="true" />
          {seen.rows.map(({ person, leaving }) => (
            <span key={person.uid} className={`inline-flex shrink-0 ${leaving && !allLeaving ? "glass-bar-pop-away" : "glass-bubble-pop"}`}>
              {emblem(person, "h-7 w-7 text-[10px]")}
            </span>
          ))}
        </button>
      ) : null}
      {shouldRender && typeof document !== "undefined"
        ? createPortal(
            <div className="pointer-events-auto fixed inset-0 z-[2147483646] flex items-center justify-center px-4">
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="glass-modal-backdrop absolute inset-0" />
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Who's here"
                data-phone-keep-box="true"
                className="glass-modal-panel relative z-[2147483647] w-[min(440px,96vw)] overflow-hidden"
              >
                <GlassModalHeader title="Who's here" icon={<Users />} onClose={() => setOpen(false)} />
                <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
                  {lists.map(({ doing, title, rows }) => (
                    <div key={doing} className="space-y-2.5">
                      <p className="flex items-center gap-2 text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>
                        <PulsingDot doing={doing} />
                        {title}
                      </p>
                      {rows.length ? (
                        rows.map((person) => (
                          <div key={person.uid} className="flex min-w-0 items-center gap-2.5">
                            {emblem(person, "h-8 w-8 text-[11px]")}
                            <span className="min-w-0 truncate text-[15px] font-medium" style={{ color: "var(--text-main)" }}>
                              {person.name}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-[14px] font-medium" style={{ color: "var(--text-muted)" }}>
                          No one
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
