"use client";

import { useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Download, FileSpreadsheet, X } from "lucide-react";
import { iconRemoveButtonClass } from "@/components/settings-ui";
import { useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { downloadProductionCutlistTemplate } from "@/lib/production-cutlist-download";

// The sidebar's Downloads: the company's blank templates to take away (the Production Cutlist, for now).
export function DownloadsModal({
  open,
  origin,
  originElRef,
  companyId,
  onClose,
}: {
  open: boolean;
  origin: GlassModalOrigin;
  originElRef: RefObject<HTMLElement | null>;
  companyId: string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = useGlassModalPopOrigin(open, origin, panelRef, undefined, originElRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!shouldRender || typeof document === "undefined") return null;

  const downloadProductionCutlist = async () => {
    if (busy || !companyId) return;
    setBusy(true);
    setError("");
    try {
      await downloadProductionCutlistTemplate(companyId);
    } catch {
      setError("Couldn't make the template — try again.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9100] flex items-center justify-center px-4 py-4">
      <button type="button" aria-label="Close downloads" onClick={onClose} className="glass-modal-backdrop absolute inset-0" />
      <div ref={panelRef} className="glass-modal-panel relative flex w-[min(520px,96vw)] max-h-[min(640px,92vh)] flex-col overflow-hidden">
        <div className="glass-modal-header flex h-[56px] shrink-0 items-center justify-between gap-2 px-5">
          <div className="flex items-center gap-2">
            <Download size={16} style={{ color: "var(--text-main)" }} />
            <p className="text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
              Downloads
            </p>
          </div>
          <button type="button" onClick={onClose} className={iconRemoveButtonClass} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="glass-scroll min-h-0 flex-1 space-y-2 overflow-auto px-5 py-4">
          <div className="flex items-start gap-3 rounded-[12px] border px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
            <FileSpreadsheet size={20} className="mt-0.5 shrink-0" style={{ color: "var(--success-strong)" }} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                Production Cutlist
              </p>
              <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-main)" }}>
                Offline usage of the production tab via Excel.
              </p>
              {error ? (
                <p className="mt-1 text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>
                  {error}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy || !companyId}
              onClick={() => void downloadProductionCutlist()}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 self-center rounded-full border px-3.5 text-[12px] font-medium text-white hover:brightness-95 disabled:opacity-60"
              style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
            >
              <Download size={14} />
              {busy ? "Preparing…" : "Download"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
