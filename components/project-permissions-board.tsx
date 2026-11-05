"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { DragGhostLayer, useDragGhost } from "@/lib/use-drag-ghost";
import type { ProjectAccessValue, ProjectPermissionRow } from "@/lib/project-permissions";

// Project Permissions' three columns — No Access, View, Edit — each person a card dragged between them. The same on a
// project's Settings tab and in View Access, off its right-click menu (components/project-access-modal.tsx).

export type ProjectPermissionsPalette = { border: string; inputBg: string; inputText: string; panelBg: string; panelMuted: string; textMuted: string; textSoft: string };

const COLUMNS: Array<{ key: ProjectAccessValue; label: string }> = [
  { key: "no_access", label: "No Access" },
  { key: "view", label: "View" },
  { key: "edit", label: "Edit" },
];

export function ProjectPermissionsBoard({
  rows,
  canEdit,
  savingUid,
  onChange,
  colorOf,
  palette,
  isPhone,
  rowExtras,
}: {
  rows: ProjectPermissionRow[];
  canEdit: boolean;
  savingUid: string;
  onChange: (uid: string, access: ProjectAccessValue) => void;
  colorOf: (uid: string) => string;
  palette: ProjectPermissionsPalette;
  isPhone: boolean;
  // Anything else on someone's card (their temporary production access).
  rowExtras?: (row: ProjectPermissionRow) => ReactNode;
}) {
  const ghost = useDragGhost();
  const [search, setSearch] = useState<Record<ProjectAccessValue, string>>({ no_access: "", view: "", edit: "" });
  const [draggingUid, setDraggingUid] = useState("");
  const [dropColumn, setDropColumn] = useState<"" | ProjectAccessValue>("");
  // A phone: tabs in one row, this one open, taking the width; the others closed to a narrow strip. Edit to start with.
  const [openColumn, setOpenColumn] = useState<ProjectAccessValue>("edit");
  // A column with more than fits: its search box.
  const [overflow, setOverflow] = useState<Record<ProjectAccessValue, boolean>>({ no_access: false, view: false, edit: false });
  const scrollRefs = useRef<Record<ProjectAccessValue, HTMLDivElement | null>>({ no_access: null, view: null, edit: null });
  useEffect(() => {
    const measure = () => {
      setOverflow((prev) => {
        const next = { no_access: false, view: false, edit: false };
        for (const { key } of COLUMNS) {
          const element = scrollRefs.current[key];
          next[key] = Boolean(element && element.scrollHeight > element.clientHeight + 1);
        }
        return prev.no_access === next.no_access && prev.view === next.view && prev.edit === next.edit ? prev : next;
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [search, draggingUid, savingUid, rows, openColumn]);

  const drop = (access: ProjectAccessValue) => {
    const row = rows.find((item) => item.uid === draggingUid);
    setDropColumn("");
    setDraggingUid("");
    ghost.end();
    if (row && !row.isLocked && row.accessValue !== access) onChange(row.uid, access);
  };

  return (
    <>
      <DragGhostLayer controller={ghost} />
      <div className={isPhone ? "flex" : "grid grid-cols-3 gap-0"}>
        {COLUMNS.map((column) => {
          const typed = search[column.key].trim().toLowerCase();
          const columnRows = rows.filter((row) => row.accessValue === column.key && (!typed || row.displayName.toLowerCase().includes(typed)));
          const isDropActive = dropColumn === column.key;
          // A phone: the open one takes the width; the others close to a narrow strip with just their name and count,
          // sliding aside — tap one to slide it open. A dragged card can be dropped straight onto a closed one. Bigger: the
          // three side by side.
          const isClosedTab = isPhone && openColumn !== column.key;
          return (
            <div
              key={column.key}
              onDragOver={(event) => {
                if (!canEdit || !draggingUid) return;
                event.preventDefault();
                if (dropColumn !== column.key) setDropColumn(column.key);
              }}
              onDrop={(event) => {
                if (!canEdit) return;
                event.preventDefault();
                drop(column.key);
              }}
              className={`flex h-[468px] flex-col transition ${isPhone ? "min-w-0 overflow-hidden" : ""} ${isClosedTab ? "px-0 py-3" : "px-4 py-3"}`}
              style={{
                backgroundColor: isDropActive ? "color-mix(in srgb, var(--brand) 9%, transparent)" : "transparent",
                borderRight: column.key !== "edit" ? `1px solid ${palette.border}` : undefined,
                ...(isPhone
                  ? {
                      flexGrow: isClosedTab ? 0 : 1,
                      flexShrink: 0,
                      flexBasis: 52,
                      transition: "flex-grow 320ms cubic-bezier(0.22, 1, 0.36, 1), background-color 150ms ease",
                    }
                  : {}),
              }}
            >
              {isClosedTab ? (
                <button type="button" onClick={() => setOpenColumn(column.key)} className="flex h-full w-full flex-col items-center gap-3" aria-label={`${column.label} (${columnRows.length})`}>
                  <span className="rounded-full border px-2 py-[2px] text-[11px] font-bold" style={{ borderColor: palette.border, backgroundColor: palette.inputBg, color: palette.textMuted }}>
                    {columnRows.length}
                  </span>
                  <span className="whitespace-nowrap text-[12px] font-medium uppercase" style={{ writingMode: "vertical-rl", letterSpacing: "0.12em", color: "var(--text-main)" }}>
                    {column.label}
                  </span>
                </button>
              ) : (
                <>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-[12px] font-medium uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                      {column.label}
                    </p>
                    <span className="rounded-full border px-2 py-[2px] text-[11px] font-bold" style={{ borderColor: palette.border, backgroundColor: palette.inputBg, color: palette.textMuted }}>
                      {columnRows.length}
                    </span>
                  </div>
                  {overflow[column.key] ? (
                    <input
                      value={search[column.key]}
                      onChange={(e) => setSearch((prev) => ({ ...prev, [column.key]: e.target.value }))}
                      placeholder="Search staff"
                      className="mb-3 h-9 w-full rounded-[10px] border px-3 text-[12px] outline-none"
                      style={{ borderColor: palette.border, backgroundColor: palette.inputBg, color: palette.inputText }}
                    />
                  ) : null}
                  <div
                    ref={(node) => {
                      scrollRefs.current[column.key] = node;
                    }}
                    className="min-h-0 flex-1 overflow-y-auto"
                  >
                    <div className="space-y-2">
                      {columnRows.map((row) => {
                        const isDragging = draggingUid === row.uid;
                        const draggable = canEdit && !row.isLocked && savingUid !== row.uid;
                        const name = row.displayName.trim() || "CU";
                        const parts = name.split(/\s+/).filter(Boolean);
                        const initials = parts.length >= 2 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() : `${parts[0]?.[0] ?? name[0] ?? ""}`.toUpperCase();
                        const color = colorOf(row.uid);
                        const elementId = `project-permission-row-${row.uid}`;
                        return (
                          <div
                            key={row.uid}
                            id={elementId}
                            draggable={draggable}
                            onDragStart={(event) => {
                              if (!draggable) return;
                              setDraggingUid(row.uid);
                              setDropColumn(column.key);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", row.uid);
                              if (ghost.transparentImageRef.current) event.dataTransfer.setDragImage(ghost.transparentImageRef.current, 0, 0);
                              ghost.spawn(event, elementId, { label: name, color });
                            }}
                            onDragEnd={() => {
                              setDraggingUid("");
                              setDropColumn("");
                              ghost.end();
                            }}
                            className={`rounded-[12px] border px-3 py-2 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "opacity-60" : ""}`}
                            style={{ borderColor: isDragging ? "#8FB4FF" : palette.border, backgroundColor: row.isLocked ? palette.panelMuted : palette.panelBg }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white" style={{ backgroundColor: color }} title="User icon">
                                  {initials || "CU"}
                                </div>
                                <div className="flex min-w-0 items-center gap-2">
                                  <p className="min-w-0 truncate font-semibold" style={{ color: palette.textSoft }}>
                                    {row.displayName}
                                  </p>
                                  {rowExtras?.(row)}
                                </div>
                              </div>
                              {row.isLocked ? (
                                <span className="shrink-0 rounded-full border px-2 py-[2px] text-[10px] font-bold uppercase tracking-[0.6px]" style={{ borderColor: palette.border, backgroundColor: palette.panelMuted, color: palette.textMuted }}>
                                  Locked
                                </span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                      {isDropActive && draggingUid ? (
                        <div className="rounded-[12px] border border-dashed border-[#8FB4FF] bg-[#EAF1FF] px-3 py-2 shadow-[inset_0_0_0_1px_rgba(143,180,255,0.18)]">
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.6px] text-[#24589A]">
                            <span className="inline-block h-2 w-2 rounded-full bg-[#5B8DEF]" />
                            Drop Here
                          </div>
                        </div>
                      ) : null}
                      {columnRows.length === 0 ? (
                        <div className="rounded-[12px] border border-dashed" style={{ borderColor: palette.border }}>
                          <EmptyState compact icon={<Users size={16} />} title="No staff in this column" />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
