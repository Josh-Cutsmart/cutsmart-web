"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ClipboardList, X } from "lucide-react";
import SpecsGridClientView from "@/components/specs-grid-client-view";
import { modalCloseButtonClass } from "@/components/settings-ui";
import { authorizedFetch } from "@/lib/api-fetch";
import { fetchGridVersion, fetchGridVersions, fetchSalesGridData } from "@/lib/firestore-data";
import { isPreviewMode } from "@/lib/preview-mode";
import type { SpecsGrid, SpecsGridVersion } from "@/lib/specs-grid-types";
import type { Project } from "@/lib/types";
import { useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { Skeleton, SkeletonGroup } from "@/components/skeleton";
import { EmptyState } from "@/components/empty-state";

// Production › Specifications: the project's Specifications as the pages they read — the client portal's own sheet
// view, read-only, scaled down to fit the pop-up's width (a phone's too), scrolling down it. Which sheet:
//  - the one the client confirmed (submitted from the client portal) — if it's since been reopened for editing (which
//    un-confirms it, app/api/specs-share/[shareId]/reopen) it no longer counts;
//  - otherwise the one sent to the client and waiting on them, else the latest saved version, else the live sheet.
// Which it is shows as a pill in the top bar: Confirmed, or Unconfirmed.
// Looked up afresh each time it opens.

type Shown =
  | { kind: "confirmed" | "sent" | "version"; grid: SpecsGrid; version: SpecsGridVersion }
  | { kind: "live"; grid: SpecsGrid; version: null };
type Phase = "loading" | "ready" | "none" | "error";

const AMBER = "#D97706";

export function ProductionSpecificationsModal({
  open,
  origin,
  originElRef,
  onClose,
  project,
}: {
  open: boolean;
  origin: GlassModalOrigin;
  originElRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  project: Project | null;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = useGlassModalPopOrigin(open, origin, panelRef, undefined, originElRef);
  const [phase, setPhase] = useState<Phase>("loading");
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    if (!open || !project) return;
    let cancelled = false;
    const load = async () => {
      setPhase("loading");
      try {
        // Where it stands with the client: the version sent to them, and whether they've confirmed it. (The Preview
        // has no server to ask: nothing's ever been sent from it.)
        let sentVersionId = "";
        let confirmedAt = "";
        if (!isPreviewMode()) {
          const res = await authorizedFetch(`/api/specs-share/${encodeURIComponent(project.id)}/status`);
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; versionId?: string | null; submittedAt?: string | null };
          if (!data.ok) throw new Error("status");
          sentVersionId = String(data.versionId || "").trim();
          confirmedAt = String(data.submittedAt || "").trim();
        }
        const sent = sentVersionId ? await fetchGridVersion(project, "specificationsVersions", sentVersionId) : null;
        if (cancelled) return;
        // Confirmed — and the version itself still says so (reopening clears that as well as the portal's record).
        if (sent && confirmedAt && sent.submittedAtIso) {
          setShown({ kind: "confirmed", grid: sent.grid, version: sent });
          setPhase("ready");
          return;
        }
        if (sent) {
          setShown({ kind: "sent", grid: sent.grid, version: sent });
          setPhase("ready");
          return;
        }
        const versions = await fetchGridVersions(project, "specificationsVersions");
        if (cancelled) return;
        const latest = versions.length ? versions[versions.length - 1] : null;
        if (latest) {
          setShown({ kind: "version", grid: latest.grid, version: latest });
          setPhase("ready");
          return;
        }
        const live = await fetchSalesGridData(project, "specifications");
        if (cancelled) return;
        if (live?.grid) {
          setShown({ kind: "live", grid: live.grid, version: null });
          setPhase("ready");
          return;
        }
        setShown(null);
        setPhase("none");
      } catch {
        if (!cancelled) setPhase("error");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, project]);

  if (!shouldRender || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1700] flex items-center justify-center px-3 py-3 sm:px-4 sm:py-4">
      <button type="button" aria-label="Close specifications" onClick={onClose} className="glass-modal-backdrop absolute inset-0" />
      <div ref={panelRef} className="glass-modal-panel relative flex h-[min(900px,94svh)] w-[min(1100px,96vw)] flex-col overflow-hidden">
        <div className="glass-modal-header flex h-[56px] shrink-0 items-center justify-between gap-3 px-5">
          <div className="flex min-w-0 items-center gap-2">
            <ClipboardList size={16} className="shrink-0" style={{ color: "var(--text-main)" }} />
            <p className="truncate text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
              Specifications
            </p>
            {/* Where they stand: confirmed by the client, or not (sent and waiting, the latest version, or the live
                sheet) — unmistakably, before anyone works from them. */}
            {phase === "ready" && shown ? (
              shown.kind === "confirmed" ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[3px] text-[12px] font-semibold"
                  style={{
                    borderColor: "color-mix(in srgb, var(--success) 45%, transparent)",
                    backgroundColor: "color-mix(in srgb, var(--success) 12%, var(--panel-bg))",
                    color: "var(--success-strong)",
                  }}
                >
                  <CheckCircle2 size={13} className="shrink-0" />
                  Confirmed
                </span>
              ) : (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[3px] text-[12px] font-semibold"
                  style={{
                    borderColor: `color-mix(in srgb, ${AMBER} 55%, transparent)`,
                    backgroundColor: `color-mix(in srgb, ${AMBER} 12%, var(--panel-bg))`,
                    color: AMBER,
                  }}
                >
                  <AlertTriangle size={13} className="shrink-0" />
                  Unconfirmed
                </span>
              )
            ) : null}
          </div>
          <button type="button" onClick={onClose} className={modalCloseButtonClass} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
          {phase === "loading" ? (
            <SkeletonGroup label="Loading the specifications" className="space-y-2 py-2">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <div key={index} className="grid grid-cols-[1fr_2fr] gap-2">
                  <Skeleton className="h-8 rounded-[8px]" />
                  <Skeleton className="h-8 rounded-[8px]" />
                </div>
              ))}
            </SkeletonGroup>
          ) : phase === "error" ? (
            <p className="py-10 text-center text-[13px] font-medium" style={{ color: "var(--danger-strong)" }}>
              Couldn&apos;t load the specifications — check your connection and try again.
            </p>
          ) : phase === "none" || !shown ? (
            <EmptyState
              compact
              className="py-10"
              icon={<ClipboardList size={16} />}
              title="No specifications yet"
              hint="They show here once they've been started in Design › Specifications."
            />
          ) : (
            // The client portal's sheet, read-only, scaled to fit the pop-up's width (fitToWidth). Confirmed or not:
            // the top bar's pill.
            <SpecsGridClientView grid={shown.grid} locked onAnswer={() => {}} fitToWidth />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
