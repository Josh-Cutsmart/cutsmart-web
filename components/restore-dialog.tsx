"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";

// The "Restore …?" confirmation used for archived items — on a project's own page (its Restore button)
// and on the Archive page's rows. For a project it reads "Restore as [status ▾]": the status (and
// sub-status) it comes back in, picked from the same colour pills as the Dashboard's status menu.
// Render it only while it's open — it starts from the props it mounts with.

export type RestoreSubStage = { name: string; color: string; isDefault: boolean };
export type RestoreStatusOption = { name: string; color: string; subStages: RestoreSubStage[] };

// The company's project statuses (Company Settings → Project statuses, raw from the company doc) with
// their colours and sub-statuses. `alsoInclude` adds any status that isn't in the list (e.g. one a
// project still has after it was renamed), in grey.
export function restoreStatusOptionsFrom(projectStatuses: unknown, alsoInclude: string[] = []): RestoreStatusOption[] {
  const rows = Array.isArray(projectStatuses) ? projectStatuses : [];
  const options: RestoreStatusOption[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    const subStages = (Array.isArray(row.subStages) ? row.subStages : [])
      .filter((sub): sub is Record<string, unknown> => Boolean(sub) && typeof sub === "object")
      .map((sub) => ({
        name: String(sub.name ?? "").trim(),
        color: String(sub.color ?? "").trim() || "#64748B",
        isDefault: Boolean(sub.isDefault),
      }))
      .filter((sub) => sub.name);
    options.push({ name, color: String(row.color ?? "").trim() || "#64748B", subStages });
  }
  for (const extra of alsoInclude) {
    const name = String(extra || "").trim();
    if (name && !options.some((option) => option.name.toLowerCase() === name.toLowerCase())) {
      options.push({ name, color: "#64748B", subStages: [] });
    }
  }
  return options;
}

// Dark text on very light pills, white on the rest (same cut-off as the Dashboard's status pills).
function pillTextColor(fill: string): string {
  const clean = String(fill || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "#FFFFFF";
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.75 ? "#0F172A" : "#FFFFFF";
}

// Same panel look as the app's other dropdown menus (GLASS_DROPDOWN_MENU_STYLE on the project page).
const MENU_STYLE: CSSProperties = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-modal-bg)",
  backdropFilter: "blur(12px) saturate(220%)",
  WebkitBackdropFilter: "blur(12px) saturate(220%)",
  boxShadow: "inset 0 0 0 999px color-mix(in srgb, var(--panel-bg) 22%, transparent), var(--shadow-glass)",
};

export function RestoreDialog({
  title,
  statusOptions,
  initialStatus = "",
  initialSubStage = "",
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  // A project's statuses, to pick the one it comes back in; leave out for anything without a status.
  statusOptions?: RestoreStatusOption[];
  initialStatus?: string;
  initialSubStage?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (status: string, subStage: string) => void;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [subStage, setSubStage] = useState(initialSubStage);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [expandedStatus, setExpandedStatus] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The status list closes on a press outside it, and that press does nothing else (the app-wide
  // dropdown rule — see lib/swallow-dismiss-click.ts).
  useEffect(() => {
    if (!isMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setIsMenuOpen(false);
      swallowNextClick();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isMenuOpen]);

  if (typeof document === "undefined") return null;
  const colorOf = (name: string) =>
    statusOptions?.find((option) => option.name.toLowerCase() === name.trim().toLowerCase())?.color ?? "#64748B";
  const chosenColor = colorOf(status);

  return createPortal(
    <div className="fixed inset-0 z-[2147483646] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close restore dialog backdrop"
        onClick={() => {
          if (!busy) onCancel();
        }}
        className="glass-modal-backdrop absolute inset-0"
      />
      {/* Not overflow-hidden, so the status list can hang over the pop-up's edge. */}
      <div role="dialog" aria-modal="true" className="glass-modal-panel relative w-full max-w-[420px]">
        <div className="glass-modal-header rounded-t-[20px] px-5 py-4">
          <p className="text-[16px] font-medium" style={{ color: "var(--text-main)" }}>
            {title}
          </p>
        </div>
        {statusOptions ? (
          <div className="flex items-center gap-3 px-5 py-4">
            <p className="shrink-0 text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
              Restore as
            </p>
            <div ref={menuRef} className="relative min-w-0 flex-1">
              <button
                type="button"
                aria-label="Status after restoring"
                aria-expanded={isMenuOpen}
                disabled={busy}
                onClick={() => setIsMenuOpen((open) => !open)}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] px-3 text-[13px] font-semibold transition hover:brightness-95 disabled:opacity-55"
                style={{ backgroundColor: chosenColor, color: pillTextColor(chosenColor) }}
              >
                <span className="truncate">{status ? `${status}${subStage ? ` · ${subStage}` : ""}` : "No status"}</span>
                <ChevronDown
                  size={14}
                  className="shrink-0"
                  style={{ transform: isMenuOpen ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }}
                />
              </button>
              {isMenuOpen ? (
                <div
                  className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[260px] overflow-auto rounded-[10px] border p-1 shadow-[var(--shadow-md)]"
                  style={MENU_STYLE}
                >
                  {statusOptions.map((option) => {
                    const textColor = pillTextColor(option.color);
                    const active = status.toLowerCase() === option.name.toLowerCase();
                    const expanded = option.subStages.length > 0 && expandedStatus === option.name;
                    return (
                      <div key={`restore_status_${option.name}`} className="mb-1 last:mb-0">
                        <div className="relative">
                          {/* The status itself — with its default sub-status, like dropping a card into that
                              column on the Dashboard. */}
                          <button
                            type="button"
                            onClick={() => {
                              setStatus(option.name);
                              setSubStage(option.subStages.find((sub) => sub.isDefault)?.name ?? "");
                              setIsMenuOpen(false);
                            }}
                            className={`block w-full rounded-[8px] py-2 text-center text-[12px] font-semibold ${option.subStages.length ? "pl-8 pr-8" : "px-3"}`}
                            style={{ backgroundColor: option.color, color: textColor, filter: active ? "brightness(0.96)" : "brightness(1)" }}
                          >
                            {option.name}
                          </button>
                          {option.subStages.length ? (
                            <button
                              type="button"
                              aria-label={`${option.name} sub-statuses`}
                              aria-expanded={expanded}
                              onClick={() => setExpandedStatus((current) => (current === option.name ? "" : option.name))}
                              className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[6px] transition hover:bg-[rgba(0,0,0,0.12)]"
                              style={{ color: textColor }}
                            >
                              <ChevronDown
                                size={14}
                                style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }}
                              />
                            </button>
                          ) : null}
                        </div>
                        {expanded ? (
                          <div className="mt-1 space-y-1 pl-4">
                            {option.subStages.map((sub) => {
                              const subActive = active && subStage.toLowerCase() === sub.name.toLowerCase();
                              return (
                                <button
                                  key={`restore_sub_${option.name}_${sub.name}`}
                                  type="button"
                                  onClick={() => {
                                    setStatus(option.name);
                                    setSubStage(sub.name);
                                    setIsMenuOpen(false);
                                  }}
                                  className="block w-full rounded-[8px] px-3 py-1.5 text-center text-[11.5px] font-semibold"
                                  style={{
                                    backgroundColor: sub.color,
                                    color: pillTextColor(sub.color),
                                    filter: subActive ? "brightness(0.96)" : "brightness(1)",
                                  }}
                                >
                                  {sub.name}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div
          className={`flex justify-end gap-2 px-5 py-3 ${statusOptions ? "border-t" : ""}`}
          style={{ borderColor: "var(--glass-border)" }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-9 rounded-[10px] border px-4 text-[13px] font-medium transition hover:brightness-95 disabled:opacity-60"
            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(status, subStage)}
            className="h-9 rounded-[10px] border px-4 text-[13px] font-medium text-white transition hover:brightness-95 disabled:opacity-60"
            style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
          >
            {busy ? "Restoring…" : "Restore"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
