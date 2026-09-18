"use client";

import { createPortal } from "react-dom";
import { Image as ImageIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(0);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const headerElement = headerRef.current;
    if (!headerElement) return;
    const updateHeaderHeight = () => {
      setHeaderHeight(headerElement.getBoundingClientRect().height);
    };
    updateHeaderHeight();
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateHeaderHeight())
        : null;
    resizeObserver?.observe(headerElement);
    return () => resizeObserver?.disconnect();
    // commentsSection is intentionally excluded: it's inline JSX from the caller and gets a new
    // reference every render, which would re-run this effect on every render (including ones
    // triggered by unrelated state, e.g. image pan) instead of only when the header actually opens
    // or its collapsed state changes. The ResizeObserver already reacts to any real size change.
  }, [open, commentsCollapsed]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    if (!showPrevNext || thumbnailsCollapsed) return;
    const footerElement = footerRef.current;
    if (!footerElement) return;
    const updateFooterHeight = () => {
      setFooterHeight(footerElement.getBoundingClientRect().height);
    };
    updateFooterHeight();
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateFooterHeight())
        : null;
    resizeObserver?.observe(footerElement);
    return () => resizeObserver?.disconnect();
    // thumbnailStrip is intentionally excluded: it's inline JSX from the caller and gets a new
    // reference every render, which would re-run this effect on every render (including ones
    // triggered by unrelated state, e.g. image pan) instead of only when the bar actually opens
    // or its collapsed state changes. The ResizeObserver already reacts to any real size change.
  }, [open, showPrevNext, thumbnailsCollapsed]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!open) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ zIndex, backgroundColor: "var(--panel-bg)" }}
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
        ref={headerRef}
        className="glass-page-header absolute inset-x-0 top-0 z-[20]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid h-[56px] grid-cols-[1fr_auto_1fr] items-center px-6">
          <div className="min-w-0 text-left">
            <div className="flex min-w-0 items-center gap-2">
              <ImageIcon size={15} className="shrink-0" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
              <p className="shrink-0 text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                {titleLabel}
              </p>
              <span className="shrink-0 text-[14px] font-medium" style={{ color: "var(--text-muted)" }}>
                |
              </span>
              <p className="truncate text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
                {subjectName}
              </p>
            </div>
          </div>
          <div className="px-4 text-center">
            <p className="text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
              {imageName}
            </p>
            <p className="mt-[2px] text-[11px] font-semibold" style={{ color: "var(--text-main)" }}>
              {`${imageIndex + 1} / ${imageCount}`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={onToggleComments}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"
              style={{ borderColor: "var(--glass-border)", color: "var(--text-main)", backgroundColor: "var(--panel-bg)" }}
            >
              <input
                type="checkbox"
                checked={pinsVisible}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onPinsVisibleChange(event.currentTarget.checked)}
                className="h-4 w-4 rounded border"
                style={{ accentColor: "var(--brand)" }}
                aria-label="Show pins"
              />
              Comments
              <span
                aria-hidden="true"
                className="block shrink-0"
                style={{
                  width: 14,
                  height: 14,
                  backgroundColor: "var(--text-muted)",
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
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border transition hover:brightness-95"
              style={{ borderColor: "var(--glass-border)", color: "var(--text-main)", backgroundColor: "var(--panel-bg)" }}
              aria-label="Close image viewer"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </div>
      {!commentsCollapsed ? (
        <div
          className="absolute inset-x-0 z-[19]"
          style={{ top: headerHeight }}
          onClick={(event) => event.stopPropagation()}
        >
          {commentsSection}
        </div>
      ) : null}

      <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div aria-hidden="true" style={{ height: headerHeight, flexShrink: 0 }} />
        {stageSection}
        <div
          aria-hidden="true"
          style={{ height: showPrevNext && !thumbnailsCollapsed ? footerHeight : 0, flexShrink: 0 }}
        />
      </div>

      {showPrevNext ? (
        <>
          {!thumbnailsCollapsed ? (
            <div
              ref={footerRef}
              className="group/thumb absolute inset-x-0 bottom-0 z-[20] border-t px-6 py-2"
              style={{
                borderColor: "var(--glass-border)",
                background: "var(--glass-modal-bg)",
                backdropFilter: "blur(12px) saturate(220%)",
                WebkitBackdropFilter: "blur(12px) saturate(220%)",
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={onCollapseThumbnails}
                className="absolute left-1/2 top-0 z-[6] inline-flex h-9 w-9 -translate-x-1/2 -translate-y-[calc(100%+4px)] items-center justify-center rounded-full border opacity-0 transition-opacity group-hover/thumb:opacity-100"
                style={{
                  borderColor: "var(--glass-border)",
                  backgroundColor: "var(--glass-bg-strong)",
                  backdropFilter: "blur(12px) saturate(220%)",
                  WebkitBackdropFilter: "blur(12px) saturate(220%)",
                  boxShadow: "var(--shadow-glass)",
                }}
                aria-label="Hide thumbnails"
              >
                <span
                  aria-hidden="true"
                  className="block"
                  style={{
                    width: 14,
                    height: 14,
                    backgroundColor: "var(--text-main)",
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
                  borderColor: "var(--glass-border)",
                  backgroundColor: "var(--glass-bg-strong)",
                  backdropFilter: "blur(12px) saturate(220%)",
                  WebkitBackdropFilter: "blur(12px) saturate(220%)",
                  boxShadow: "var(--shadow-glass)",
                }}
                aria-label="Show thumbnails"
              >
                <span
                  aria-hidden="true"
                  className="block"
                  style={{
                    width: 14,
                    height: 14,
                    backgroundColor: "var(--text-main)",
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
