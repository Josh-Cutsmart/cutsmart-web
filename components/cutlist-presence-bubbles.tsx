"use client";

import { useEffect, useState } from "react";
import { glassShineStyle } from "@/lib/glass-shine";
import { alsoHereText, type CutlistPresencePerson } from "@/lib/use-cutlist-presence";

// Who else is in a cutlist, in its top bar before the save chip: a bubble each for Editing and Viewing, only with someone
// in it — a pulsing dot (green for Editing, as the Quote's Live Quote; blue for Viewing), its word, then each of them: their
// emblem, in their colour (as the project's Creator / Assigned), and their name (just the emblem on a phone or tablet, where
// there's little room). Two at most; more, as "+N". Someone leaving pops away (and the bubble with them, if they were the last).

// glass-bar-pop-away's length (app/globals.css), and a moment.
const POP_AWAY_MS = 200;

type Row = { person: CutlistPresencePerson; leaving: boolean };

function PresenceBubble({
  people,
  doing,
  compact,
  colorOf,
  initialsOf,
}: {
  people: CutlistPresencePerson[];
  doing: "editing" | "viewing";
  compact: boolean;
  colorOf: (uid: string) => string;
  initialsOf: (name: string) => string;
}) {
  const key = people.map((person) => `${person.uid}:${person.name}`).join("\n");
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

  if (!seen.rows.length) return null;
  const allLeaving = seen.rows.every((row) => row.leaving);
  const here = seen.rows.filter((row) => !row.leaving);
  const text = alsoHereText(here.map((row) => row.person.name), doing);
  const shown = seen.rows.filter((row) => row.leaving || here.indexOf(row) < 2);
  const more = here.length - shown.filter((row) => !row.leaving).length;
  const dot = doing === "editing" ? { ping: "#22C55E", solid: "#16A34A" } : { ping: "#60A5FA", solid: "#2563EB" };
  return (
    <span
      role="status"
      title={text || undefined}
      aria-label={text || undefined}
      className={`${allLeaving ? "glass-bar-pop-away" : "glass-bar-pop"} inline-flex ${compact ? "h-8" : "h-9"} min-w-0 shrink-0 items-center gap-2 rounded-full border pl-3 pr-2.5 text-[12px] font-medium normal-case tracking-normal`}
      style={{
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-modal-bg)",
        backdropFilter: "blur(16px) saturate(200%)",
        WebkitBackdropFilter: "blur(16px) saturate(200%)",
        boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass)",
        color: "var(--text-main)",
      }}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: dot.ping }} />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dot.solid }} />
      </span>
      <span className="shrink-0">{doing === "editing" ? "Editing" : "Viewing"}</span>
      {shown.map(({ person, leaving }) => (
        <span key={person.uid} className={`inline-flex min-w-0 items-center gap-1.5 ${leaving && !allLeaving ? "glass-bar-pop-away" : ""}`}>
          <span
            className="glass-shine inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={glassShineStyle(colorOf(person.uid))}
          >
            {initialsOf(person.name)}
          </span>
          {compact ? null : <span className="max-w-[160px] truncate">{person.name}</span>}
        </span>
      ))}
      {more > 0 ? <span className="shrink-0" style={{ color: "var(--text-muted)" }}>+{more}</span> : null}
    </span>
  );
}

export function CutlistPresenceBubbles({
  people,
  compact,
  colorOf,
  initialsOf,
}: {
  people: CutlistPresencePerson[];
  compact: boolean;
  colorOf: (uid: string) => string;
  initialsOf: (name: string) => string;
}) {
  return (
    <>
      <PresenceBubble people={people.filter((person) => person.editing)} doing="editing" compact={compact} colorOf={colorOf} initialsOf={initialsOf} />
      <PresenceBubble people={people.filter((person) => !person.editing)} doing="viewing" compact={compact} colorOf={colorOf} initialsOf={initialsOf} />
    </>
  );
}
