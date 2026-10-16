"use client";

import { useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { glassShineStyle } from "@/lib/glass-shine";

// An empty card's "drag here to add" area (e.g. a project's Images and Files): a dashed drop target with a round
// glass icon — files dropped on it are handed to onFiles, and clicking it opens the card's own file picker
// (onBrowse). Lights up in the brand blue while files are dragged over it. "Tap to add" on a touch screen.
export function UploadDropZone({
  icon,
  title,
  touchTitle,
  hint,
  busyLabel,
  disabled,
  onFiles,
  onBrowse,
  minHeight,
  style,
}: {
  icon: ReactNode;
  // "Drag images here to add them" (and its touch-screen wording, "Tap to add images").
  title: string;
  touchTitle: string;
  // A small line under it, e.g. which files are accepted.
  hint?: string;
  // While an upload's on its way, shown in place of the title ("Uploading… 40%").
  busyLabel?: string;
  disabled?: boolean;
  onFiles: (files: FileList) => void;
  onBrowse: () => void;
  minHeight?: number;
  style?: CSSProperties;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const busy = Boolean(busyLabel);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const onDragOver = (e: DragEvent<HTMLButtonElement>) => {
    if (!hasFiles(e)) return;
    // Always claimed (so a file dropped here never opens in the tab); only shown as a target when it can take it.
    e.preventDefault();
    e.dataTransfer.dropEffect = disabled || busy ? "none" : "copy";
    if (!disabled && !busy && !isDragOver) setIsDragOver(true);
  };
  const onDragLeave = (e: DragEvent<HTMLButtonElement>) => {
    // Only when it's left the area itself, not just moved between the things inside it.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragOver(false);
  };
  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setIsDragOver(false);
    if (disabled || busy || !e.dataTransfer.files.length) return;
    onFiles(e.dataTransfer.files);
  };

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onBrowse}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group/drop flex w-full flex-col items-center justify-center gap-3 rounded-[16px] border-2 border-dashed px-6 py-8 text-center transition-[border-color,background-color] duration-150 disabled:cursor-default ${
        isDragOver
          ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_8%,transparent)]"
          : "border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] bg-transparent enabled:hover:border-[color-mix(in_srgb,var(--brand)_45%,transparent)]"
      }`}
      style={{ minHeight, ...style }}
    >
      <span
        className={`glass-shine inline-flex h-14 w-14 items-center justify-center rounded-full text-white transition-transform duration-150 ${
          isDragOver ? "scale-110" : disabled || busy ? "" : "group-hover/drop:scale-105"
        }`}
        style={glassShineStyle("var(--brand)")}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="flex flex-col items-center gap-1">
        <span className="text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
          {busyLabel || (
            <>
              <span className="pointer-coarse:hidden">{title}</span>
              <span className="hidden pointer-coarse:inline">{touchTitle}</span>
            </>
          )}
        </span>
        {!busy ? (
          <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            <span className="pointer-coarse:hidden">
              or <span className="font-medium" style={{ color: "var(--brand)" }}>click to browse</span>
              {hint ? " · " : ""}
            </span>
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}
