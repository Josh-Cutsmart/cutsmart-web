"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { ReactNode } from "react";

type FullscreenImageViewerShellProps = {
  open: boolean;
  zIndex?: number;
  titleLabel: string;
  subjectName: string;
  imageName: string;
  imageIndex: number;
  imageCount: number;
  commentsCollapsed: boolean;
  pinsVisible: boolean;
  onToggleComments: () => void;
  onPinsVisibleChange: (nextChecked: boolean) => void;
  onClose: () => void;
  commentsSection?: ReactNode;
  stageSection: ReactNode;
  thumbnailsCollapsed: boolean;
  onCollapseThumbnails: () => void;
  onExpandThumbnails: () => void;
  thumbnailStrip?: ReactNode;
  showPrevNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  onRootClick?: React.MouseEventHandler<HTMLDivElement>;
};

export function FullscreenImageViewerShell({
  open,
  zIndex = 260,
  titleLabel,
  subjectName,
  imageName,
  imageIndex,
  imageCount,
  commentsCollapsed,
  pinsVisible,
  onToggleComments,
  onPinsVisibleChange,
  onClose,
  commentsSection,
  stageSection,
  thumbnailsCollapsed,
  onCollapseThumbnails,
  onExpandThumbnails,
  thumbnailStrip,
  showPrevNext = false,
  onRootClick,
}: FullscreenImageViewerShellProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ zIndex, backgroundColor: "#ffffff" }}
      onClick={onRootClick}
    >
      <style jsx global>{`
        .cutsmart-image-viewer-comments-strip {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .cutsmart-image-viewer-comments-strip::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div
        className="relative z-[20] border-b"
        style={{ borderColor: "#D7DEE8", backgroundColor: "#ffffff" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid h-[56px] grid-cols-[1fr_auto_1fr] items-center px-6">
          <div className="min-w-0 text-left">
            <div className="flex min-w-0 items-center gap-2">
              <p className="shrink-0 text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "#12345B" }}>
                {titleLabel}
              </p>
              <span className="shrink-0 text-[14px] font-medium" style={{ color: "#6B7280" }}>
                |
              </span>
              <p className="truncate text-[14px] font-medium" style={{ color: "#334155" }}>
                {subjectName}
              </p>
            </div>
          </div>
          <div className="px-4 text-center">
            <p className="text-[14px] font-bold" style={{ color: "#0F172A" }}>
              {imageName}
            </p>
            <p className="mt-[2px] text-[11px] font-semibold" style={{ color: "#64748B" }}>
              {`${imageIndex + 1} / ${imageCount}`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={onToggleComments}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold"
              style={{ borderColor: "#D7DEE8", color: "#334155", backgroundColor: "#ffffff" }}
            >
              <input
                type="checkbox"
                checked={pinsVisible}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onPinsVisibleChange(event.currentTarget.checked)}
                className="h-4 w-4 rounded border"
                style={{ accentColor: "#2F6BFF" }}
                aria-label="Show pins"
              />
              Comments
              <span
                aria-hidden="true"
                className="block shrink-0"
                style={{
                  width: 14,
                  height: 14,
                  backgroundColor: "#64748B",
                  transform: commentsCollapsed ? "rotate(180deg)" : "rotate(90deg)",
                  transition: "transform 140ms ease",
                  WebkitMaskImage: "url('/angle-right.png')",
                  WebkitMaskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  WebkitMaskSize: "contain",
                  maskImage: "url('/angle-right.png')",
                  maskRepeat: "no-repeat",
                  maskPosition: "center",
                  maskSize: "contain",
                }}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border"
              style={{ borderColor: "#D7DEE8", color: "#334155", backgroundColor: "#ffffff" }}
              aria-label="Close image viewer"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        {!commentsCollapsed ? commentsSection : null}
      </div>

      <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden">{stageSection}</div>

      {showPrevNext ? (
        <>
          {!thumbnailsCollapsed ? (
            <div
              className="group/thumb relative z-[20] border-t px-6 py-2"
              style={{ borderColor: "#D7DEE8", backgroundColor: "#ffffff" }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={onCollapseThumbnails}
                className="absolute left-1/2 top-0 z-[6] inline-flex h-9 w-9 -translate-x-1/2 -translate-y-[calc(100%+4px)] items-center justify-center rounded-full border opacity-0 transition-opacity group-hover/thumb:opacity-100"
                style={{
                  borderColor: "#D7DEE8",
                  backgroundColor: "rgba(255,255,255,0.94)",
                  boxShadow: "0 4px 10px rgba(15,23,42,0.10)",
                }}
                aria-label="Hide thumbnails"
              >
                <span
                  aria-hidden="true"
                  className="block"
                  style={{
                    width: 14,
                    height: 14,
                    backgroundColor: "#334155",
                    WebkitMaskImage: "url('/angle-down.png')",
                    WebkitMaskRepeat: "no-repeat",
                    WebkitMaskPosition: "center",
                    WebkitMaskSize: "contain",
                    maskImage: "url('/angle-down.png')",
                    maskRepeat: "no-repeat",
                    maskPosition: "center",
                    maskSize: "contain",
                    transform: "translate(0px, 1px)",
                  }}
                />
              </button>
              <div className="flex justify-center">{thumbnailStrip}</div>
            </div>
          ) : (
            <div
              className="group/thumb-restore absolute bottom-0 left-0 right-0 z-[20] flex h-10 items-end justify-center"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={onExpandThumbnails}
                className="pointer-events-auto mb-1 inline-flex h-9 w-9 items-center justify-center rounded-full border opacity-0 transition-opacity group-hover/thumb-restore:opacity-100"
                style={{
                  borderColor: "#D7DEE8",
                  backgroundColor: "rgba(255,255,255,0.94)",
                  boxShadow: "0 4px 10px rgba(15,23,42,0.10)",
                }}
                aria-label="Show thumbnails"
              >
                <span
                  aria-hidden="true"
                  className="block"
                  style={{
                    width: 14,
                    height: 14,
                    backgroundColor: "#334155",
                    transform: "translate(0px, -1px) rotate(180deg)",
                    WebkitMaskImage: "url('/angle-down.png')",
                    WebkitMaskRepeat: "no-repeat",
                    WebkitMaskPosition: "center",
                    WebkitMaskSize: "contain",
                    maskImage: "url('/angle-down.png')",
                    maskRepeat: "no-repeat",
                    maskPosition: "center",
                    maskSize: "contain",
                  }}
                />
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>,
    document.body,
  );
}
