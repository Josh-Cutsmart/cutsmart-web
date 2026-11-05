"use client";

import { useEffect, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Lock } from "lucide-react";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { activeDateTime } from "@/lib/company-formats";
import { glassShineStyle } from "@/lib/glass-shine";
import type { UserNotificationRow } from "@/lib/firestore-data";

// Someone's asked to unlock a project's Production, and the notification's been opened (the top bar's Notifications, its
// pop-up, or a push tapped on a phone): what they asked, Accept and Decline, or how it was answered.

export function unlockAnswerText(answer: NonNullable<UserNotificationRow["unlockAnswer"]>): string {
  if (answer.decision === "approve") return answer.byName ? `Accepted by ${answer.byName}` : "Accepted";
  if (answer.decision === "deny") return answer.byName ? `Declined by ${answer.byName}` : "Declined";
  return "Already answered";
}

export function UnlockRequestBox({
  row,
  answering,
  error,
  panelRef,
  onAnswer,
  onOpenProject,
  onClose,
}: {
  row: UserNotificationRow;
  answering: "approve" | "deny" | undefined;
  error: string;
  panelRef: RefObject<HTMLDivElement | null>;
  onAnswer: (decision: "approve" | "deny") => void;
  onOpenProject: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  const answer = row.unlockAnswer;
  const canAnswer = !answer && Boolean(row.unlockRequesterUid);
  return createPortal(
    <div className="fixed inset-0 z-[2147483646] flex items-center justify-center px-4">
      <button type="button" aria-label="Close unlock request" onClick={onClose} className="glass-modal-backdrop absolute inset-0" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Production unlock request"
        data-phone-keep-box="true"
        className="glass-modal-panel relative z-[2147483647] w-[min(440px,96vw)] overflow-hidden"
      >
        <GlassModalHeader title="Unlock request" icon={<Lock />} onClose={onClose} />
        <div className="space-y-3 px-5 py-4">
          <p className="text-[14px] font-medium leading-snug max-lg:text-[15px]" style={{ color: "var(--text-main)" }}>
            {row.message}
          </p>
          <p className="text-[12px] font-medium max-lg:text-[13px]" style={{ color: "var(--text-muted)" }}>
            {row.unlockRequestedAtIso ? activeDateTime(row.unlockRequestedAtIso) : activeDateTime(row.createdAtIso)}
          </p>
          {answer ? (
            <p className="text-[13px] font-medium max-lg:text-[14px]" style={{ color: "var(--text-main)" }}>
              {answer.decision === "answered" ? "Someone has already answered this request." : unlockAnswerText(answer)}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-[12px] font-medium max-lg:text-[13px]" style={{ color: "var(--danger-strong)" }}>
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onOpenProject}
              className="h-9 rounded-full px-1 text-[13px] font-medium hover:underline max-lg:h-11 max-lg:text-[14px]"
              style={{ color: "var(--text-muted)" }}
            >
              Open project
            </button>
            {canAnswer ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={Boolean(answering)}
                  onClick={() => onAnswer("deny")}
                  className="h-9 rounded-full border px-4 text-[13px] font-medium hover:brightness-95 disabled:opacity-55 max-lg:h-11 max-lg:px-5 max-lg:text-[14px]"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                >
                  {answering === "deny" ? "Declining..." : "Decline"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(answering)}
                  onClick={() => onAnswer("approve")}
                  className="glass-shine h-9 rounded-full border px-4 text-[13px] font-medium text-white hover:brightness-105 disabled:opacity-55 max-lg:h-11 max-lg:px-5 max-lg:text-[14px]"
                  style={glassShineStyle("var(--brand-strong)")}
                >
                  {answering === "approve" ? "Accepting..." : "Accept"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-full border px-4 text-[13px] font-medium hover:brightness-95 max-lg:h-11 max-lg:px-5 max-lg:text-[14px]"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
