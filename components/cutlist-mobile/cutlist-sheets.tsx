"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { glassShineStyle } from "@/lib/glass-shine";
import { QuoteDocumentEditor } from "@/components/quote-document-editor";
import { CutlistSheet } from "./cutlist-sheet";

// The Notes sheet: what the cutlist screen's bottom Notes bar had (Cabinetry, Notes, each contractor, Other) as chips
// along its top — a dot on those with notes — and the one picked's own editor under them (`children`, the page's).
export type CutlistNotesTab = { key: string; label: string; icon?: ReactNode; hasNotes?: boolean };

export function CutlistNotesSheet({
  open,
  onClose,
  tabs,
  activeKey,
  onSelect,
  children,
}: {
  open: boolean;
  onClose: () => void;
  tabs: CutlistNotesTab[];
  activeKey: string;
  onSelect: (key: string) => void;
  children: ReactNode;
}) {
  return (
    <CutlistSheet open={open} onClose={onClose} title="Notes" tall flushHeader maxWidth={760} bodyClassName="flex flex-col" bodyStyle={{ overflowY: "hidden" }}>
      {/* (Their room above them inside their scroller — a sideways scroller clips up and down too, which cut off their glass
          shadow — and the sheet's header none under it in its place: flushHeader, so the gap's as it was.) */}
      <div data-horizontal-swipe-scroll="true" className="hide-native-scrollbar flex shrink-0 gap-2 overflow-x-auto px-4 pb-3 pt-2">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSelect(tab.key)}
              aria-pressed={active}
              className={`glass-shine inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium ${active ? "text-white" : "glass-shine-neutral"}`}
              style={active ? glassShineStyle("var(--brand)") : { borderColor: "var(--glass-border)", color: "var(--text-main)" }}
            >
              {tab.icon ? <span className="inline-flex [&>svg]:h-[14px] [&>svg]:w-[14px]">{tab.icon}</span> : null}
              {tab.label}
              {tab.hasNotes ? (
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: active ? "#ffffff" : "var(--brand)" }} title="Has notes" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t" style={{ borderColor: "var(--glass-border)" }}>
        {children}
      </div>
    </CutlistSheet>
  );
}

// Add to cutlist held back: what needs fixing, a line each — tapped, the sheet closes and that part's field is scrolled to
// and focused (the page's onGo).
export type CutlistIssueItem = { key: string; title: string; color: string; textColor: string; message: string };

export function CutlistIssuesSheet({
  open,
  onClose,
  issues,
  onGo,
}: {
  open: boolean;
  onClose: () => void;
  issues: CutlistIssueItem[];
  onGo: (item: CutlistIssueItem) => void;
}) {
  return (
    <CutlistSheet
      open={open}
      onClose={onClose}
      icon={<AlertTriangle style={{ color: "var(--danger)" }} />}
      title={`${issues.length} ${issues.length === 1 ? "thing" : "things"} to fix`}
      subtitle="Nothing with a problem was added — tap one to go to it."
    >
      <div className="space-y-1 px-2 pb-3">
        {issues.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onGo(item)}
            className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left active:bg-[var(--panel-muted)]"
          >
            <span className="h-8 w-[5px] shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
                {item.title}
              </span>
              <span className="block text-[12px] font-medium" style={{ color: "var(--danger)" }}>
                {item.message}
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
          </button>
        ))}
      </div>
    </CutlistSheet>
  );
}

// A note's editor in the Notes sheet — as its drawer has it (the same editor, its toolbar along its top, the notes typed
// in the rest); read-only, just the notes. `onDraft`: what's typed, kept by the page and saved as the note's left.
export function CutlistNotesEditor({
  editorKey,
  initialValue,
  savedHtml,
  readOnly,
  onDraft,
}: {
  editorKey: string;
  initialValue: string;
  savedHtml: string;
  readOnly: boolean;
  onDraft: (value: string) => void;
}) {
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!readOnly ? <div ref={setToolbarHost} className="drawer-toolbar-slim shrink-0 border-b px-3 py-1.5" style={{ borderColor: "var(--glass-border)" }} /> : null}
      <div className="drawer-notes-editor flex min-h-0 flex-1 flex-col" style={{ color: "var(--text-main)" }}>
        {!readOnly ? (
          <QuoteDocumentEditor
            key={editorKey}
            mode="embedded"
            toolbarPlacement="inline"
            toolbarHost={toolbarHost}
            toolbarDensity="compact"
            embeddedChrome="flat"
            embeddedMinHeight={180}
            embeddedEditableMinHeight={120}
            value={initialValue}
            readOnly={readOnly}
            fillHeight
            toolbarGlassStyle
            shellClassName="flex flex-col"
            onChange={onDraft}
          />
        ) : (
          <div className="glass-scroll notes-rich min-h-0 flex-1 overflow-auto px-4 pb-4 pt-3 leading-[20px]" dangerouslySetInnerHTML={{ __html: savedHtml }} />
        )}
      </div>
    </div>
  );
}
