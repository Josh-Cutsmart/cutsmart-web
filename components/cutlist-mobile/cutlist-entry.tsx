"use client";

import { useCallback, useRef, useState, type Dispatch, type ReactNode, type Ref, type SetStateAction } from "react";
import { ChevronDown, Copy, NotebookPen, X } from "lucide-react";
import { glassShineStyle } from "@/lib/glass-shine";
import { Segmented } from "@/components/settings-ui";

// A part type's colours for a card (from the cutlist's own cutlistTablePalette): its header bar, its body, the lines
// round it and its words.
export type CutlistCardTone = { barBg: string; barText: string; bodyBg: string; border: string; text: string };

// A size as three numbers, each with a tiny H / W / D over it (`captions` — a Cabinetry part's, as the CNC Cutlist's
// cabinet cards have it), or plain "H × W × D". The one its grain runs along underlined.
export function CutlistHwdSize({
  height,
  width,
  depth,
  captions,
  grain,
  className = "",
}: {
  height: string;
  width: string;
  depth: string;
  captions: boolean;
  grain?: "height" | "width" | "depth" | null;
  className?: string;
}) {
  const parts = (
    [
      ["height", "H", height],
      ["width", "W", width],
      ["depth", "D", depth],
    ] as const
  ).filter(([, , value]) => String(value || "").trim());
  if (!parts.length) return <span className={className}>-</span>;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${captions ? "pt-[7px]" : ""} ${className}`}>
      {parts.map(([key, letter, value], index) => (
        <span key={key} className="inline-flex items-center gap-1">
          {index > 0 ? <span className="text-[10px] opacity-70">×</span> : null}
          <span className="relative inline-block">
            {captions ? (
              <span className="absolute inset-x-0 -top-[8px] text-center text-[7px] font-bold uppercase leading-none opacity-80">{letter}</span>
            ) : null}
            <span style={grain === key ? { fontWeight: 700, textDecoration: "underline" } : undefined}>{value}</span>
          </span>
        </span>
      ))}
    </span>
  );
}

// The Cutlist Entry's cards' folding: each folded to a line or not. When a new card's added, the ones there before it
// fold away (the new one open) — not on first showing, nor when cards just go. `state`: the folds kept by the page
// instead (saved, so they're as left after a reload).
export function useAutoFoldDrafts(
  ids: string[],
  state?: [Record<string, boolean>, Dispatch<SetStateAction<Record<string, boolean>>>],
) {
  const key = ids.join("|");
  const ownState = useState<Record<string, boolean>>({});
  const [folded, setFolded] = state ?? ownState;
  const [seenKey, setSeenKey] = useState<string | null>(null);
  if (seenKey !== key) {
    setSeenKey(key);
    if (seenKey !== null) {
      const before = new Set(seenKey ? seenKey.split("|") : []);
      const added = ids.filter((id) => !before.has(id));
      if (added.length && before.size) {
        setFolded((prev) => {
          const next = { ...prev };
          for (const id of ids) next[id] = !added.includes(id);
          return next;
        });
      }
    }
  }
  const toggle = useCallback((id: string) => setFolded((prev) => ({ ...prev, [id]: !prev[id] })), [setFolded]);
  const setOne = useCallback(
    (id: string, value: boolean) => setFolded((prev) => (Boolean(prev[id]) === value ? prev : { ...prev, [id]: value })),
    [setFolded],
  );
  return { folded, toggle, setFolded: setOne };
}

const DOUBLE_TAP_MS = 350;

// One part being entered: its header bar in its part type's colour (fold chevron, part type and name, duplicate and
// remove), its fields below it on a pale wash of it — or, folded, a line of what it is. `boxed`: a card with rounded
// corners (two across, on a tablet); otherwise the screen's full width, edge to edge.
export function CutlistEntryCard({
  tone,
  partType,
  name,
  subPart = false,
  folded,
  onToggleFold,
  onDuplicate,
  onRemove,
  onForceRemove,
  readOnly,
  summary,
  children,
  boxed = false,
  cardRef,
}: {
  tone: CutlistCardTone;
  partType: string;
  name: string;
  subPart?: boolean;
  folded: boolean;
  onToggleFold: () => void;
  onDuplicate?: () => void;
  onRemove: () => void;
  // A double tap of its X (two within DOUBLE_TAP_MS — a touch screen seldom sends a double-click): removed even with
  // what's filled in, as a double-click does on a computer.
  onForceRemove?: () => void;
  readOnly: boolean;
  summary: ReactNode;
  children: ReactNode;
  boxed?: boolean;
  cardRef?: Ref<HTMLDivElement>;
}) {
  const lastRemoveTapRef = useRef(0);
  const pressRemove = (timeStamp: number) => {
    const doubleTap = onForceRemove && timeStamp - lastRemoveTapRef.current < DOUBLE_TAP_MS;
    lastRemoveTapRef.current = doubleTap ? 0 : timeStamp;
    if (doubleTap && onForceRemove) onForceRemove();
    else onRemove();
  };
  // Its fields only spill out of their box (a dropdown's menu…) once it's finished opening — while it opens or shuts
  // they're clipped, so they slide rather than show outside it.
  const [openSettled, setOpenSettled] = useState(!folded);
  if (folded && openSettled) setOpenSettled(false);
  return (
    <div
      ref={cardRef}
      className={`overflow-visible ${boxed ? "rounded-[16px] border" : "border-y"} ${subPart ? (boxed ? "" : "ml-4") : ""}`}
      style={{
        backgroundColor: tone.bodyBg,
        borderColor: tone.border,
        color: tone.text,
        boxShadow: subPart ? "inset 3px 0 0 var(--brand-strong)" : undefined,
      }}
    >
      <div
        className={`flex min-h-[48px] items-center gap-2 pl-2 pr-2 ${boxed ? "rounded-t-[15px]" : ""} ${folded && boxed ? "rounded-b-[15px]" : ""}`}
        style={{ backgroundColor: tone.barBg, color: tone.barText }}
      >
        <button
          type="button"
          onClick={onToggleFold}
          aria-expanded={!folded}
          className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2 pl-1 text-left"
          title={folded ? "Show this part" : "Fold this part away"}
        >
          <ChevronDown size={18} className="shrink-0 transition-transform duration-200" style={{ transform: folded ? "rotate(-90deg)" : undefined }} />
          {subPart ? (
            <span className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.5px]" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}>
              ↳ Sub part
            </span>
          ) : null}
          <span className="shrink-0 text-[14px] font-semibold">{partType}</span>
          {name.trim() ? <span className="min-w-0 flex-1 truncate text-[14px] font-medium opacity-90">· {name}</span> : null}
        </button>
        {onDuplicate ? (
          <button
            type="button"
            disabled={readOnly}
            onClick={onDuplicate}
            className="glass-shine glass-shine-neutral inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border disabled:opacity-55"
            style={{ color: "var(--text-main)" }}
            aria-label="Duplicate"
            title="Duplicate"
          >
            <Copy size={15} />
          </button>
        ) : null}
        <button
          type="button"
          disabled={readOnly}
          onClick={(e) => pressRemove(e.timeStamp)}
          className="glass-shine inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-white hover:brightness-95 disabled:opacity-55"
          style={glassShineStyle("var(--danger)", { touchAction: "manipulation" })}
          aria-label="Remove"
          title={onForceRemove ? "Remove (double-tap to remove a filled-in part)" : "Remove"}
        >
          <X size={16} strokeWidth={2.8} />
        </button>
      </div>
      {/* Folded, its line of what it is: slides open as the fields slide shut, its text fading in once they have (the
          fold's 220ms); opened again, it slides away up with its text fading out. */}
      <div style={{ display: "grid", gridTemplateRows: folded ? "1fr" : "0fr", transition: "grid-template-rows 220ms ease" }} inert={!folded}>
        <div className="min-h-0 overflow-hidden">
          <button
            type="button"
            onClick={onToggleFold}
            className={`flex min-h-[44px] w-full items-center gap-2 px-4 py-2 text-left text-[13px] font-medium ${boxed ? "rounded-b-[15px]" : ""}`}
            style={{
              color: tone.text,
              opacity: folded ? 1 : 0,
              transition: folded ? "opacity 240ms ease-out 200ms" : "opacity 140ms ease-in",
            }}
          >
            {summary}
          </button>
        </div>
      </div>
      {/* Folds shut and open (0fr/1fr) — its fields kept, so nothing typed is lost while it's shut. Held to the bottom of
          their box (justify-end), so they slide away up into the header as it shuts, and down out of it as it opens. */}
      <div
        style={{ display: "grid", gridTemplateRows: folded ? "0fr" : "1fr", transition: "grid-template-rows 220ms ease" }}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === "grid-template-rows" && !folded) setOpenSettled(true);
        }}
      >
        <div className={`flex min-h-0 flex-col justify-end ${openSettled ? "overflow-visible" : "overflow-hidden"}`} inert={folded}>
          <div
            className="cutlist-touch px-4 pb-4 pt-3"
            style={{ opacity: folded ? 0 : 1, transition: folded ? "opacity 200ms ease-in" : "opacity 200ms ease-out 60ms" }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// Entry · N and List · N parts: which of the two has the screen below it. (`entryDisabled`: Project cutlist — every
// room's list, nothing to enter there.) `trailing`: beside it (the Notes button).
export function CutlistViewSwitch({
  view,
  onChange,
  entryCount,
  listPartCount,
  entryDisabled = false,
  trailing,
}: {
  view: "entry" | "list";
  onChange: (view: "entry" | "list") => void;
  entryCount: number;
  listPartCount: number;
  entryDisabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {/* (The app's sliding toggle — a tap anywhere on it flips to the other.) */}
      <div className="min-w-0 flex-1">
        <Segmented
          value={view}
          onChange={onChange}
          options={[
            { value: "entry", label: `Entry · ${entryCount}` },
            { value: "list", label: `List · ${listPartCount} ${listPartCount === 1 ? "part" : "parts"}` },
          ]}
          disabled={entryDisabled}
          tone="brand"
          size="lg"
          pill
          fill
          flip
          strongText
        />
      </div>
      {trailing}
    </div>
  );
}

// The Notes button (its sheet: the cutlist's Notes, the contractors' and Cabinetry) — how many of them have notes, on it.
export function CutlistNotesButton({ count, onClick, label = false }: { count: number; onClick: () => void; label?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // (The same track as the Entry / List switch beside it — settings-ui's Segmented.)
      className={`relative inline-flex h-[40px] shrink-0 items-center justify-center gap-2 rounded-full border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_55%,transparent)] ${label ? "w-full px-4 text-[14px] font-medium" : "w-[40px]"}`}
      style={{ color: "var(--text-main)" }}
      aria-label={count ? `Notes (${count} with notes)` : "Notes"}
      title="Notes"
    >
      <NotebookPen size={18} />
      {label ? "Notes" : null}
      {count > 0 ? (
        <span
          className={`${label ? "" : "absolute -right-1 -top-1"} inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white`}
          style={{ backgroundColor: "var(--brand)" }}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
