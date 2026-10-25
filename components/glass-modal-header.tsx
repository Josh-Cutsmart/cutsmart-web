import type { ReactNode } from "react";
import { X } from "lucide-react";

// A pop-up's close (X), in its top right corner: plain (no fill or border), the X in the main text colour; pointed at,
// a red circle behind it. On a phone, bigger — the button and the X in it (as every pop-up's X there — app/globals.css).
// (Also from components/settings-ui, as it always was.)
export const modalCloseButtonClass =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-main)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-40 max-md:h-10 max-md:w-10 max-md:[&>svg]:h-[22px] max-md:[&>svg]:w-[22px]";

// Every pop-up's header, as the Schedule pop-up's (components/project-schedule-modal.tsx): 56px along its top, its icon
// (optional, 16px) and title in 14px bold capitals, anything else it needs beside them on the right (a pill, a button, a
// search — `children`), and its X at the end (`onClose`; none without it). On a phone, where every pop-up is the whole
// screen (globals.css), the same along the top of the screen.
export function GlassModalHeader({
  title,
  icon,
  onClose,
  closeLabel = "Close",
  closeDisabled,
  children,
  className = "",
}: {
  title: ReactNode;
  icon?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  closeDisabled?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`glass-modal-header flex h-[56px] shrink-0 items-center justify-between gap-3 px-5 ${className}`}>
      <div className="flex min-w-0 items-center gap-2" style={{ color: "var(--text-main)" }}>
        {icon ? <span className="inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
        <p className="min-w-0 truncate text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
          {title}
        </p>
      </div>
      {children || onClose ? (
        <div className="flex shrink-0 items-center gap-2">
          {children}
          {onClose ? (
            <button type="button" onClick={onClose} disabled={closeDisabled} className={modalCloseButtonClass} aria-label={closeLabel}>
              <X size={16} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
