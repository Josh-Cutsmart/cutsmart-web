"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import "ckeditor5/ckeditor5.css";

type QuoteDocumentEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  mode?: "page" | "embedded";
  toolbarPlacement?: "sheet-side" | "inline";
  toolbarHost?: HTMLElement | null;
  embeddedChrome?: "card" | "flat";
  embeddedMinHeight?: number;
  embeddedEditableMinHeight?: number;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onEditorReady?: (editor: any | null) => void;
};

export function QuoteDocumentEditor({
  value,
  onChange,
  readOnly = false,
  mode = "page",
  toolbarPlacement = "sheet-side",
  toolbarHost = null,
  embeddedChrome = "card",
  embeddedMinHeight = 48,
  embeddedEditableMinHeight = 18,
  autoFocus = false,
  onFocus,
  onBlur,
  onEditorReady,
}: QuoteDocumentEditorProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);
  const isApplyingExternalValueRef = useRef(false);
  const lastEditorDataRef = useRef<string>(value || "<div class=\"quote-document-page\"><p></p></div>");
  const isFocusedRef = useRef(false);
  const embeddedToolbarTopRef = useRef<number | null>(null);
  const [embeddedToolbarStyle, setEmbeddedToolbarStyle] = useState<CSSProperties | undefined>(undefined);
  const [isEmbeddedToolbarReady, setIsEmbeddedToolbarReady] = useState(mode !== "embedded");

  useEffect(() => {
    let isDisposed = false;
    const hostNode = hostRef.current;
    const toolbarNode = toolbarRef.current;
    if (!hostNode || !toolbarNode) return;

    (async () => {
      const ckeditor = await import("ckeditor5");
      const {
        Alignment,
        Bold,
        DecoupledEditor,
        Essentials,
        Italic,
        List,
        Paragraph,
        Strikethrough,
        Underline,
        Undo,
      } = ckeditor;

      const editor = await DecoupledEditor.create(value || "<div class=\"quote-document-page\"><p></p></div>", {
        licenseKey: "GPL",
        plugins: [
          Essentials,
          Paragraph,
          Bold,
          Italic,
          Underline,
          Strikethrough,
          List,
          Alignment,
          Undo,
        ],
        toolbar: {
          items: [
            "undo",
            "redo",
            "|",
            "bold",
            "italic",
            "underline",
            "strikethrough",
            "bulletedList",
            "|",
            "alignment",
          ],
          shouldNotGroupWhenFull: true,
        },
      });

      if (isDisposed) {
        await editor.destroy();
        return;
      }

      editorRef.current = editor;
      onEditorReady?.(editor);
      if (editor.ui.view.toolbar.element) {
        toolbarNode.replaceChildren(editor.ui.view.toolbar.element);
      }
      const editableElement = editor.ui.getEditableElement();
      if (!editableElement) {
        throw new Error("CKEditor editable element was not created.");
      }
      editableElement.classList.add("cutsmart-quote-document-editable");
      const handleFocusIn = () => {
        isFocusedRef.current = true;
      };
      const handleFocusOut = () => {
        isFocusedRef.current = false;
      };
      editableElement.addEventListener("focusin", handleFocusIn);
      editableElement.addEventListener("focusout", handleFocusOut);
      hostNode.replaceChildren(editableElement);
      if (readOnly) {
        editor.enableReadOnlyMode("cutsmart-quote-document-readonly");
      }
      if (autoFocus) {
        window.setTimeout(() => {
          try {
            editor.editing.view.focus();
          } catch {}
        }, 0);
      }

      editor.model.document.on("change:data", () => {
        if (isApplyingExternalValueRef.current) return;
        const nextData = editor.getData();
        lastEditorDataRef.current = nextData;
        onChange(nextData);
      });

      editor.editing.view.document.on("focus", () => {
        isFocusedRef.current = true;
      });
      editor.editing.view.document.on("blur", () => {
        isFocusedRef.current = false;
      });
    })().catch((error) => {
      console.error(error);
    });

    return () => {
      isDisposed = true;
      const editor = editorRef.current;
      editorRef.current = null;
      onEditorReady?.(null);
      if (editor) {
        void editor.destroy();
      }
      toolbarNode.replaceChildren();
      hostNode.replaceChildren();
    };
  }, [toolbarHost]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextValue = value || "<div class=\"quote-document-page\"><p></p></div>";
    if (lastEditorDataRef.current === nextValue) return;
    if (isFocusedRef.current) return;
    const current = editor.getData();
    if (current === nextValue) {
      lastEditorDataRef.current = nextValue;
      return;
    }
    isApplyingExternalValueRef.current = true;
    editor.setData(nextValue);
    lastEditorDataRef.current = nextValue;
    queueMicrotask(() => {
      isApplyingExternalValueRef.current = false;
    });
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (readOnly) {
      editor.enableReadOnlyMode("cutsmart-quote-document-readonly");
    } else {
      editor.disableReadOnlyMode("cutsmart-quote-document-readonly");
    }
  }, [readOnly]);

  useEffect(() => {
    if (!autoFocus) return;
    const editor = editorRef.current;
    if (!editor) return;
    window.setTimeout(() => {
      try {
        editor.editing.view.focus();
      } catch {}
    }, 0);
  }, [autoFocus]);

  useEffect(() => {
    if (mode !== "embedded" || typeof window === "undefined") {
      setEmbeddedToolbarStyle(undefined);
      setIsEmbeddedToolbarReady(true);
      embeddedToolbarTopRef.current = null;
      return;
    }

    if (toolbarPlacement !== "sheet-side") {
      setEmbeddedToolbarStyle(undefined);
      setIsEmbeddedToolbarReady(true);
      embeddedToolbarTopRef.current = null;
      return;
    }

    let frameId = 0;
    const updateToolbarPosition = () => {
      const shellNode = shellRef.current;
      const hostNode = hostRef.current;
      const toolbarNode = toolbarRef.current;
      if (!shellNode || !hostNode || !toolbarNode || window.innerWidth < 768) {
        setEmbeddedToolbarStyle(undefined);
        setIsEmbeddedToolbarReady(true);
        return;
      }
      const sheetNode = shellNode.closest("[data-quote-print-sheet='true']") as HTMLElement | null;
      if (!sheetNode) {
        setEmbeddedToolbarStyle(undefined);
        setIsEmbeddedToolbarReady(false);
        return;
      }
      const hostRect = hostNode.getBoundingClientRect();
      const sheetRect = sheetNode.getBoundingClientRect();
      const toolbarRect = toolbarNode.getBoundingClientRect();
      const measuredTop = Math.max(
        12,
        Math.min(hostRect.top, window.innerHeight - toolbarRect.height - 12),
      );
      const top = embeddedToolbarTopRef.current ?? measuredTop;
      embeddedToolbarTopRef.current = top;
      const left = Math.max(12, sheetRect.left - toolbarRect.width - 10);
      setEmbeddedToolbarStyle({
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 40,
      });
      setIsEmbeddedToolbarReady(true);
    };

    const scheduleUpdate = () => {
      setIsEmbeddedToolbarReady(false);
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateToolbarPosition);
    };

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [mode, toolbarPlacement, readOnly, autoFocus]);

  return (
    <div
      ref={shellRef}
      onFocusCapture={() => {
        onFocus?.();
      }}
      onBlurCapture={(e) => {
        const nextTarget = e.relatedTarget as Node | null;
        if (shellRef.current?.contains(nextTarget)) return;
        if (toolbarHost?.contains(nextTarget)) return;
        if (toolbarRef.current?.contains(nextTarget)) return;
        onBlur?.();
      }}
      className={
        mode === "embedded"
          ? embeddedChrome === "flat"
            ? "border-0 bg-transparent shadow-none"
            : "rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
          : "rounded-[18px] border border-[#D7DEE8] bg-[#EEF3FA] shadow-[0_18px_36px_rgba(15,23,42,0.08)]"
      }
    >
      <style>{`
        .cutsmart-quote-document-shell .ck.ck-editor {
          border: none;
          background: transparent;
        }
        .cutsmart-quote-document-shell .ck.ck-toolbar {
          border: none;
          border-bottom: 1px solid #d7dee8;
          border-radius: 18px 18px 0 0;
          background: #ffffff;
          padding: 10px 12px;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"] .ck.ck-toolbar {
          border: 1px solid #d7dee8;
          border-radius: 14px;
          padding: 8px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.98);
          backdrop-filter: blur(10px);
        }
        .cutsmart-quote-document-shell .ck.ck-toolbar .ck-toolbar__items {
          flex-wrap: wrap;
        }
        .cutsmart-quote-document-shell .ck.ck-content.ck-editor__editable,
        .cutsmart-quote-document-shell .cutsmart-quote-document-editable {
          border: none !important;
          box-shadow: none !important;
          outline: none !important;
          background: transparent !important;
        }
        .cutsmart-quote-document-shell[data-mode="page"] .ck.ck-content.ck-editor__editable,
        .cutsmart-quote-document-shell[data-mode="page"] .cutsmart-quote-document-editable {
          min-height: 900px;
          padding: 24px 0 !important;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"] .ck.ck-content.ck-editor__editable,
        .cutsmart-quote-document-shell[data-mode="embedded"] .cutsmart-quote-document-editable {
          min-height: var(--cutsmart-embedded-editable-min-height, 18px);
          padding: 12px 0 !important;
          font-size: 12px;
          line-height: 1.5;
          overflow: hidden !important;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"] .ck.ck-content.ck-editor__editable > *:first-child,
        .cutsmart-quote-document-shell[data-mode="embedded"] .cutsmart-quote-document-editable > *:first-child {
          margin-top: 0 !important;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"] .ck.ck-content.ck-editor__editable > *:last-child,
        .cutsmart-quote-document-shell[data-mode="embedded"] .cutsmart-quote-document-editable > *:last-child {
          margin-bottom: 0 !important;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"] .ck.ck-content.ck-editor__editable p,
        .cutsmart-quote-document-shell[data-mode="embedded"] .cutsmart-quote-document-editable p {
          margin: 0 !important;
        }
        .cutsmart-quote-document-shell .ck.ck-content.ck-editor__editable ul,
        .cutsmart-quote-document-shell .cutsmart-quote-document-editable ul {
          list-style: disc !important;
          margin: 4px 0 !important;
          padding-left: 20px !important;
        }
        .cutsmart-quote-document-shell .ck.ck-content.ck-editor__editable ol,
        .cutsmart-quote-document-shell .cutsmart-quote-document-editable ol {
          list-style: decimal !important;
          margin: 4px 0 !important;
          padding-left: 20px !important;
        }
        .cutsmart-quote-document-shell .ck.ck-content.ck-editor__editable li,
        .cutsmart-quote-document-shell .cutsmart-quote-document-editable li {
          margin: 2px 0 !important;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"] .cutsmart-quote-document-layout {
          position: relative;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"] .cutsmart-quote-document-toolbar {
          position: fixed;
          max-width: 320px;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"] .cutsmart-quote-document-host {
          min-width: 0;
          min-height: var(--cutsmart-embedded-min-height, 48px);
        }
        .cutsmart-quote-document-shell[data-mode="embedded"][data-embedded-chrome="flat"] {
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
          border-radius: 0 !important;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"][data-embedded-chrome="flat"] .ck.ck-editor,
        .cutsmart-quote-document-shell[data-mode="embedded"][data-embedded-chrome="flat"] .ck.ck-editor__main,
        .cutsmart-quote-document-shell[data-mode="embedded"][data-embedded-chrome="flat"] .ck.ck-content.ck-editor__editable,
        .cutsmart-quote-document-shell[data-mode="embedded"][data-embedded-chrome="flat"] .cutsmart-quote-document-editable {
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
          border-radius: 0 !important;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"][data-embedded-chrome="flat"] .cutsmart-quote-document-host {
          min-height: 0;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"][data-toolbar-placement="inline"] .ck.ck-toolbar {
          position: static;
          max-width: none;
          border: 1px solid #d7dee8;
          border-radius: 12px;
          box-shadow: none;
          backdrop-filter: none;
          padding: 6px 8px;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"][data-toolbar-placement="inline"] .cutsmart-quote-document-toolbar {
          position: static;
          max-width: none;
          width: 100%;
        }
        .cutsmart-quote-document-shell .quote-document-page,
        .cutsmart-quote-document-shell .quote-print-sheet {
          width: min(100%, 860px);
          min-height: 1216px;
          margin: 0 auto 24px;
          border: 1px solid #d7dee8;
          border-radius: 18px;
          background: #ffffff;
          box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
          overflow: hidden;
        }
        .cutsmart-quote-document-shell .quote-print-sheet {
          padding: 0 !important;
        }
        .cutsmart-quote-document-shell .quote-document-page:last-child,
        .cutsmart-quote-document-shell .quote-print-sheet:last-child {
          margin-bottom: 0;
        }
        .cutsmart-quote-document-shell .ck-page-break {
          width: min(100%, 860px);
          margin: 24px auto;
        }
        .cutsmart-quote-document-shell[data-mode="embedded"] .quote-document-page,
        .cutsmart-quote-document-shell[data-mode="embedded"] .quote-print-sheet,
        .cutsmart-quote-document-shell[data-mode="embedded"] .ck-page-break {
          width: 100%;
          min-height: 0;
          margin: 0;
          border: none;
          border-radius: 0;
          box-shadow: none;
          background: transparent;
        }
        @media (max-width: 767px) {
          .cutsmart-quote-document-shell[data-mode="embedded"] .cutsmart-quote-document-toolbar {
            width: 100%;
            max-width: none;
            position: static;
          }
        }
      `}</style>
      <div
        className="cutsmart-quote-document-shell"
        data-mode={mode}
        data-toolbar-placement={toolbarPlacement}
        data-embedded-chrome={embeddedChrome}
        style={
          mode === "embedded"
            ? ({
                ["--cutsmart-embedded-min-height" as string]: `${embeddedMinHeight}px`,
                ["--cutsmart-embedded-editable-min-height" as string]: `${embeddedEditableMinHeight}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <div className={mode === "embedded" ? "cutsmart-quote-document-layout" : undefined}>
          {toolbarHost
            ? createPortal(
                <div
                  ref={toolbarRef}
                  className={mode === "embedded" ? "cutsmart-quote-document-toolbar" : undefined}
                  style={
                    mode === "embedded"
                      ? {
                          ...(embeddedToolbarStyle ?? {}),
                          opacity: isEmbeddedToolbarReady ? 1 : 0,
                          pointerEvents: isEmbeddedToolbarReady ? "auto" : "none",
                        }
                      : undefined
                  }
                />,
                toolbarHost,
              )
            : (
                <div
                  ref={toolbarRef}
                  className={mode === "embedded" ? "cutsmart-quote-document-toolbar" : undefined}
                  style={
                    mode === "embedded"
                      ? {
                          ...(embeddedToolbarStyle ?? {}),
                          opacity: isEmbeddedToolbarReady ? 1 : 0,
                          pointerEvents: isEmbeddedToolbarReady ? "auto" : "none",
                        }
                      : undefined
                  }
                />
              )}
          <div
            ref={hostRef}
            className={
              mode === "embedded"
                ? "cutsmart-quote-document-host overflow-visible"
                : "max-h-[calc(100vh-220px)] overflow-auto px-4 py-4 md:px-5"
            }
          />
        </div>
      </div>
    </div>
  );
}
