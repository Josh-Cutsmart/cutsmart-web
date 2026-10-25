"use client";

import { useEffect, useState } from "react";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { createPortal } from "react-dom";
import { CheckCircle2, ClipboardCheck } from "lucide-react";
import { authorizedFetch } from "@/lib/api-fetch";
import SpecsGridClientView from "@/components/specs-grid-client-view";
import ClientSpecsQuestionList from "@/components/client-specs-question-list";
import { getExpandedRowGroups, type SpecsCell, type SpecsGrid } from "@/lib/specs-grid-types";

// Staff accepting the quote / submitting the specifications for the client — the client told them, rather than doing it
// in their portal (the project page's Quote and Specifications windows, their bottom bars' Accept / Submit). Recorded
// as the client's own would be, with who did it for them: "Accepted on behalf of <client> by <staff>"
// (app/api/specs-share/[shareId]/on-behalf, lib/on-behalf.ts). It needn't have been sent to the client first: then the
// page freezes what's on screen as a version first (prepare — undone if it can't be done), and that's the one.

export type OnBehalfResult = { at: string; clientName: string; staffName: string; versionId: string };
// The version the page has frozen for it (not sent: what's on screen), and how to undo that if it can't be done.
export type OnBehalfPrepared = { versionId: string; sentFromLive: boolean; undo?: () => void };

async function actOnBehalf(
  projectId: string,
  kind: "quote" | "specs",
  extra: { companyId: string; versionId?: string; sentFromLive?: boolean },
): Promise<{ ok: true; result: OnBehalfResult } | { ok: false; error: string }> {
  try {
    const response = await authorizedFetch(`/api/specs-share/${encodeURIComponent(projectId)}/on-behalf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...extra }),
    });
    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; at?: string; clientName?: string; staffName?: string; versionId?: string };
    if (!response.ok || !data.ok) return { ok: false, error: String(data.error || `http-${response.status}`) };
    return {
      ok: true,
      result: {
        at: String(data.at || new Date().toISOString()),
        clientName: String(data.clientName || ""),
        staffName: String(data.staffName || ""),
        versionId: String(data.versionId || extra.versionId || ""),
      },
    };
  } catch {
    return { ok: false, error: "network" };
  }
}

const errorText = (error: string, kind: "quote" | "specs") =>
  error === "quote-declined"
    ? "The client declined this quote — reopen it before accepting it."
    : error === "forbidden"
      ? "You're not part of this project's company."
      : error === "no-quote"
        ? "There's no quote to accept yet."
        : error === "no-specifications"
          ? "There are no specifications to submit yet."
          : `Couldn't ${kind === "quote" ? "accept it" : "submit them"} — please try again.`;

function Modal({ wide, onClose, children }: { wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center px-4 py-4" style={{ zIndex: 2147483647 }}>
      <button type="button" aria-label="Close" onClick={onClose} className="glass-modal-backdrop absolute inset-0" />
      <div
        className={`glass-modal-panel glass-panel-pop relative flex max-h-full flex-col overflow-hidden ${wide ? "w-[min(1100px,96vw)]" : "w-[min(440px,96vw)]"}`}
        style={{ zIndex: 2147483647 }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

// The quote: accepted for the client, after a check.
export function AcceptQuoteOnBehalfModal({
  projectId,
  companyId,
  clientName,
  staffName,
  quoteTotal,
  sentToClient,
  prepare,
  onClose,
  onAccepted,
}: {
  projectId: string;
  companyId: string;
  clientName: string;
  staffName: string;
  quoteTotal: string;
  // It's been sent and the client hasn't answered (then that's the one) — else what's on screen, frozen by prepare.
  sentToClient: boolean;
  prepare: () => Promise<OnBehalfPrepared | null>;
  onClose: () => void;
  onAccepted: (result: OnBehalfResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = clientName || "the client";
  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    const prepared = sentToClient ? null : await prepare();
    if (!sentToClient && !prepared) {
      setBusy(false);
      setError(errorText("no-quote", "quote"));
      return;
    }
    const outcome = await actOnBehalf(projectId, "quote", { companyId, versionId: prepared?.versionId, sentFromLive: prepared?.sentFromLive });
    setBusy(false);
    if (outcome.ok) onAccepted(outcome.result);
    else {
      prepared?.undo?.();
      setError(errorText(outcome.error, "quote"));
    }
  };
  return (
    <Modal onClose={() => !busy && onClose()}>
      <GlassModalHeader title={<>{`Accept on behalf of ${client}?`}</>} onClose={onClose} />
      <div className="space-y-3 px-5 py-4">
        <p className="text-[13px] font-medium leading-[1.5]" style={{ color: "var(--text-main)" }}>
          {`${sentToClient ? "The quote sent to them" : "This quote"}${quoteTotal ? ` (${quoteTotal})` : ""} is accepted now, as if ${client} had accepted it in their portal — it's noted as “Accepted on behalf of ${client} by ${staffName || "you"}”.${sentToClient ? "" : " It's saved as a version, and nothing is sent to the client."}`}
        </p>
        <p className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
          An accepted quote is final — it can&apos;t be reopened for editing.
        </p>
        {error ? (
          <p className="rounded-[12px] border px-3 py-2 text-[12px] font-medium" style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}>
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="glass-shine glass-shine-neutral inline-flex h-9 items-center rounded-full px-4 text-[12px] font-medium transition hover:brightness-95 disabled:opacity-60"
            style={{ color: "var(--text-main)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void accept()}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[12px] font-bold text-white transition hover:brightness-95 disabled:opacity-60"
            style={{ backgroundImage: "var(--success-gradient)", borderColor: "var(--success-strong)" }}
          >
            <CheckCircle2 size={14} />
            {busy ? "Accepting…" : "Accept"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// One answer changed on the sheet (null: unanswered).
function withCell(grid: SpecsGrid, rowId: string, colIndex: number, cell: SpecsCell | null): SpecsGrid {
  return { ...grid, rows: grid.rows.map((row) => (row.id === rowId ? { ...row, cells: row.cells.map((existing, index) => (index === colIndex ? cell : existing)) } : row)) };
}

// How many of its Yes/No questions are answered, of how many (rows in a hidden group don't count — as the portal).
function answeredCount(grid: SpecsGrid): { answered: number; total: number } {
  const hidden = new Set<number>();
  for (const group of getExpandedRowGroups(grid)) {
    if (group.hidden) for (let row = group.startRow; row <= group.endRow; row += 1) hidden.add(row);
  }
  let answered = 0;
  let total = 0;
  grid.rows.forEach((row, rowIndex) => {
    if (hidden.has(rowIndex)) return;
    row.cells.forEach((cell) => {
      if (!cell?.confirmable) return;
      total += 1;
      if (typeof cell.confirmedYes === "boolean") answered += 1;
    });
  });
  return { answered, total };
}

// The specifications: the client's own view of the sent sheet, its Yes/No questions answered here (each saved as
// the portal saves the client's), then submitted for them.
export function SubmitSpecsOnBehalfModal({
  projectId,
  companyId,
  clientName,
  staffName,
  localGrid,
  prepare,
  onClose,
  onSubmitted,
}: {
  projectId: string;
  companyId: string;
  clientName: string;
  staffName: string;
  // Not sent to the client: the specifications on screen — answered here, and frozen with the answers on submitting
  // (prepare). Sent: null — the sent version, its answers saved as the portal saves the client's.
  localGrid: SpecsGrid | null;
  prepare: (answered: SpecsGrid) => Promise<OnBehalfPrepared | null>;
  onClose: () => void;
  onSubmitted: (result: OnBehalfResult) => void;
}) {
  const local = Boolean(localGrid);
  const [grid, setGrid] = useState<SpecsGrid | null>(() => (localGrid ? (JSON.parse(JSON.stringify(localGrid)) as SpecsGrid) : null));
  const [loadError, setLoadError] = useState("");
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [answeringKey, setAnsweringKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = clientName || "the client";

  // The sheet as the client sees it (the sent version, with any answers they've given already).
  useEffect(() => {
    if (local) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/specs-share/${encodeURIComponent(projectId)}/grid`, { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as { ok?: boolean; grid?: SpecsGrid; confirmationSubmittedAt?: string | null };
        if (cancelled) return;
        if (!response.ok || !data.ok || !data.grid) {
          setLoadError("Couldn't load the specifications sent to the client.");
          return;
        }
        setGrid(data.grid);
        setAlreadySubmitted(Boolean(data.confirmationSubmittedAt));
      } catch {
        if (!cancelled) setLoadError("Couldn't load the specifications sent to the client.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [local, projectId]);

  // Saved as the portal saves the client's own answer — undone if that fails.
  const onAnswer = async (rowId: string, colIndex: number, value: boolean | null) => {
    if (!grid || alreadySubmitted) return;
    const key = `${rowId}:${colIndex}`;
    setAnsweringKey(key);
    const previous = grid.rows.find((row) => row.id === rowId)?.cells[colIndex] ?? null;
    const next: SpecsCell | null = !previous
      ? previous
      : value === null
        ? (() => {
            const cleared = { ...previous };
            delete cleared.confirmedYes;
            delete cleared.confirmedAt;
            return cleared;
          })()
        : { ...previous, confirmedYes: value, confirmedAt: new Date().toISOString() };
    setGrid((prev) => (prev ? withCell(prev, rowId, colIndex, next) : prev));
    // Not sent: just here, until it's submitted.
    if (local) {
      setAnsweringKey(null);
      return;
    }
    try {
      const response = await fetch(`/api/specs-share/${encodeURIComponent(projectId)}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId, colIndex, value }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean };
      if (!data.ok) setGrid((prev) => (prev ? withCell(prev, rowId, colIndex, previous) : prev));
    } catch {
      setGrid((prev) => (prev ? withCell(prev, rowId, colIndex, previous) : prev));
    } finally {
      setAnsweringKey((prev) => (prev === key ? null : prev));
    }
  };

  const submit = async () => {
    if (busy || !grid) return;
    setBusy(true);
    setError("");
    const prepared = local ? await prepare(grid) : null;
    if (local && !prepared) {
      setBusy(false);
      setError(errorText("no-specifications", "specs"));
      return;
    }
    const outcome = await actOnBehalf(projectId, "specs", { companyId, versionId: prepared?.versionId, sentFromLive: prepared?.sentFromLive });
    setBusy(false);
    if (outcome.ok) onSubmitted(outcome.result);
    else {
      prepared?.undo?.();
      setError(errorText(outcome.error, "specs"));
    }
  };
  const counts = grid ? answeredCount(grid) : { answered: 0, total: 0 };

  return (
    <Modal wide onClose={() => !busy && onClose()}>
      <GlassModalHeader title={`Submit on behalf of ${client}`} icon={<ClipboardCheck size={16} />} onClose={onClose} closeDisabled={busy} />
      {/* (What it's for, under the header — the header just its title, as every pop-up's.) */}
      <p className="shrink-0 border-b px-5 py-3 text-[12px] font-medium" style={{ color: "var(--text-muted)", borderBottomColor: "var(--glass-border)" }}>
        {`Answer Yes or No as ${client} told you — it's the client's own view of the specifications. Submitting notes it as “Submitted on behalf of ${client} by ${staffName || "you"}”.${local ? " It's saved as a version with these answers, and nothing is sent to the client." : ""}`}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" style={{ backgroundColor: "#F1F5F9" }}>
        {loadError ? (
          <p className="py-10 text-center text-[13px] font-medium" style={{ color: "#0F172A" }}>
            {loadError}
          </p>
        ) : !grid ? (
          <p className="py-10 text-center text-[13px] font-medium" style={{ color: "#475569" }}>
            Loading the specifications…
          </p>
        ) : (
          <>
            {alreadySubmitted ? (
              <p className="mb-3 rounded-[10px] border px-4 py-3 text-[13px] font-bold" style={{ borderColor: "#15803D", backgroundColor: "#F0FDF4", color: "#15803D" }}>
                These have already been submitted.
              </p>
            ) : null}
            {counts.total && !alreadySubmitted ? (
              // Narrower, the sheet's scaled down — the same questions with full-size buttons, as the portal.
              <div className="mb-4 lg:hidden">
                <ClientSpecsQuestionList grid={grid} onAnswer={(rowId, colIndex, value) => void onAnswer(rowId, colIndex, value)} answeringKey={answeringKey} />
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <SpecsGridClientView
                grid={grid}
                locked={alreadySubmitted}
                onAnswer={(rowId, colIndex, value) => void onAnswer(rowId, colIndex, value)}
                answeringKey={answeringKey}
                fitToWidth
              />
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--glass-border)" }}>
        {grid && counts.total ? (
          <span className="mr-auto text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
            {`${counts.answered} of ${counts.total} answered`}
          </span>
        ) : null}
        {error ? (
          <span className="mr-auto text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>
            {error}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="glass-shine glass-shine-neutral inline-flex h-9 items-center rounded-full px-4 text-[12px] font-medium transition hover:brightness-95 disabled:opacity-60"
          style={{ color: "var(--text-main)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !grid || alreadySubmitted}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[12px] font-bold text-white transition hover:brightness-95 disabled:opacity-60"
          style={{ backgroundImage: "var(--success-gradient)", borderColor: "var(--success-strong)" }}
        >
          <CheckCircle2 size={14} />
          {busy ? "Submitting…" : `Submit on behalf of ${client}`}
        </button>
      </div>
    </Modal>
  );
}
