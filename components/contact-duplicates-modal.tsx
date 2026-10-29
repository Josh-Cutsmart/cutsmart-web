"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Mail, MapPin, Phone, Users } from "lucide-react";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { EmptyState } from "@/components/empty-state";
import { mergeCompanyClients, type CompanyClientRow } from "@/lib/firestore-data";
import type { DuplicateContactGroup } from "@/lib/contact-duplicates";
import { glassShineStyle } from "@/lib/glass-shine";
import { useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

// Contacts › "possible duplicates" › Review: each group of cards that look like the same person, side by side — which to
// keep (the one with the most projects picked to start with), then Merge (the rest made into it: lib/firestore-data.ts
// mergeCompanyClients) or Not duplicates (not asked about again on this device). Nothing's merged without it.

const REASON_TEXT: Record<DuplicateContactGroup["reason"], string> = {
  email: "Same email",
  phone: "Same phone number",
  name: "Same name and address",
};

export function ContactDuplicatesModal({
  open,
  onClose,
  origin,
  groups,
  companyId,
  onMerged,
  onDismiss,
}: {
  open: boolean;
  onClose: () => void;
  origin: GlassModalOrigin;
  groups: DuplicateContactGroup[];
  companyId: string;
  // A group merged: the card kept (as it is now) and the ids of those made into it.
  onMerged: (kept: CompanyClientRow, mergedIds: string[]) => void;
  onDismiss: (groupKey: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = useGlassModalPopOrigin(open, origin, panelRef);
  // Which card each group keeps (its first — the most projects — until another's picked); the group being merged; a
  // group whose merge failed.
  const [keepByGroup, setKeepByGroup] = useState<Record<string, string>>({});
  const [mergingKey, setMergingKey] = useState("");
  const [failedKey, setFailedKey] = useState("");
  if (!shouldRender || typeof document === "undefined") return null;

  const merge = async (group: DuplicateContactGroup) => {
    const keepId = keepByGroup[group.key] ?? group.contacts[0]?.id;
    let kept = group.contacts.find((row) => row.id === keepId);
    if (!kept || mergingKey) return;
    setMergingKey(group.key);
    setFailedKey("");
    const mergedIds: string[] = [];
    for (const other of group.contacts) {
      if (other.id === kept.id) continue;
      const result = await mergeCompanyClients(companyId, kept, other);
      if (!result.ok || !result.row) {
        setFailedKey(group.key);
        break;
      }
      kept = result.row;
      mergedIds.push(other.id);
    }
    setMergingKey("");
    if (mergedIds.length) onMerged(kept, mergedIds);
  };

  return createPortal(
    <div className="glass-modal-backdrop fixed inset-0 z-[220] flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={panelRef}
        className="glass-modal-panel flex max-h-[min(720px,calc(100svh-32px))] w-full max-w-[760px] flex-col overflow-hidden rounded-[22px]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Possible duplicate contacts"
      >
        <GlassModalHeader title="Possible duplicates" icon={<Users />} onClose={onClose} />
        <div className="glass-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
          <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
            These look like the same person. Pick the card to keep and merge the others into it — their projects, details
            and notes move onto it. Or leave them as they are.
          </p>
          {groups.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[var(--glass-border)]">
              <EmptyState compact icon={<Users size={16} />} title="No possible duplicates left" />
            </div>
          ) : null}
          {groups.map((group) => {
            const keepId = keepByGroup[group.key] ?? group.contacts[0]?.id;
            const keep = group.contacts.find((row) => row.id === keepId);
            const busy = mergingKey === group.key;
            return (
              <section key={group.key} className="glass-shine glass-shine-neutral rounded-[18px] p-3.5">
                <p className="mb-2.5 flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                  <AlertTriangle size={13} style={{ color: "var(--accent-amber)" }} />
                  {REASON_TEXT[group.reason]}
                  {group.shared ? <span className="min-w-0 truncate" style={{ color: "var(--text-muted)" }}>· {group.shared}</span> : null}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.contacts.map((row) => {
                    const picked = row.id === keepId;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        role="radio"
                        aria-checked={picked}
                        disabled={busy}
                        onClick={() => setKeepByGroup((prev) => ({ ...prev, [group.key]: row.id }))}
                        className="flex min-w-0 flex-col gap-1 rounded-[14px] border p-3 text-left transition hover:brightness-[0.98] disabled:opacity-60"
                        style={{
                          borderColor: picked ? "var(--brand)" : "var(--glass-border)",
                          backgroundColor: picked ? "color-mix(in srgb, var(--brand) 8%, var(--panel-bg))" : "var(--panel-bg)",
                          boxShadow: picked ? "0 0 0 1px var(--brand)" : undefined,
                        }}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
                            {row.name || "No name"}
                          </span>
                          {picked ? (
                            <span className="glass-shine inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] font-semibold text-white" style={glassShineStyle("var(--brand)")}>
                              <Check size={11} strokeWidth={3} />
                              Keep
                            </span>
                          ) : null}
                        </span>
                        {[
                          { icon: Mail, value: row.email },
                          { icon: Phone, value: row.phone },
                          { icon: MapPin, value: row.address },
                        ].map(({ icon: Icon, value }, index) =>
                          value ? (
                            <span key={index} className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                              <Icon size={12} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                              <span className="truncate">{value}</span>
                            </span>
                          ) : null,
                        )}
                        <span className="text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                          {row.projectCount} {row.projectCount === 1 ? "project" : "projects"}
                          {row.category ? ` · ${row.category}` : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {failedKey === group.key ? (
                  <p className="mt-2 text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>
                    Couldn&apos;t merge them — check your connection and try again.
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDismiss(group.key)}
                    className="inline-flex h-9 items-center rounded-full border px-4 text-[12.5px] font-medium transition hover:brightness-95 disabled:opacity-60"
                    style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                  >
                    Not duplicates
                  </button>
                  <button
                    type="button"
                    disabled={busy || !keep}
                    onClick={() => void merge(group)}
                    className="glass-shine inline-flex h-9 items-center rounded-full border px-4 text-[12.5px] font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
                    style={glassShineStyle("#16A34A")}
                  >
                    {busy ? "Merging…" : `Merge into ${keep?.name || "this card"}`}
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
