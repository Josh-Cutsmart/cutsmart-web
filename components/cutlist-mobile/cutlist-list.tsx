"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { glassShineStyle } from "@/lib/glass-shine";
import { CutlistHwdSize } from "./cutlist-entry";

// The phone / tablet Cutlist List: its part types' tables (title bar in the part type's colour, folding, its count),
// each part a compact card — or, on a landscape tablet, rows with proper columns. A part tapped: its Edit sheet (the
// page's). Select: a circle on each, the page's own bar of what to do with them.
export type CutlistListTone = {
  barBg: string;
  barText: string;
  chipBg: string;
  headerBg: string;
  headerText: string;
  rowBg: string;
  subRowBg: string;
  divider: string;
  border: string;
  text: string;
  strip: string;
};

export type CutlistListCardData = {
  id: string;
  name: string;
  // A Custom piece: its own part type's pill.
  pill?: { label: string; bg: string; text: string } | null;
  board: string;
  // Under the name, after the board: its clashing — a Cabinetry part's "Base · 1 adj".
  extra: string;
  height: string;
  width: string;
  depth: string;
  // H / W / D over the numbers (Cabinetry).
  captions: boolean;
  grain?: "height" | "width" | "depth" | null;
  qty: string;
  clashing: string;
  info: string;
  room?: string;
  // Has pieces / details to show under it (a cabinet's pieces, a drawer's, a Custom piece's shape).
  expandable: boolean;
  // The first of its table's Custom area: the slim "Custom" heading over it.
  customAreaStart?: { label: string; count: string } | null;
  // Its strip's colour, when not its table's (a Custom piece's own part type).
  stripColor?: string;
};

export type CutlistListGroupData = {
  key: string;
  title: string;
  tone: CutlistListTone;
  countLabel: string;
  collapsed: boolean;
  cards: CutlistListCardData[];
};

export type CutlistListColumns = { room: boolean; clashing: boolean; info: boolean };

export function CutlistListToolbar({
  search,
  onSearch,
  filter,
  select,
}: {
  search: string;
  onSearch: (value: string) => void;
  filter?: ReactNode;
  select?: { active: boolean; onToggle: () => void; disabled?: boolean } | null;
}) {
  return (
    <div className="flex items-center gap-2">
      {/* (Its search, filter and Select: the same track as the Entry / List switch — settings-ui's Segmented.) */}
      <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_55%,transparent)] px-3" style={{ color: "var(--text-main)" }}>
        <Search size={15} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search"
          className="min-w-0 flex-1 bg-transparent text-[14px] font-medium outline-none placeholder:text-[var(--text-muted)]"
          style={{ color: "var(--text-main)" }}
        />
        {search ? (
          <button type="button" onClick={() => onSearch("")} aria-label="Clear search" className="shrink-0" style={{ color: "var(--text-muted)" }}>
            <X size={15} />
          </button>
        ) : null}
      </label>
      {filter}
      {select ? (
        <button
          type="button"
          disabled={select.disabled}
          onClick={select.onToggle}
          aria-pressed={select.active}
          className={`inline-flex h-9 shrink-0 items-center rounded-full px-4 text-[14px] font-medium disabled:opacity-50 ${select.active ? "glass-shine border text-white" : "border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_55%,transparent)]"}`}
          style={select.active ? glassShineStyle("var(--brand)") : { color: "var(--text-main)" }}
        >
          {select.active ? "Done" : "Select"}
        </button>
      ) : null}
    </div>
  );
}

function SelectCircle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2"
      style={{ borderColor: on ? "var(--brand)" : "color-mix(in srgb, currentColor 40%, transparent)", backgroundColor: on ? "var(--brand)" : "transparent" }}
    >
      {on ? <Check size={13} strokeWidth={3} color="#ffffff" /> : null}
    </span>
  );
}

export function CutlistListView({
  groups,
  layout,
  columns,
  onToggleGroup,
  onOpen,
  select,
  renderDetails,
  empty,
}: {
  groups: CutlistListGroupData[];
  layout: "cards" | "table";
  columns: CutlistListColumns;
  onToggleGroup: (key: string) => void;
  onOpen: (id: string, groupKey: string, el: HTMLElement) => void;
  select?: { active: boolean; selected: ReadonlySet<string>; onToggle: (id: string) => void; onToggleGroup: (ids: string[]) => void } | null;
  renderDetails: (id: string) => ReactNode;
  empty?: ReactNode;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const selecting = Boolean(select?.active);
  if (!groups.length) return <>{empty}</>;
  const tableTemplate = [
    selecting ? "34px" : "",
    "minmax(160px,1.6fr)",
    "minmax(110px,1fr)",
    "minmax(130px,auto)",
    "56px",
    columns.clashing ? "minmax(80px,0.6fr)" : "",
    columns.info ? "minmax(100px,1fr)" : "",
    columns.room ? "minmax(90px,0.7fr)" : "",
    "36px",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const { tone } = group;
        const groupIds = group.cards.map((card) => card.id);
        const allPicked = selecting && groupIds.length > 0 && groupIds.every((id) => select?.selected.has(id));
        return (
          <section key={group.key} className={layout === "table" ? "overflow-hidden rounded-[16px] border" : "border-y"} style={{ borderColor: tone.border }}>
            <div className="flex items-center" style={{ backgroundColor: tone.barBg, color: tone.barText }}>
              {selecting ? (
                <button type="button" onClick={() => select?.onToggleGroup(groupIds)} className="pl-3" aria-label={allPicked ? "Unselect this table" : "Select this table"}>
                  <SelectCircle on={allPicked} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onToggleGroup(group.key)}
                aria-expanded={!group.collapsed}
                className="flex min-h-[46px] min-w-0 flex-1 items-center justify-between gap-3 px-3 text-left"
              >
                <span className="min-w-0 truncate text-[15px] font-semibold">{group.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full px-2 py-[2px] text-[11px] font-medium" style={{ backgroundColor: tone.chipBg }}>
                    {group.countLabel}
                  </span>
                  <ChevronDown size={16} className="transition-transform duration-200" style={{ transform: group.collapsed ? "rotate(-90deg)" : undefined }} />
                </span>
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateRows: group.collapsed ? "0fr" : "1fr", transition: "grid-template-rows 220ms ease" }}>
              <div className="min-h-0 overflow-hidden">
                {layout === "table" ? (
                  <div
                    className="grid items-center gap-x-3 border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.4px]"
                    style={{ gridTemplateColumns: tableTemplate, backgroundColor: tone.headerBg, color: tone.headerText, borderColor: tone.divider }}
                  >
                    {selecting ? <span /> : null}
                    <span>Part</span>
                    <span>Board</span>
                    <span>Size</span>
                    <span className="text-center">Qty</span>
                    {columns.clashing ? <span>Clashing</span> : null}
                    {columns.info ? <span>Information</span> : null}
                    {columns.room ? <span>Room</span> : null}
                    <span />
                  </div>
                ) : null}
                {group.cards.map((card, index) => {
                  const picked = Boolean(select?.selected.has(card.id));
                  const open = Boolean(expanded[card.id]);
                  const press = (el: HTMLElement) => {
                    if (selecting) select?.onToggle(card.id);
                    else onOpen(card.id, group.key, el);
                  };
                  const arrow = card.expandable ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded((prev) => ({ ...prev, [card.id]: !prev[card.id] }));
                      }}
                      aria-expanded={open}
                      aria-label={open ? "Hide its pieces" : "Show its pieces"}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ color: tone.text }}
                    >
                      <ChevronDown size={17} className="transition-transform duration-200" style={{ transform: open ? "rotate(180deg)" : undefined }} />
                    </button>
                  ) : (
                    <span className="w-9 shrink-0" />
                  );
                  const nameBlock = (
                    <span className="flex min-w-0 items-center gap-1.5">
                      {card.pill ? (
                        <span className="inline-block max-w-[84px] shrink-0 truncate rounded-full px-2 py-[1px] text-[10px] font-medium" style={{ backgroundColor: card.pill.bg, color: card.pill.text }}>
                          {card.pill.label}
                        </span>
                      ) : null}
                      <span className="min-w-0 truncate text-[14px] font-semibold">{card.name || "-"}</span>
                    </span>
                  );
                  return (
                    <div key={card.id}>
                      {card.customAreaStart ? (
                        <div className="flex items-center gap-2 px-3 py-1 text-[11px] font-medium" style={{ backgroundColor: tone.barBg, color: tone.barText, borderTop: index > 0 ? `1px solid ${tone.border}` : undefined }}>
                          <span>{card.customAreaStart.label}</span>
                          <span className="rounded-full px-2 py-[2px] text-[10px] leading-none" style={{ backgroundColor: tone.chipBg }}>
                            {card.customAreaStart.count}
                          </span>
                        </div>
                      ) : null}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => press(e.currentTarget)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          press(e.currentTarget);
                        }}
                        aria-pressed={selecting ? picked : undefined}
                        className="relative cursor-pointer select-none active:brightness-95"
                        style={{
                          backgroundColor: picked ? `color-mix(in srgb, var(--brand) 14%, ${tone.rowBg})` : tone.rowBg,
                          color: tone.text,
                          borderTop: index > 0 && !card.customAreaStart ? `1px solid ${tone.divider}` : undefined,
                        }}
                      >
                        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[4px]" style={{ backgroundColor: card.stripColor ?? tone.strip }} />
                        {layout === "table" ? (
                          <div className="grid min-h-[48px] items-center gap-x-3 py-1.5 pl-4 pr-1 text-[13px] font-medium" style={{ gridTemplateColumns: tableTemplate }}>
                            {selecting ? <SelectCircle on={picked} /> : null}
                            {nameBlock}
                            <span className="truncate">{card.board || "-"}</span>
                            <CutlistHwdSize height={card.height} width={card.width} depth={card.depth} captions={card.captions} grain={card.grain} />
                            <span className="text-center">{card.qty || "-"}</span>
                            {columns.clashing ? <span className="truncate">{card.clashing || card.extra || "-"}</span> : null}
                            {columns.info ? <span className="truncate opacity-80">{card.info || ""}</span> : null}
                            {columns.room ? <span className="truncate">{card.room || "-"}</span> : null}
                            {arrow}
                          </div>
                        ) : (
                          <div className="flex min-h-[58px] items-center gap-2.5 py-2 pl-4 pr-1">
                            {selecting ? <SelectCircle on={picked} /> : null}
                            <div className="min-w-0 flex-1">
                              {nameBlock}
                              <p className="mt-0.5 truncate text-[12px] font-medium opacity-80">
                                {[card.board || "No board", card.extra, columns.room ? card.room : ""].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <CutlistHwdSize className="text-[13px] font-medium" height={card.height} width={card.width} depth={card.depth} captions={card.captions} grain={card.grain} />
                              <span className="min-w-[32px] rounded-full px-2.5 py-1 text-center text-[13px] font-semibold leading-none" style={{ backgroundColor: tone.chipBg }}>
                                ×{card.qty || "0"}
                              </span>
                            </div>
                            {arrow}
                          </div>
                        )}
                      </div>
                      {card.expandable && open ? (
                        <div className="border-t px-4 py-2 text-[12px] font-medium" style={{ backgroundColor: tone.subRowBg, borderColor: tone.divider, color: tone.text }}>
                          {renderDetails(card.id)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
