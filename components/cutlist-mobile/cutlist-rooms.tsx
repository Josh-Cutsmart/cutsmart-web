"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, Plus } from "lucide-react";
import { glassShineStyle } from "@/lib/glass-shine";
import { CutlistSheet } from "./cutlist-sheet";

// A room of the phone / tablet cutlist: its parts (quantities added up) and its part types' mix — the coloured bar the
// computer's Rooms column has under each room.
export type CutlistRoomMixItem = { partType: string; count: number; color: string };
export type CutlistRoomItem = { key: string; label: string; partCount: number; mix: CutlistRoomMixItem[]; isProject?: boolean };

export const formatPartsLabel = (count: number) => `${count} ${count === 1 ? "part" : "parts"}`;

export function CutlistMixBar({ mix, className = "", title }: { mix: CutlistRoomMixItem[]; className?: string; title?: string }) {
  return (
    <span aria-hidden="true" title={title} className={`flex h-[5px] w-full gap-[2px] ${className}`}>
      {mix.length ? (
        mix.map((item) => (
          <span key={item.partType} className="h-full min-w-[3px] rounded-full" style={{ flex: item.count, backgroundColor: item.color }} />
        ))
      ) : (
        <span className="h-full flex-1 rounded-full bg-[var(--glass-border)]" />
      )}
    </span>
  );
}

// Under the top bar: < and > to step through the rooms (Project cutlist last, as the strip it replaces had it), and the
// room's name — tapped, the Rooms sheet — with its mix bar under it.
export function CutlistRoomBar({
  rooms,
  activeKey,
  onSelect,
  onOpenRooms,
}: {
  rooms: CutlistRoomItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  onOpenRooms: () => void;
}) {
  const index = Math.max(0, rooms.findIndex((room) => room.key === activeKey));
  const room = rooms[index];
  // Stepping to another room: its name and mix bar slide in from the way it went (> from the right, < from the left —
  // one picked in the Rooms sheet, from whichever side it's on).
  const slideRef = useRef<HTMLSpanElement | null>(null);
  const shownIndexRef = useRef(index);
  useLayoutEffect(() => {
    const from = shownIndexRef.current;
    shownIndexRef.current = index;
    const el = slideRef.current;
    if (!el || from === index || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dir = index > from ? 1 : -1;
    el.animate(
      [
        { transform: `translateX(${dir * 42}%)`, opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [index]);
  const stepClass =
    "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-30";
  return (
    // (The same track as the Entry / List switch under it — settings-ui's Segmented — so the two read as a pair.)
    <div
      className="flex h-[56px] items-center gap-1 rounded-[18px] border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_55%,transparent)] px-1.5"
      style={{ color: "var(--text-main)" }}
    >
      <button type="button" className={stepClass} disabled={index <= 0} onClick={() => onSelect(rooms[index - 1]?.key ?? activeKey)} aria-label="Previous room">
        <ChevronLeft size={20} strokeWidth={2.4} />
      </button>
      <button type="button" onClick={onOpenRooms} className="flex min-w-0 flex-1 flex-col items-stretch justify-center overflow-hidden px-1 py-1" aria-label={`Rooms — ${room?.label ?? ""}`}>
        <span ref={slideRef} className="flex min-w-0 flex-col items-stretch">
        <span className="flex min-w-0 items-center justify-center gap-1">
          <span className="truncate text-[16px] font-semibold" style={{ color: "var(--text-main)" }}>
            {room?.label ?? ""}
          </span>
          <ChevronDown size={15} strokeWidth={2.4} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        </span>
        <CutlistMixBar mix={room?.mix ?? []} className="mx-auto mt-[6px] max-w-[220px]" />
        </span>
      </button>
      <button
        type="button"
        className={stepClass}
        disabled={index >= rooms.length - 1}
        onClick={() => onSelect(rooms[index + 1]?.key ?? activeKey)}
        aria-label="Next room"
      >
        <ChevronRight size={20} strokeWidth={2.4} />
      </button>
    </div>
  );
}

// The cutlist under the room bar (its Entry or List): another room (or Project cutlist) slides it in from the way it went —
// a room further on from the right, one back from the left — as the room bar's name does. `index`: the room's place in
// the rooms (as the room bar has them).
export function CutlistRoomSlide({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const shownIndexRef = useRef(index);
  useLayoutEffect(() => {
    const from = shownIndexRef.current;
    shownIndexRef.current = index;
    const el = ref.current;
    if (!el || from === index || index < 0 || from < 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dir = index > from ? 1 : -1;
    el.animate(
      [
        { transform: `translateX(${dir * 100}%)`, opacity: 0.4 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [index]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

function RoomButton({ room, active, onClick, compact = false }: { room: CutlistRoomItem; active: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`flex w-full flex-col rounded-[12px] text-left transition ${compact ? "px-3 py-2" : "px-3.5 py-3"} ${active ? "" : "active:bg-[var(--panel-muted)]"}`}
      style={{ backgroundColor: active ? "var(--brand-soft)" : undefined }}
    >
      <span className="flex min-w-0 items-center gap-2">
        {room.isProject ? <LayoutGrid size={14} className="shrink-0" style={{ color: active ? "var(--brand-strong)" : "var(--text-muted)" }} /> : null}
        <span className={`min-w-0 flex-1 truncate font-medium ${compact ? "text-[13px]" : "text-[15px]"}`} style={{ color: active ? "var(--brand-strong)" : "var(--text-main)" }}>
          {room.label}
        </span>
        <span className="shrink-0 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
          {formatPartsLabel(room.partCount)}
        </span>
      </span>
      <CutlistMixBar mix={room.mix} className="mt-[7px]" />
    </button>
  );
}

function AddRoomButton({ onAddRoom, disabled }: { onAddRoom: (el: HTMLElement) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => onAddRoom(e.currentTarget)}
      className="glass-shine inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border text-[14px] font-medium text-white transition hover:brightness-95 disabled:opacity-55"
      style={glassShineStyle("#16A34A")}
    >
      <Plus size={17} strokeWidth={2.6} />
      Add room
    </button>
  );
}

// The Rooms sheet: each room (its parts and mix bar), the one showing picked out; then Project cutlist; Add room.
export function CutlistRoomsSheet({
  open,
  onClose,
  rooms,
  activeKey,
  onSelect,
  onAddRoom,
  canAddRoom,
}: {
  open: boolean;
  onClose: () => void;
  rooms: CutlistRoomItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  onAddRoom: (el: HTMLElement) => void;
  canAddRoom: boolean;
}) {
  const ownRooms = rooms.filter((room) => !room.isProject);
  const project = rooms.find((room) => room.isProject);
  return (
    <CutlistSheet
      open={open}
      onClose={onClose}
      title="Rooms"
      footer={<AddRoomButton onAddRoom={onAddRoom} disabled={!canAddRoom} />}
    >
      <div className="space-y-1 px-2 pb-2">
        {ownRooms.map((room) => (
          <RoomButton
            key={room.key}
            room={room}
            active={room.key === activeKey}
            onClick={() => {
              onSelect(room.key);
              onClose();
            }}
          />
        ))}
        {project ? (
          <>
            <div className="mx-2 my-2 h-px bg-[var(--glass-border)]" />
            <RoomButton
              room={project}
              active={project.key === activeKey}
              onClick={() => {
                onSelect(project.key);
                onClose();
              }}
            />
          </>
        ) : null}
      </div>
    </CutlistSheet>
  );
}

// A landscape tablet's left rail: the rooms (each with its mix bar), Project cutlist, Add room, then whatever else goes
// there (`footer` — the Notes button).
export function CutlistRoomRail({
  rooms,
  activeKey,
  onSelect,
  onAddRoom,
  canAddRoom,
  footer,
}: {
  rooms: CutlistRoomItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  onAddRoom: (el: HTMLElement) => void;
  canAddRoom: boolean;
  footer?: ReactNode;
}) {
  const ownRooms = rooms.filter((room) => !room.isProject);
  const project = rooms.find((room) => room.isProject);
  return (
    <div
      className="glass-shine glass-shine-neutral flex max-h-full flex-col rounded-[18px] border p-2"
      style={{ borderColor: "var(--glass-border)", color: "var(--text-main)" }}
    >
      <p className="px-2 pb-1.5 pt-1 text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>
        Rooms
      </p>
      <div className="glass-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
        {ownRooms.map((room) => (
          <RoomButton key={room.key} room={room} compact active={room.key === activeKey} onClick={() => onSelect(room.key)} />
        ))}
        {project ? (
          <>
            <div className="mx-2 my-2 h-px bg-[var(--glass-border)]" />
            <RoomButton room={project} compact active={project.key === activeKey} onClick={() => onSelect(project.key)} />
          </>
        ) : null}
      </div>
      <div className="mt-2 space-y-2">
        <AddRoomButton onAddRoom={onAddRoom} disabled={!canAddRoom} />
        {footer}
      </div>
    </div>
  );
}
