"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { Great_Vibes } from "next/font/google";
import { ArrowLeft, ChevronDown, ChevronUp, GripVertical, LayoutTemplate, Plus, Save, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyDoc, fetchProjects, saveCompanyDocPatchDetailed } from "@/lib/firestore-data";
import { SYSTEM_QUOTE_FONT_OPTIONS } from "@/lib/quote-font-options";
import { QUOTE_TEMPLATE_PLACEHOLDERS } from "@/lib/quote-template-placeholders";

type QuoteBlockType =
  | "text"
  | "projectText"
  | "logo";

type QuoteTemplateBlock = {
  id: string;
  type: QuoteBlockType;
  label: string;
  enabled: boolean;
  content: string;
  heightMm?: string;
  textColor?: string;
};

type QuoteTemplateBoxStyle = {
  borderColor?: string;
  borderWidthPx?: string;
  fillColor?: string;
  paddingPx?: string;
  paddingTopPx?: string;
  paddingBottomPx?: string;
  paddingLeftPx?: string;
  paddingRightPx?: string;
  marginPx?: string;
};

type QuoteTemplateColumn = {
  id: string;
  span: number;
  style?: QuoteTemplateBoxStyle;
  blocks: QuoteTemplateBlock[];
};

type QuoteTemplateContainer = {
  id: string;
  title: string;
  enabled: boolean;
  mount: "flow" | "top" | "bottom";
  style?: QuoteTemplateBoxStyle;
  columns: QuoteTemplateColumn[];
};

type QuoteLayoutTemplate = {
  version: number;
  templateName: string;
  pageSize: string;
  marginMm: string;
  containers: QuoteTemplateContainer[];
};

type DragItem =
  | { type: "container"; containerId: string }
  | { type: "column"; containerId: string; columnId: string }
  | { type: "block"; containerId: string; columnId: string; blockId: string };

type LayoutEditTarget =
  | { kind: "container"; containerId: string }
  | { kind: "column"; containerId: string; columnId: string };

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const TOTAL_GRID_UNITS = 12;
const greatVibesFont = Great_Vibes({ subsets: ["latin"], weight: "400" });

const blockLibrary: Array<{ type: QuoteBlockType; label: string; description: string }> = [
  { type: "logo", label: "Company Logo", description: "Company logo block" },
  { type: "text", label: "Text", description: "Free text block" },
  { type: "projectText", label: "Project Text", description: "User-entered text filled in from the quote tab" },
];

const containerPresets: Array<{ label: string; spans: number[] }> = [
  { label: "1/1", spans: [12] },
  { label: "1/2 1/2", spans: [6, 6] },
  { label: "1/3 1/3 1/3", spans: [4, 4, 4] },
  { label: "1/4 1/4 1/4 1/4", spans: [3, 3, 3, 3] },
  { label: "1/6 x 6", spans: [2, 2, 2, 2, 2, 2] },
];

const quotePlaceholders = QUOTE_TEMPLATE_PLACEHOLDERS;

const defaultText = "Type your quote text here.";
const quoteFontOptions: Array<{ label: string; value: string }> = [
  { label: "Great Vibes", value: greatVibesFont.style.fontFamily },
  ...SYSTEM_QUOTE_FONT_OPTIONS,
];

const quoteFontSizeOptions = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "60", "72"];

function hasClosest(target: EventTarget | null): target is Element {
  return !!target && typeof (target as Element).closest === "function";
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function toStr(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function paperDimensionsFor(pageSize: string): { widthMm: number; heightMm: number } {
  const key = String(pageSize || "").trim().toUpperCase();
  switch (key) {
    case "A3":
      return { widthMm: 297, heightMm: 420 };
    case "A5":
      return { widthMm: 148, heightMm: 210 };
    case "LETTER":
      return { widthMm: 216, heightMm: 279 };
    case "LEGAL":
      return { widthMm: 216, heightMm: 356 };
    case "A4":
    default:
      return { widthMm: 210, heightMm: 297 };
  }
}

function columnWidthPercent(span: number): number {
  const safeSpan = Math.max(1, Math.min(TOTAL_GRID_UNITS, Number(span) || TOTAL_GRID_UNITS));
  return (safeSpan / TOTAL_GRID_UNITS) * 100;
}

function columnSpanLabel(span: number): string {
  const safeSpan = Math.max(1, Math.min(TOTAL_GRID_UNITS, Number(span) || TOTAL_GRID_UNITS));
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(safeSpan, TOTAL_GRID_UNITS);
  return `${safeSpan / divisor}/${TOTAL_GRID_UNITS / divisor}`;
}

function escapeRichTextHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeAllowedInlineStyle(styleText: string): string {
  const allowed: string[] = [];
  for (const rawPart of String(styleText || "").split(";")) {
    const [rawName, ...rawValueParts] = rawPart.split(":");
    const name = String(rawName || "").trim().toLowerCase();
    const value = rawValueParts.join(":").trim();
    if (!name || !value) continue;
    if (
      name === "color" &&
      (/^#[0-9a-fA-F]{3,8}$/.test(value) ||
        /^[a-zA-Z]+$/.test(value) ||
        /^rgba?\([\d\s.,%]+\)$/i.test(value))
    ) {
      allowed.push(`color:${value}`);
      continue;
    }
    if (name === "font-family" && /^[a-zA-Z0-9\s,'"()-]+$/.test(value)) {
      allowed.push(`font-family:${value}`);
      continue;
    }
    if (name === "font-size" && /^\d+(px|pt|em|rem|%)$/.test(value)) {
      allowed.push(`font-size:${value}`);
      continue;
    }
    if (name === "text-align" && /^(left|center|right|justify)$/i.test(value)) {
      allowed.push(`text-align:${value.toLowerCase()}`);
    }
  }
  return allowed.join("; ");
}

function sanitizeRichTextMarkup(value: string): string {
  if (typeof document === "undefined") {
    return escapeRichTextHtml(value)
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
      .join("");
  }

  const template = document.createElement("template");
  template.innerHTML = String(value || "");

  const renderNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeRichTextHtml(node.textContent || "").replace(/\r?\n/g, "<br />");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const children = Array.from(element.childNodes).map(renderNode).join("");

    if (tag === "br") return "<br />";
    if (tag === "div" || tag === "p") {
      const safeStyle = sanitizeAllowedInlineStyle(element.getAttribute("style") || "");
      return safeStyle
        ? `<p style="${safeStyle}">${children || "<br />"}</p>`
        : `<p>${children || "<br />"}</p>`;
    }
    if (tag === "strong" || tag === "b") return `<strong>${children}</strong>`;
    if (tag === "em" || tag === "i") return `<em>${children}</em>`;
    if (tag === "u") return `<u>${children}</u>`;
    if (tag === "s" || tag === "strike" || tag === "del") return `<s>${children}</s>`;
    if (tag === "span" || tag === "font") {
      const rawStyle =
        tag === "font"
          ? [
              element.getAttribute("color") ? `color:${element.getAttribute("color")}` : "",
              element.getAttribute("face") ? `font-family:${element.getAttribute("face")}` : "",
            ]
              .filter(Boolean)
              .join("; ")
          : (element.getAttribute("style") || "");
      const safeStyle = sanitizeAllowedInlineStyle(rawStyle);
      return safeStyle ? `<span style="${safeStyle}">${children}</span>` : children;
    }
    return children;
  };

  return Array.from(template.content.childNodes)
    .map(renderNode)
    .join("")
    .replace(/(?:<p><br \/><\/p>){3,}/gi, "<p><br /></p><p><br /></p>");
}

function renderRichTextHtml(value: string): string {
  return sanitizeRichTextMarkup(value);
}

function normalizeEditableRichTextHtml(value: string): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/\sstyle=""/gi, "");
}

function normalizeBoxStyle(raw: unknown): QuoteTemplateBoxStyle {
  if (!raw || typeof raw !== "object") return {};
  const row = raw as Record<string, unknown>;
  return {
    borderColor: toStr(row.borderColor),
    borderWidthPx: toStr(row.borderWidthPx),
    fillColor: toStr(row.fillColor),
    paddingPx: toStr(row.paddingPx),
    paddingTopPx: toStr(row.paddingTopPx),
    paddingBottomPx: toStr(row.paddingBottomPx),
    paddingLeftPx: toStr(row.paddingLeftPx),
    paddingRightPx: toStr(row.paddingRightPx),
    marginPx: toStr(row.marginPx),
  };
}

function safePixelString(value: string | undefined): string | undefined {
  const num = Number.parseInt(String(value ?? "").replace(/[^\d-]/g, ""), 10);
  if (!Number.isFinite(num)) return undefined;
  return `${num}px`;
}

function normalizeSignedPixelInput(value: string): string {
  const text = String(value ?? "").replace(/[^\d-]/g, "");
  if (!text) return "";
  if (text === "-") return "-";
  const sign = text.startsWith("-") ? "-" : "";
  const digits = text.replace(/-/g, "");
  return digits ? `${sign}${digits}` : "";
}

function wrapTextareaSelection(
  textarea: HTMLTextAreaElement | null,
  tag: "b" | "i" | "u" | "s",
  onChange: (nextValue: string) => void,
) {
  if (!textarea) return;
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const value = textarea.value || "";
  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  const after = value.slice(end);
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const nextValue = `${before}${openTag}${selected}${closeTag}${after}`;
  onChange(nextValue);
  const nextStart = start + openTag.length;
  const nextEnd = nextStart + selected.length;
  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(nextStart, nextEnd);
  });
}

function wrapTextareaColorSelection(
  textarea: HTMLTextAreaElement | null,
  color: string,
  onChange: (nextValue: string) => void,
) {
  if (!textarea) return;
  const normalizedColor = String(color || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalizedColor) && !/^#[0-9a-fA-F]{3}$/.test(normalizedColor)) return;
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  if (end <= start) return;
  const value = textarea.value || "";
  let before = value.slice(0, start);
  const selected = value.slice(start, end);
  let after = value.slice(end);
  const openTag = `<span style="color:${normalizedColor}">`;
  const closeTag = "</span>";
  const existingColorOpenTagMatch = before.match(/<span style="color:\s*#[0-9a-fA-F]{3,8}">$/i);
  if (existingColorOpenTagMatch && after.startsWith(closeTag)) {
    before = before.slice(0, before.length - existingColorOpenTagMatch[0].length);
    after = after.slice(closeTag.length);
  }
  const nextValue = `${before}${openTag}${selected}${closeTag}${after}`;
  onChange(nextValue);
  const nextStart = start + openTag.length;
  const nextEnd = nextStart + selected.length;
  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(nextStart, nextEnd);
  });
}

function createBlock(type: QuoteBlockType): QuoteTemplateBlock {
  const label = blockLibrary.find((item) => item.type === type)?.label ?? "Block";
  return {
    id: makeId("quote_block"),
    type,
    label,
    enabled: true,
    content: type === "text" ? defaultText : type === "projectText" ? "Type project-specific quote text here." : "",
    heightMm: "",
  };
}

function createColumn(span: number, blocks: QuoteTemplateBlock[] = []): QuoteTemplateColumn {
  return {
    id: makeId("quote_col"),
    span,
    style: {},
    blocks,
  };
}

function createContainer(title: string, spans: number[], blockSets?: QuoteTemplateBlock[][]): QuoteTemplateContainer {
  return {
    id: makeId("quote_container"),
    title,
    enabled: true,
    mount: "flow",
    style: {},
    columns: spans.slice(0, 6).map((span, index) => createColumn(span, blockSets?.[index] ?? [])),
  };
}

function createDefaultTemplate(): QuoteLayoutTemplate {
  return {
    version: 1,
    templateName: "Company Quote Layout",
    pageSize: "A4",
    marginMm: "12",
    containers: [],
  };
}

function normalizeBlock(raw: unknown): QuoteTemplateBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const rawType = toStr(row.type);
  const type: QuoteBlockType = rawType === "logo" ? "logo" : rawType === "projectText" ? "projectText" : "text";
  return {
    id: toStr(row.id, makeId("quote_block")),
    type,
    label: toStr(row.label, type === "logo" ? "Company Logo" : type === "projectText" ? "Project Text" : "Text"),
    enabled: row.enabled !== false,
    content: toStr(row.content, type === "text" ? defaultText : type === "projectText" ? "Type project-specific quote text here." : ""),
    heightMm: toStr(row.heightMm),
    textColor: toStr(row.textColor),
  };
}

function normalizeColumn(raw: unknown): QuoteTemplateColumn | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const span = Number(row.span || 0);
  const blocks = Array.isArray(row.blocks) ? row.blocks.map(normalizeBlock).filter(Boolean) as QuoteTemplateBlock[] : [];
  return {
    id: toStr(row.id, makeId("quote_col")),
    span: Number.isFinite(span) && span > 0 ? span : 12,
    style: normalizeBoxStyle(row.style),
    blocks,
  };
}

function normalizeContainer(raw: unknown): QuoteTemplateContainer | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const columns = Array.isArray(row.columns) ? row.columns.map(normalizeColumn).filter(Boolean) as QuoteTemplateColumn[] : [];
  return {
    id: toStr(row.id, makeId("quote_container")),
    title: toStr(row.title, "Container"),
    enabled: row.enabled !== false,
    mount: toStr(row.mount) === "top" ? "top" : toStr(row.mount) === "bottom" ? "bottom" : "flow",
    style: normalizeBoxStyle(row.style),
    columns: columns.length ? columns.slice(0, 6) : [],
  };
}

function normalizeTemplate(raw: unknown): QuoteLayoutTemplate {
  const fallback = createDefaultTemplate();
  if (!raw || typeof raw !== "object") return fallback;
  const row = raw as Record<string, unknown>;
  let containers = Array.isArray(row.containers) ? row.containers.map(normalizeContainer).filter(Boolean) as QuoteTemplateContainer[] : [];

  if (!containers.length && Array.isArray(row.sections)) {
    containers = (row.sections as Array<Record<string, unknown>>)
      .map((section) => {
        const layout = toStr(section.layout) === "two-column" ? [6, 6] : [12];
        const leftBlocks = Array.isArray(section.leftBlocks) ? section.leftBlocks.map(normalizeBlock).filter(Boolean) as QuoteTemplateBlock[] : [];
        const rightBlocks = Array.isArray(section.rightBlocks) ? section.rightBlocks.map(normalizeBlock).filter(Boolean) as QuoteTemplateBlock[] : [];
          return {
            id: toStr(section.id, makeId("quote_container")),
            title: toStr(section.title, "Container"),
            enabled: section.enabled !== false,
            mount: "flow",
            style: {},
            columns: layout.length === 2 ? [createColumn(6, leftBlocks), createColumn(6, rightBlocks)] : [createColumn(12, leftBlocks)],
          } satisfies QuoteTemplateContainer;
      })
      .slice(0, 40);
  }

  return {
    version: Number(row.version || 1) || 1,
    templateName: toStr(row.templateName, fallback.templateName),
    pageSize: toStr(row.pageSize, "A4"),
    marginMm: toStr(row.marginMm, "12"),
    containers: containers.length ? containers : fallback.containers,
  };
}

function renderPreviewText(type: QuoteBlockType, content: string): string {
  return content || defaultText;
}

function previewBlockTextColor(block: QuoteTemplateBlock): string {
  if (toStr(block.textColor)) return toStr(block.textColor);
  return block.type === "projectText" ? "#667085" : "#0F172A";
}

function previewBlockTextClass(block: QuoteTemplateBlock): string {
  return `text-[12px] leading-[1.45] [&_div]:m-0 [&_p]:m-0 ${
    block.type === "projectText" ? "text-[#667085]" : "text-[#0F172A]"
  }`;
}

function PreviewBlock({
  block,
  companyName,
  companyLogoPath,
}: {
  block: QuoteTemplateBlock;
  companyName: string;
  companyLogoPath: string;
}) {
  if (!block.enabled) return null;
  if (block.type === "logo") {
    return (
      <div className="flex h-[84px] items-center justify-center bg-transparent text-[12px] font-semibold text-[#52637A]">
        {companyLogoPath ? (
          <img
            src={companyLogoPath}
            alt={companyName || "Company logo"}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          "Company Logo"
        )}
      </div>
    );
  }
  if (block.type === "projectText") {
    return (
      <div
        className={previewBlockTextClass(block)}
        style={{ color: previewBlockTextColor(block) }}
        dangerouslySetInnerHTML={{ __html: renderRichTextHtml(block.content || "Type project-specific quote text here.") }}
      />
    );
  }
  return (
    <div
      className={previewBlockTextClass(block)}
      style={{ color: previewBlockTextColor(block) }}
      dangerouslySetInnerHTML={{ __html: renderRichTextHtml(renderPreviewText(block.type, block.content)) }}
    />
  );
}

function ColumnBuilder({
  column,
  onAdd,
  onUpdate,
  onRemove,
  onMove,
}: {
  column: QuoteTemplateColumn;
  onAdd: (type: QuoteBlockType) => void;
  onUpdate: (blockId: string, patch: Partial<QuoteTemplateBlock>) => void;
  onRemove: (blockId: string) => void;
  onMove: (blockId: string, direction: -1 | 1) => void;
}) {
  return (
    <div className="space-y-2 rounded-[12px] border border-[#D7DEE8] bg-[#F8FAFD] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-[#475467]">Column {column.span}/12</p>
        <select
          defaultValue=""
          onChange={(e) => {
            const type = e.target.value as QuoteBlockType;
            if (!type) return;
            onAdd(type);
            e.currentTarget.value = "";
          }}
          className="h-8 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[11px] text-[#334155]"
        >
          <option value="">Add block</option>
          {blockLibrary.map((item) => (
            <option key={item.type} value={item.type}>{item.label}</option>
          ))}
        </select>
      </div>
      {column.blocks.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-[#CBD5E1] bg-white px-3 py-4 text-[12px] text-[#667085]">
          No blocks in this column yet.
        </div>
      ) : null}
      {column.blocks.map((block, index) => (
        <div key={block.id} className="space-y-2 rounded-[10px] border border-[#D8DEE8] bg-white p-3">
          <div className="flex items-center gap-2">
            <input
              value={block.label}
              onChange={(e) => onUpdate(block.id, { label: e.target.value })}
              className="h-8 min-w-0 flex-1 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] text-[#334155]"
            />
            <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#475467]">
              <input
                type="checkbox"
                checked={block.enabled}
                onChange={(e) => onUpdate(block.id, { enabled: e.target.checked })}
              />
              Show
            </label>
            <button type="button" onClick={() => onMove(block.id, -1)} disabled={index === 0} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFD] text-[#475467] disabled:opacity-40">
              <ChevronUp size={15} />
            </button>
            <button type="button" onClick={() => onMove(block.id, 1)} disabled={index === column.blocks.length - 1} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFD] text-[#475467] disabled:opacity-40">
              <ChevronDown size={15} />
            </button>
            <button type="button" onClick={() => onRemove(block.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#F2B8B5] bg-[#FDECEC] text-[#B42318]">
              <Trash2 size={15} />
            </button>
          </div>
          <p className="text-[11px] text-[#667085]">{blockLibrary.find((item) => item.type === block.type)?.description}</p>
          {block.type === "text" ? (
            <textarea
              value={block.content}
              onChange={(e) => onUpdate(block.id, { content: e.target.value })}
              className="min-h-[84px] w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 py-2 text-[12px] text-[#334155]"
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function QuoteLayoutBuilderPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeCompanyId, setActiveCompanyId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyLogoPath, setCompanyLogoPath] = useState("");
  const [companyThemeColor, setCompanyThemeColor] = useState("#12345B");
  const [template, setTemplate] = useState<QuoteLayoutTemplate>(createDefaultTemplate());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState("Company-wide template");
  const [openElementPickerFor, setOpenElementPickerFor] = useState<{
    key: string;
    top: number;
    left: number;
    containerId: string;
    columnId: string;
  } | null>(null);
  const [selectedBlockRef, setSelectedBlockRef] = useState<{ containerId: string; columnId: string; blockId: string } | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [containerDropTargetId, setContainerDropTargetId] = useState<string | null>(null);
  const selectedElementEditorRef = useRef<HTMLDivElement | null>(null);
  const selectedElementColorInputRef = useRef<HTMLInputElement | null>(null);
  const selectedElementSelectionRef = useRef<Range | null>(null);
  const selectedElementLastSyncedBlockRef = useRef<string | null>(null);
  const skipSelectedElementBlurRef = useRef(false);
  const [selectedElementColorDraft, setSelectedElementColorDraft] = useState("#12345B");
  const [selectedElementFontFamilyDraft, setSelectedElementFontFamilyDraft] = useState("Arial");
  const [selectedElementFontSizeDraft, setSelectedElementFontSizeDraft] = useState("12");
  const [layoutEditTarget, setLayoutEditTarget] = useState<LayoutEditTarget | null>(null);
  const [hoveredContainerEditButton, setHoveredContainerEditButton] = useState<{
    id: string;
    top: number;
    left: number;
    bridgeWidth: number;
    height: number;
  } | null>(null);
  const [hoveredColumnEditButton, setHoveredColumnEditButton] = useState<{
    containerId: string;
    columnId: string;
    top: number;
    left: number;
    bridgeWidth: number;
    height: number;
  } | null>(null);
  const hideContainerEditButtonTimerRef = useRef<number | null>(null);
  const hideColumnEditButtonTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const run = async () => {
      if (!user?.uid) {
        setIsLoading(false);
        return;
      }
      const candidateIds = new Set<string>();
      const addCandidate = (value: unknown) => {
        const id = String(value ?? "").trim();
        if (id) candidateIds.add(id);
      };
      if (typeof window !== "undefined") addCandidate(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY));
      addCandidate(user.companyId);
      addCandidate(process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID);
      addCandidate("cmp_mykm_91647c");
      try {
        const projects = await fetchProjects(user.uid);
        for (const project of projects) addCandidate(project.companyId);
      } catch {
        // ignore fallback lookup errors
      }
      let chosenId = "";
      let chosenDoc: Record<string, unknown> | null = null;
      for (const companyId of candidateIds) {
        const doc = await fetchCompanyDoc(companyId);
        if (doc) {
          chosenId = companyId;
          chosenDoc = doc;
          break;
        }
      }
      if (chosenId && typeof window !== "undefined") window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, chosenId);
      setActiveCompanyId(chosenId);
      setCompanyName(toStr(chosenDoc?.name ?? chosenDoc?.companyName, "Company"));
      const chosenDocRecord = (chosenDoc ?? {}) as Record<string, unknown>;
      const themeRecord =
        chosenDocRecord.theme && typeof chosenDocRecord.theme === "object"
          ? chosenDocRecord.theme as Record<string, unknown>
          : null;
      const themeSettingsRecord =
        chosenDocRecord.themeSettings && typeof chosenDocRecord.themeSettings === "object"
          ? chosenDocRecord.themeSettings as Record<string, unknown>
          : null;
      setCompanyThemeColor(
        toStr(
          chosenDocRecord.themeColor ??
            themeRecord?.themeColor ??
            themeSettingsRecord?.themeColor,
          "#12345B",
        ),
      );
      setCompanyLogoPath(
        toStr(
          chosenDocRecord.logoPath ??
            themeRecord?.logoPath ??
            themeSettingsRecord?.logoPath,
        ),
      );
      setTemplate(normalizeTemplate(chosenDoc?.quoteLayoutTemplate));
      setIsLoading(false);
    };
    void run();
  }, [user]);

  const enabledContainers = useMemo(
    () => template.containers.filter((container) => container.enabled),
    [template.containers],
  );
  const topMountedContainers = useMemo(
    () => enabledContainers.filter((container) => container.mount === "top"),
    [enabledContainers],
  );
  const flowContainers = useMemo(
    () => enabledContainers.filter((container) => container.mount === "flow"),
    [enabledContainers],
  );
  const bottomMountedContainers = useMemo(
    () => enabledContainers.filter((container) => container.mount === "bottom"),
    [enabledContainers],
  );
  const previewPaper = useMemo(
    () => paperDimensionsFor(template.pageSize),
    [template.pageSize],
  );
  const selectedBlockMeta = useMemo(() => {
    if (!selectedBlockRef) return null;
    const container = template.containers.find((item) => item.id === selectedBlockRef.containerId);
    if (!container) return null;
    const column = container.columns.find((item) => item.id === selectedBlockRef.columnId);
    if (!column) return null;
    const block = column.blocks.find((item) => item.id === selectedBlockRef.blockId);
    if (!block) return null;
    const blockIndex = column.blocks.findIndex((item) => item.id === selectedBlockRef.blockId);
    return { container, column, block, blockIndex, columnCount: column.blocks.length };
  }, [selectedBlockRef, template.containers]);
  const selectedLayoutMeta = useMemo(() => {
    if (!layoutEditTarget) return null;
    const container = template.containers.find((item) => item.id === layoutEditTarget.containerId);
    if (!container) return null;
    if (layoutEditTarget.kind === "container") {
      return { kind: "container" as const, container, style: container.style ?? {} };
    }
    const column = container.columns.find((item) => item.id === layoutEditTarget.columnId);
    if (!column) return null;
    return { kind: "column" as const, container, column, style: column.style ?? {} };
  }, [layoutEditTarget, template.containers]);
  const captureSelectedElementRange = () => {
    if (typeof window === "undefined") return;
    const editor = selectedElementEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    selectedElementSelectionRef.current = range.cloneRange();
  };
  const restoreSelectedElementRange = () => {
    if (typeof window === "undefined") return;
    const editor = selectedElementEditorRef.current;
    const selection = window.getSelection();
    const range = selectedElementSelectionRef.current;
    if (!editor || !selection || !range) return;
    selection.removeAllRanges();
    selection.addRange(range);
    editor.focus();
  };
  const syncSelectedElementEditorContent = () => {
    const editor = selectedElementEditorRef.current;
    if (!editor || !selectedBlockMeta) return;
    flushSync(() => {
      updateBlockInColumn(
        selectedBlockMeta.container.id,
        selectedBlockMeta.column.id,
        selectedBlockMeta.block.id,
        { content: normalizeEditableRichTextHtml(editor.innerHTML) },
      );
    });
  };
  const commitSelectedElementContent = () => {
    if (!selectedElementEditorRef.current || !selectedBlockMeta) return;
    syncSelectedElementEditorContent();
  };
  const beginSelectedElementFormatInteraction = () => {
    skipSelectedElementBlurRef.current = true;
    captureSelectedElementRange();
  };
  const endSelectedElementFormatInteraction = () => {
    window.setTimeout(() => {
      skipSelectedElementBlurRef.current = false;
    }, 0);
  };
  const applySelectedElementCommand = (command: "bold" | "italic" | "underline" | "strikeThrough") => {
    if (typeof document === "undefined") return;
    restoreSelectedElementRange();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command, false);
    syncSelectedElementEditorContent();
    captureSelectedElementRange();
  };
  const applySelectedElementAlignment = (alignment: "left" | "center" | "right") => {
    if (typeof document === "undefined") return;
    restoreSelectedElementRange();
    document.execCommand("styleWithCSS", false, "true");
    const command =
      alignment === "center"
        ? "justifyCenter"
        : alignment === "right"
          ? "justifyRight"
          : "justifyLeft";
    document.execCommand(command, false);
    syncSelectedElementEditorContent();
    captureSelectedElementRange();
  };
  const applySelectedElementColor = (color: string) => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const normalizedColor = String(color || "").trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(normalizedColor) && !/^#[0-9a-fA-F]{3}$/.test(normalizedColor)) return;
    restoreSelectedElementRange();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("foreColor", false, normalizedColor);
    syncSelectedElementEditorContent();
    captureSelectedElementRange();
  };
  const applySelectedElementInlineStyle = (stylePatch: {
    color?: string;
    fontFamily?: string;
    fontSizePx?: string;
  }) => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const editor = selectedElementEditorRef.current;
    const storedRange = selectedElementSelectionRef.current?.cloneRange() ?? null;
    const selection = window.getSelection();
    if (!editor || !selection || !storedRange || !selectedBlockMeta) return;
    if (storedRange.collapsed || !editor.contains(storedRange.commonAncestorContainer)) return;
    const applyStyleToNode = (node: HTMLElement) => {
      if (stylePatch.color) node.style.color = stylePatch.color;
      if (stylePatch.fontFamily) node.style.fontFamily = stylePatch.fontFamily;
      if (stylePatch.fontSizePx) node.style.fontSize = stylePatch.fontSizePx;
    };
    const cleanNodeStyles = (root: ParentNode) => {
      Array.from(root.querySelectorAll("span, div, p")).forEach((node) => {
        const htmlNode = node as HTMLElement;
        if (stylePatch.color) {
          htmlNode.style.removeProperty("color");
        }
        if (stylePatch.fontFamily) {
          htmlNode.style.removeProperty("font-family");
        }
        if (stylePatch.fontSizePx) {
          htmlNode.style.removeProperty("font-size");
        }
        const remainingStyle = sanitizeAllowedInlineStyle(htmlNode.getAttribute("style") || "");
        if (remainingStyle) {
          htmlNode.setAttribute("style", remainingStyle);
        } else {
          htmlNode.removeAttribute("style");
        }
        if (!htmlNode.getAttribute("style") && htmlNode.tagName.toLowerCase() === "span") {
          const parent = htmlNode.parentNode;
          while (htmlNode.firstChild) {
            parent?.insertBefore(htmlNode.firstChild, htmlNode);
          }
          parent?.removeChild(htmlNode);
        }
      });
    };
    selection.removeAllRanges();
    selection.addRange(storedRange);
    editor.focus();
    const selectedText = selection.toString().replace(/\s+/g, " ").trim();
    const editorText = (editor.textContent || "").replace(/\s+/g, " ").trim();
    if (selectedText && editorText && selectedText === editorText) {
      cleanNodeStyles(editor);
      const blockNodes = Array.from(editor.children).filter((node) =>
        ["div", "p"].includes((node as HTMLElement).tagName.toLowerCase()),
      ) as HTMLElement[];
      if (blockNodes.length) {
        blockNodes.forEach((node) => applyStyleToNode(node));
      } else {
        const wrapper = document.createElement("span");
        applyStyleToNode(wrapper);
        while (editor.firstChild) {
          wrapper.appendChild(editor.firstChild);
        }
        editor.appendChild(wrapper);
      }
      const nextRange = document.createRange();
      nextRange.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      selectedElementSelectionRef.current = nextRange.cloneRange();
      const nextContent = normalizeEditableRichTextHtml(editor.innerHTML);
      flushSync(() => {
        updateBlockInColumn(
          selectedBlockMeta.container.id,
          selectedBlockMeta.column.id,
          selectedBlockMeta.block.id,
          { content: nextContent },
        );
      });
      selectedElementLastSyncedBlockRef.current = selectedBlockMeta.block.id;
      captureSelectedElementRange();
      return;
    }
    const range = selection.getRangeAt(0);
    const selectedFragment = range.extractContents();
    if (stylePatch.fontFamily || stylePatch.fontSizePx || stylePatch.color) {
      cleanNodeStyles(selectedFragment);
    }
    const topLevelNodes = Array.from(selectedFragment.childNodes);
    const hasBlockLevelNodes = topLevelNodes.some(
      (node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        ["div", "p"].includes((node as HTMLElement).tagName.toLowerCase()),
    );
    if (hasBlockLevelNodes) {
      const styledFragment = document.createDocumentFragment();
      let inlineWrapper: HTMLSpanElement | null = null;
      const flushInlineWrapper = () => {
        if (!inlineWrapper) return;
        styledFragment.appendChild(inlineWrapper);
        inlineWrapper = null;
      };
      topLevelNodes.forEach((node) => {
        if (
          node.nodeType === Node.ELEMENT_NODE &&
          ["div", "p"].includes((node as HTMLElement).tagName.toLowerCase())
        ) {
          flushInlineWrapper();
          applyStyleToNode(node as HTMLElement);
          styledFragment.appendChild(node);
          return;
        }
        if (!inlineWrapper) {
          inlineWrapper = document.createElement("span");
          applyStyleToNode(inlineWrapper);
        }
        inlineWrapper.appendChild(node);
      });
      flushInlineWrapper();
      range.insertNode(styledFragment);
    } else {
      const span = document.createElement("span");
      applyStyleToNode(span);
      span.appendChild(selectedFragment);
      range.insertNode(span);
    }
    const nextRange = document.createRange();
    nextRange.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    selectedElementSelectionRef.current = nextRange.cloneRange();
    const nextContent = normalizeEditableRichTextHtml(editor.innerHTML);
    flushSync(() => {
      updateBlockInColumn(
        selectedBlockMeta.container.id,
        selectedBlockMeta.column.id,
        selectedBlockMeta.block.id,
        { content: nextContent },
      );
    });
    selectedElementLastSyncedBlockRef.current = selectedBlockMeta.block.id;
    captureSelectedElementRange();
  };
  useEffect(() => {
    setSelectedElementColorDraft(selectedBlockMeta?.block.textColor || companyThemeColor || "#12345B");
    setSelectedElementFontFamilyDraft("Arial");
    setSelectedElementFontSizeDraft("12");
  }, [selectedBlockMeta?.block.id, selectedBlockMeta?.block.textColor, companyThemeColor]);
  useEffect(() => {
    const editor = selectedElementEditorRef.current;
    const blockId = selectedBlockMeta?.block.id ?? null;
    const content = selectedBlockMeta?.block.content ?? "";
    if (!editor || !blockId) {
      selectedElementLastSyncedBlockRef.current = null;
      return;
    }
    const nextHtml = renderRichTextHtml(content);
    const blockChanged = selectedElementLastSyncedBlockRef.current !== blockId;
    const editorFocused = typeof document !== "undefined" && document.activeElement === editor;
    if (skipSelectedElementBlurRef.current && !blockChanged) {
      return;
    }
    if (blockChanged || !editorFocused) {
      if (editor.innerHTML !== nextHtml) {
        editor.innerHTML = nextHtml;
      }
      selectedElementLastSyncedBlockRef.current = blockId;
    }
  }, [selectedBlockMeta?.block.id, selectedBlockMeta?.block.content]);

  useEffect(() => {
    if (!selectedBlockMeta?.block.id) return;
    const handlePointerDownCapture = (event: PointerEvent) => {
      const editor = selectedElementEditorRef.current;
      const target = event.target as Node | null;
      if (!editor || !target) return;
      if (editor.contains(target)) return;
      flushSync(() => {
        syncSelectedElementEditorContent();
      });
    };
    window.addEventListener("pointerdown", handlePointerDownCapture, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDownCapture, true);
    };
  }, [selectedBlockMeta?.block.id]);

  useEffect(() => {
    if (!openElementPickerFor) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-quote-element-picker]")) return;
      if (target?.closest("[data-quote-element-button]")) return;
      setOpenElementPickerFor(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenElementPickerFor(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [openElementPickerFor]);

  const updateContainer = (containerId: string, patch: Partial<QuoteTemplateContainer>) => {
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.map((container) => (container.id === containerId ? { ...container, ...patch } : container)),
    }));
  };

  const updateContainerStyle = (containerId: string, patch: Partial<QuoteTemplateBoxStyle>) => {
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.map((container) =>
        container.id === containerId
          ? { ...container, style: { ...(container.style ?? {}), ...patch } }
          : container,
      ),
    }));
  };

  const updateColumnStyle = (containerId: string, columnId: string, patch: Partial<QuoteTemplateBoxStyle>) => {
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.map((container) => {
        if (container.id !== containerId) return container;
        return {
          ...container,
          columns: container.columns.map((column) =>
            column.id === columnId
              ? { ...column, style: { ...(column.style ?? {}), ...patch } }
              : column,
          ),
        };
      }),
    }));
  };

  const updateContainerColumns = (containerId: string, columns: QuoteTemplateColumn[]) => {
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.map((container) => (container.id === containerId ? { ...container, columns } : container)),
    }));
  };

  const addContainer = () => {
    setTemplate((prev) => ({
      ...prev,
      containers: [...prev.containers, createContainer("Container", [])],
    }));
  };

  const moveContainer = (containerId: string, direction: -1 | 1) => {
    setTemplate((prev) => {
      const containers = [...prev.containers];
      const index = containers.findIndex((container) => container.id === containerId);
      if (index < 0) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= containers.length) return prev;
      const [picked] = containers.splice(index, 1);
      containers.splice(nextIndex, 0, picked);
      return { ...prev, containers };
    });
  };

  const removeContainer = (containerId: string) => {
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.filter((container) => container.id !== containerId),
    }));
  };

  const applyContainerPreset = (containerId: string, spans: number[]) => {
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.map((container) => {
        if (container.id !== containerId) return container;
        const remainingSlots = Math.max(0, 6 - container.columns.length);
        const spansToAdd = spans.slice(0, remainingSlots);
        const nextColumns = [...container.columns, ...spansToAdd.map((span) => createColumn(span))];
        return { ...container, columns: nextColumns };
      }),
    }));
  };

  const updateColumnBlocks = (containerId: string, columnId: string, nextBlocks: QuoteTemplateBlock[]) => {
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.map((container) => {
        if (container.id !== containerId) return container;
        return {
          ...container,
          columns: container.columns.map((column) => (column.id === columnId ? { ...column, blocks: nextBlocks } : column)),
        };
      }),
    }));
  };

  const removeColumnFromContainer = (containerId: string, columnId: string) => {
    setSelectedBlockRef((prev) => (prev && prev.containerId === containerId && prev.columnId === columnId ? null : prev));
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.map((container) => {
        if (container.id !== containerId) return container;
        return {
          ...container,
          columns: container.columns.filter((column) => column.id !== columnId),
        };
      }),
    }));
  };

  const addBlockToColumn = (containerId: string, columnId: string, type: QuoteBlockType) => {
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.map((container) => {
        if (container.id !== containerId) return container;
        return {
          ...container,
          columns: container.columns.map((column) => (
            column.id === columnId ? { ...column, blocks: [...column.blocks, createBlock(type)] } : column
          )),
        };
      }),
    }));
  };

  const updateBlockInColumn = (containerId: string, columnId: string, blockId: string, patch: Partial<QuoteTemplateBlock>) => {
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.map((container) => {
        if (container.id !== containerId) return container;
        return {
          ...container,
          columns: container.columns.map((column) => (
            column.id === columnId
              ? { ...column, blocks: column.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)) }
              : column
          )),
        };
      }),
    }));
  };

  const removeBlockFromColumn = (containerId: string, columnId: string, blockId: string) => {
    setSelectedBlockRef((prev) => (prev && prev.blockId === blockId ? null : prev));
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.map((container) => {
        if (container.id !== containerId) return container;
        return {
          ...container,
          columns: container.columns.map((column) => (
            column.id === columnId ? { ...column, blocks: column.blocks.filter((block) => block.id !== blockId) } : column
          )),
        };
      }),
    }));
  };

  const moveBlockInColumn = (containerId: string, columnId: string, blockId: string, direction: -1 | 1) => {
    setTemplate((prev) => ({
      ...prev,
      containers: prev.containers.map((container) => {
        if (container.id !== containerId) return container;
        return {
          ...container,
          columns: container.columns.map((column) => {
            if (column.id !== columnId) return column;
            const blocks = [...column.blocks];
            const index = blocks.findIndex((block) => block.id === blockId);
            if (index < 0) return column;
            const nextIndex = index + direction;
            if (nextIndex < 0 || nextIndex >= blocks.length) return column;
            const [picked] = blocks.splice(index, 1);
            blocks.splice(nextIndex, 0, picked);
            return { ...column, blocks };
          }),
        };
      }),
    }));
  };

  const moveContainerBefore = (sourceContainerId: string, targetContainerId: string) => {
    if (sourceContainerId === targetContainerId) return;
    setTemplate((prev) => {
      const containers = [...prev.containers];
      const sourceIndex = containers.findIndex((container) => container.id === sourceContainerId);
      const targetIndex = containers.findIndex((container) => container.id === targetContainerId);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const [picked] = containers.splice(sourceIndex, 1);
      const insertIndex = containers.findIndex((container) => container.id === targetContainerId);
      containers.splice(insertIndex < 0 ? containers.length : insertIndex, 0, picked);
      return { ...prev, containers };
    });
  };

  const moveColumnBefore = (
    sourceContainerId: string,
    sourceColumnId: string,
    targetContainerId: string,
    targetColumnId: string,
  ) => {
    if (sourceContainerId === targetContainerId && sourceColumnId === targetColumnId) return;
    setTemplate((prev) => {
      const containers = prev.containers.map((container) => ({
        ...container,
        columns: [...container.columns],
      }));
      const sourceContainer = containers.find((container) => container.id === sourceContainerId);
      const targetContainer = containers.find((container) => container.id === targetContainerId);
      if (!sourceContainer || !targetContainer) return prev;
      const sourceIndex = sourceContainer.columns.findIndex((column) => column.id === sourceColumnId);
      const targetIndex = targetContainer.columns.findIndex((column) => column.id === targetColumnId);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const [picked] = sourceContainer.columns.splice(sourceIndex, 1);
      const insertIndex = targetContainer.columns.findIndex((column) => column.id === targetColumnId);
      targetContainer.columns.splice(insertIndex < 0 ? targetContainer.columns.length : insertIndex, 0, picked);
      return { ...prev, containers };
    });
    setSelectedBlockRef((prev) =>
      prev && prev.containerId === sourceContainerId && prev.columnId === sourceColumnId
        ? { ...prev, containerId: targetContainerId, columnId: sourceColumnId }
        : prev,
    );
  };

  const moveBlockToColumn = (
    sourceContainerId: string,
    sourceColumnId: string,
    blockId: string,
    targetContainerId: string,
    targetColumnId: string,
    targetBlockId?: string,
  ) => {
    setTemplate((prev) => {
      const containers = prev.containers.map((container) => ({
        ...container,
        columns: container.columns.map((column) => ({
          ...column,
          blocks: [...column.blocks],
        })),
      }));
      const sourceContainer = containers.find((container) => container.id === sourceContainerId);
      const targetContainer = containers.find((container) => container.id === targetContainerId);
      const sourceColumn = sourceContainer?.columns.find((column) => column.id === sourceColumnId);
      const targetColumn = targetContainer?.columns.find((column) => column.id === targetColumnId);
      if (!sourceColumn || !targetColumn) return prev;
      const sourceIndex = sourceColumn.blocks.findIndex((block) => block.id === blockId);
      if (sourceIndex < 0) return prev;
      const [picked] = sourceColumn.blocks.splice(sourceIndex, 1);
      let insertIndex = targetColumn.blocks.length;
      if (targetBlockId) {
        const foundTargetIndex = targetColumn.blocks.findIndex((block) => block.id === targetBlockId);
        if (foundTargetIndex >= 0) insertIndex = foundTargetIndex;
      }
      if (sourceColumnId === targetColumnId && sourceContainerId === targetContainerId && sourceIndex < insertIndex) {
        insertIndex -= 1;
      }
      targetColumn.blocks.splice(Math.max(0, insertIndex), 0, picked);
      return { ...prev, containers };
    });
    setSelectedBlockRef((prev) =>
      prev && prev.blockId === blockId
        ? { containerId: targetContainerId, columnId: targetColumnId, blockId }
        : prev,
    );
  };

  const handleDragStart = (item: DragItem) => (event: React.DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify(item));
    setDragItem(item);
  };

  const handleDragEnd = () => {
    setDragItem(null);
    setContainerDropTargetId(null);
  };

  const saveTemplate = async () => {
    if (!activeCompanyId || isSaving) return;
    commitSelectedElementContent();
    setIsSaving(true);
    setSaveLabel("Saving...");
    const payload: QuoteLayoutTemplate = {
      ...template,
      version: Math.max(1, Number(template.version || 1)),
      templateName: toStr(template.templateName, "Company Quote Layout"),
      pageSize: toStr(template.pageSize, "A4"),
      marginMm: toStr(template.marginMm, "12"),
      containers: template.containers.slice(0, 40).map((container) => ({
        ...container,
        columns: container.columns.slice(0, 6),
      })),
    };
    const result = await saveCompanyDocPatchDetailed(activeCompanyId, {
      quoteLayoutTemplate: payload,
      quoteLayoutTemplateVersion: Date.now(),
      quoteTemplatePageSize: payload.pageSize,
      quoteTemplateMarginMm: Number(payload.marginMm || 12),
    });
    setIsSaving(false);
    setSaveLabel(result.ok ? "Saved" : `Save failed${result.error ? ` (${result.error})` : ""}`);
  };

  const openElementPickerAtButton = (
    event: React.MouseEvent<HTMLButtonElement>,
    containerId: string,
    columnId: string,
  ) => {
    const key = `${containerId}:${columnId}`;
    if (openElementPickerFor?.key === key) {
      setOpenElementPickerFor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 180;
    const left = Math.max(16, rect.right + window.scrollX - menuWidth);
    const top = rect.bottom + window.scrollY + 6;
    setOpenElementPickerFor({ key, top, left, containerId, columnId });
  };

  const clearContainerEditButtonHideTimer = () => {
    if (hideContainerEditButtonTimerRef.current != null) {
      window.clearTimeout(hideContainerEditButtonTimerRef.current);
      hideContainerEditButtonTimerRef.current = null;
    }
  };

  const showContainerEditButton = (containerId: string, element: HTMLDivElement) => {
    clearContainerEditButtonHideTimer();
    const rect = element.getBoundingClientRect();
    const buttonLeft = Math.max(16, rect.left - 148);
    setHoveredContainerEditButton({
      id: containerId,
      top: rect.top + 8,
      left: buttonLeft,
      bridgeWidth: Math.max(132, rect.left - buttonLeft),
      height: Math.max(34, Math.min(44, rect.height)),
    });
  };

  const scheduleHideContainerEditButton = () => {
    clearContainerEditButtonHideTimer();
    hideContainerEditButtonTimerRef.current = window.setTimeout(() => {
      setHoveredContainerEditButton(null);
      hideContainerEditButtonTimerRef.current = null;
    }, 140);
  };

  const clearColumnEditButtonHideTimer = () => {
    if (hideColumnEditButtonTimerRef.current != null) {
      window.clearTimeout(hideColumnEditButtonTimerRef.current);
      hideColumnEditButtonTimerRef.current = null;
    }
  };

  const showColumnEditButton = (containerId: string, columnId: string, element: HTMLDivElement) => {
    clearColumnEditButtonHideTimer();
    const rect = element.getBoundingClientRect();
    const buttonLeft = Math.max(16, rect.left - 148);
    setHoveredColumnEditButton({
      containerId,
      columnId,
      top: rect.top + 44,
      left: buttonLeft,
      bridgeWidth: Math.max(132, rect.left - buttonLeft),
      height: Math.max(34, Math.min(44, rect.height)),
    });
  };

  const scheduleHideColumnEditButton = () => {
    clearColumnEditButtonHideTimer();
    hideColumnEditButtonTimerRef.current = window.setTimeout(() => {
      setHoveredColumnEditButton(null);
      hideColumnEditButtonTimerRef.current = null;
    }, 260);
  };

  const layoutBoxStyle = (style: QuoteTemplateBoxStyle | undefined, fallbackBorderColor?: string) => ({
    borderColor: toStr(style?.borderColor) || fallbackBorderColor || undefined,
    borderWidth: safePixelString(style?.borderWidthPx),
    borderStyle: toStr(style?.borderColor) || fallbackBorderColor || toStr(style?.borderWidthPx) ? "solid" : undefined,
    backgroundColor: toStr(style?.fillColor) || undefined,
    paddingTop: safePixelString(style?.paddingTopPx || style?.paddingPx),
    paddingBottom: safePixelString(style?.paddingBottomPx || style?.paddingPx),
    paddingLeft: safePixelString(style?.paddingLeftPx || style?.paddingPx),
    paddingRight: safePixelString(style?.paddingRightPx || style?.paddingPx),
    margin: safePixelString(style?.marginPx),
  });

  const elementPickerPortal =
    typeof document !== "undefined" && openElementPickerFor
      ? createPortal(
          <div
            data-quote-element-picker
            className="fixed z-[9999] min-w-[180px] rounded-[10px] border border-[#D8DEE8] bg-white p-2 shadow-[0_14px_30px_rgba(15,23,42,0.16)]"
            style={{
              top: openElementPickerFor.top - window.scrollY,
              left: openElementPickerFor.left - window.scrollX,
            }}
          >
            <div className="space-y-1">
              {blockLibrary.map((item) => (
                <button
                  key={`${openElementPickerFor.key}_${item.type}`}
                  type="button"
                  onClick={() => {
                    addBlockToColumn(openElementPickerFor.containerId, openElementPickerFor.columnId, item.type);
                    setOpenElementPickerFor(null);
                  }}
                  className="w-full rounded-[8px] px-2 py-2 text-left text-[11px] font-semibold text-[#344054] hover:bg-[#F8FAFD]"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null;

  const containerEditButtonPortal =
    typeof document !== "undefined" && hoveredContainerEditButton
      ? createPortal(
          <div
            className="fixed z-[9998]"
            style={{
              top: hoveredContainerEditButton.top - 3,
              left: hoveredContainerEditButton.left,
              width: hoveredContainerEditButton.bridgeWidth,
              height: hoveredContainerEditButton.height,
            }}
            onMouseEnter={clearContainerEditButtonHideTimer}
            onMouseLeave={scheduleHideContainerEditButton}
          >
            <div className="absolute inset-0 bg-transparent" />
            <button
              type="button"
              draggable
              onDragStart={handleDragStart({ type: "container", containerId: hoveredContainerEditButton.id })}
              onDragEnd={handleDragEnd}
              onClick={() => {
                clearContainerEditButtonHideTimer();
                commitSelectedElementContent();
                setLayoutEditTarget({ kind: "container", containerId: hoveredContainerEditButton.id });
              }}
              className="absolute left-0 top-[3px] inline-flex h-8 items-center gap-2 rounded-[10px] border border-[#2F4E68] bg-[#7E9EBB] px-3 text-[11px] font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.16)]"
            >
              <img
                src="/Edit.png"
                alt="Edit"
                className="block object-contain"
                style={{ width: 11, height: 11, filter: "brightness(0) invert(1)" }}
              />
              Edit Container
            </button>
          </div>,
          document.body,
        )
      : null;

  const columnEditButtonPortal =
    typeof document !== "undefined" && hoveredColumnEditButton
      ? createPortal(
          <div
            data-quote-column-edit-portal
            className="fixed z-[9997]"
            style={{
              top: hoveredColumnEditButton.top - 3,
              left: hoveredColumnEditButton.left,
              width: hoveredColumnEditButton.bridgeWidth,
              height: hoveredColumnEditButton.height,
            }}
            onMouseEnter={clearColumnEditButtonHideTimer}
            onMouseLeave={scheduleHideColumnEditButton}
          >
            <div className="absolute inset-0 bg-transparent" />
            <button
              type="button"
              onClick={() => {
                clearColumnEditButtonHideTimer();
                commitSelectedElementContent();
                setLayoutEditTarget({
                  kind: "column",
                  containerId: hoveredColumnEditButton.containerId,
                  columnId: hoveredColumnEditButton.columnId,
                });
              }}
              className="absolute left-0 top-[3px] inline-flex h-8 items-center gap-2 rounded-[10px] border border-[#2F4E68] bg-[#7E9EBB] px-3 text-[11px] font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.16)]"
            >
              <img
                src="/Edit.png"
                alt="Edit"
                className="block object-contain"
                style={{ width: 11, height: 11, filter: "brightness(0) invert(1)" }}
              />
              Edit Column
            </button>
          </div>,
          document.body,
        )
      : null;

  const renderBuilderBlock = (
    containerId: string,
    columnId: string,
    block: QuoteTemplateBlock,
  ) => {
    const isSelected = selectedBlockRef?.blockId === block.id;
    const selectBlock = () => {
      commitSelectedElementContent();
      setLayoutEditTarget(null);
      setSelectedBlockRef({ containerId, columnId, blockId: block.id });
    };
    const wrapperClass = `group/block relative box-border rounded-[6px] border-2 text-left transition-colors ${
      isSelected
        ? "border-[#2F6BFF]"
        : "border-transparent hover:border-[#7EA6FF]"
    }`;

    if (isSelected && block.type !== "logo") {
      return (
        <div
          key={block.id}
          className={wrapperClass}
          onMouseDown={() => selectBlock()}
          onClick={() => selectBlock()}
        >
          <div
            ref={selectedElementEditorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={syncSelectedElementEditorContent}
            onBlur={() => {
              if (skipSelectedElementBlurRef.current) return;
              syncSelectedElementEditorContent();
            }}
            onKeyUp={captureSelectedElementRange}
            onMouseUp={captureSelectedElementRange}
            onFocus={captureSelectedElementRange}
            className={`min-h-[18px] w-full bg-transparent px-0 py-0 text-[12px] leading-[1.45] outline-none whitespace-pre-wrap [&_div]:m-0 [&_p]:m-0 [&_div]:leading-[1.45] [&_p]:leading-[1.45] ${block.type === "projectText" ? "text-[#667085]" : "text-[#0F172A]"}`}
            style={{ color: previewBlockTextColor(block) }}
          />
        </div>
      );
    }

    return (
      <div
        key={block.id}
        role="button"
        tabIndex={0}
        draggable
        onDragStart={handleDragStart({ type: "block", containerId, columnId, blockId: block.id })}
        onDragEnd={handleDragEnd}
        onDragOver={(event) => {
          if (dragItem?.type !== "block") return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={(event) => {
          if (dragItem?.type !== "block") return;
          event.preventDefault();
          event.stopPropagation();
          moveBlockToColumn(
            dragItem.containerId,
            dragItem.columnId,
            dragItem.blockId,
            containerId,
            columnId,
            block.id,
          );
          setDragItem(null);
        }}
        onMouseDown={() => selectBlock()}
        onClick={() => selectBlock()}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          selectBlock();
        }}
        className={wrapperClass}
      >
        <PreviewBlock block={block} companyName={companyName} companyLogoPath={companyLogoPath} />
      </div>
    );
  };

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="space-y-4">
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#D7DEE8] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => router.push("/company-settings")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFD] text-[#344054]"
              >
                <ArrowLeft size={17} />
              </button>
              <div className="min-w-0">
                <p className="text-[12px] uppercase tracking-[1px] text-[#667085]">Integrations</p>
                <div className="flex items-center gap-2">
                  <LayoutTemplate size={18} className="text-[#12345B]" />
                  <p className="truncate text-[19px] font-semibold text-[#12345B]">Quote Layout Builder</p>
                </div>
                <p className="text-[12px] text-[#667085]">{companyName || "Company"} template used across every project.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFD] px-3 py-[7px] text-[11px] font-semibold text-[#475467]">
                {isLoading ? "Loading..." : saveLabel}
              </span>
              <button
                type="button"
                onClick={saveTemplate}
                disabled={isLoading || isSaving || !activeCompanyId}
                className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-[#1EA44B] px-4 text-[12px] font-bold text-white disabled:opacity-60"
              >
                <Save size={15} />
                {isSaving ? "Saving..." : "Save Template"}
              </button>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_260px]">
            <section className="space-y-3">
              <div className="rounded-[14px] border border-[#D7DEE8] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <p className="text-[13px] font-semibold text-[#12345B]">Template Settings</p>
                <div className="mt-3 space-y-2">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#667085]">Template Name</p>
                    <input
                      value={template.templateName}
                      onChange={(e) => setTemplate((prev) => ({ ...prev, templateName: e.target.value }))}
                      className="h-9 w-full rounded-[10px] border border-[#D8DEE8] bg-white px-3 text-[12px] text-[#334155]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#667085]">Page Size</p>
                      <input
                        value={template.pageSize}
                        onChange={(e) => setTemplate((prev) => ({ ...prev, pageSize: e.target.value }))}
                        className="h-9 w-full rounded-[10px] border border-[#D8DEE8] bg-white px-3 text-[12px] text-[#334155]"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#667085]">Margin (mm)</p>
                      <input
                        value={template.marginMm}
                        onChange={(e) => setTemplate((prev) => ({ ...prev, marginMm: e.target.value.replace(/[^\d]/g, "") }))}
                        className="h-9 w-full rounded-[10px] border border-[#D8DEE8] bg-white px-3 text-[12px] text-[#334155]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[14px] border border-[#D7DEE8] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <p className="text-[13px] font-semibold text-[#12345B]">Add Container</p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => addContainer()}
                    className="flex w-full items-center justify-between rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFD] px-3 py-2 text-left"
                  >
                    <span className="text-[12px] font-semibold text-[#344054]">Add blank container</span>
                    <Plus size={15} className="text-[#667085]" />
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-[#667085]">
                  Add a blank container first, then hover the container and use Edit Container to add the column layout. Maximum 6 columns.
                </p>
              </div>

              <div className="rounded-[14px] border border-[#D7DEE8] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <p className="text-[13px] font-semibold text-[#12345B]">
                  {selectedLayoutMeta ? `Edit ${selectedLayoutMeta.kind === "container" ? "Container" : "Column"}` : "Selected Element"}
                </p>
                {selectedLayoutMeta ? (
                  <div className="mt-3 space-y-3">
                    {selectedLayoutMeta.kind === "container" ? (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="inline-flex items-center gap-2 rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFD] px-3 py-2 text-[12px] font-semibold text-[#475467]">
                            <input
                              type="checkbox"
                              checked={selectedLayoutMeta.container.mount === "top"}
                              onChange={(e) => updateContainer(selectedLayoutMeta.container.id, { mount: e.target.checked ? "top" : "flow" })}
                            />
                            Top
                          </label>
                          <label className="inline-flex items-center gap-2 rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFD] px-3 py-2 text-[12px] font-semibold text-[#475467]">
                            <input
                              type="checkbox"
                              checked={selectedLayoutMeta.container.mount === "bottom"}
                              onChange={(e) => updateContainer(selectedLayoutMeta.container.id, { mount: e.target.checked ? "bottom" : "flow" })}
                            />
                            Bottom
                          </label>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#667085]">Add Columns</p>
                          <div className="grid grid-cols-2 gap-2">
                            {containerPresets.map((preset) => (
                              <button
                                key={`${selectedLayoutMeta.container.id}_${preset.label}`}
                                type="button"
                                onClick={() => applyContainerPreset(selectedLayoutMeta.container.id, preset.spans)}
                                className="rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFD] px-3 py-2 text-left text-[11px] font-semibold text-[#475467]"
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : null}
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#667085]">Border</p>
                      <div className="flex items-end gap-2">
                        <label
                          className="relative block h-9 w-12 cursor-pointer overflow-hidden rounded-[10px] border border-[#D8DEE8] bg-white"
                          title={selectedLayoutMeta.style.borderColor || companyThemeColor}
                        >
                          <span
                            className="block h-full w-full"
                            style={{ backgroundColor: selectedLayoutMeta.style.borderColor || companyThemeColor }}
                          />
                          <input
                            type="color"
                            value={selectedLayoutMeta.style.borderColor || companyThemeColor}
                            onChange={(e) =>
                              selectedLayoutMeta.kind === "container"
                                ? updateContainerStyle(selectedLayoutMeta.container.id, { borderColor: e.target.value })
                                : updateColumnStyle(selectedLayoutMeta.container.id, selectedLayoutMeta.column.id, { borderColor: e.target.value })
                            }
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            selectedLayoutMeta.kind === "container"
                              ? updateContainerStyle(selectedLayoutMeta.container.id, { borderColor: companyThemeColor })
                              : updateColumnStyle(selectedLayoutMeta.container.id, selectedLayoutMeta.column.id, { borderColor: companyThemeColor })
                          }
                          className="h-9 rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFD] px-3 text-[11px] font-bold text-[#475467]"
                        >
                          Theme
                        </button>
                        <div className="space-y-1">
                          <p className="text-[10px] font-medium text-[#98A2B3]">Thickness</p>
                          <input
                            value={selectedLayoutMeta.style.borderWidthPx ?? ""}
                            onChange={(e) =>
                              selectedLayoutMeta.kind === "container"
                                ? updateContainerStyle(selectedLayoutMeta.container.id, { borderWidthPx: e.target.value.replace(/[^\d]/g, "") })
                                : updateColumnStyle(selectedLayoutMeta.container.id, selectedLayoutMeta.column.id, { borderWidthPx: e.target.value.replace(/[^\d]/g, "") })
                            }
                            placeholder="px"
                            className="h-9 w-[68px] rounded-[10px] border border-[#D8DEE8] bg-white px-3 text-[12px] text-[#334155]"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#667085]">Fill Colour</p>
                      <div className="flex items-center gap-2">
                        <label
                          className="relative block h-9 w-12 cursor-pointer overflow-hidden rounded-[10px] border border-[#D8DEE8] bg-white"
                          title={selectedLayoutMeta.style.fillColor || companyThemeColor}
                        >
                          <span
                            className="block h-full w-full"
                            style={{ backgroundColor: selectedLayoutMeta.style.fillColor || companyThemeColor }}
                          />
                          <input
                            type="color"
                            value={selectedLayoutMeta.style.fillColor || companyThemeColor}
                            onChange={(e) =>
                              selectedLayoutMeta.kind === "container"
                                ? updateContainerStyle(selectedLayoutMeta.container.id, { fillColor: e.target.value })
                                : updateColumnStyle(selectedLayoutMeta.container.id, selectedLayoutMeta.column.id, { fillColor: e.target.value })
                            }
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            selectedLayoutMeta.kind === "container"
                              ? updateContainerStyle(selectedLayoutMeta.container.id, { fillColor: companyThemeColor })
                              : updateColumnStyle(selectedLayoutMeta.container.id, selectedLayoutMeta.column.id, { fillColor: companyThemeColor })
                          }
                          className="h-9 rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFD] px-3 text-[11px] font-bold text-[#475467]"
                        >
                          Theme
                        </button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#667085]">Padding (px)</p>
                        <div className="grid grid-cols-4 gap-2">
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium text-[#98A2B3]">Top</p>
                            <input
                              value={selectedLayoutMeta.style.paddingTopPx ?? selectedLayoutMeta.style.paddingPx ?? ""}
                              onChange={(e) =>
                                selectedLayoutMeta.kind === "container"
                                  ? updateContainerStyle(selectedLayoutMeta.container.id, { paddingTopPx: normalizeSignedPixelInput(e.target.value) })
                                  : updateColumnStyle(selectedLayoutMeta.container.id, selectedLayoutMeta.column.id, { paddingTopPx: normalizeSignedPixelInput(e.target.value) })
                              }
                              className="h-9 w-full rounded-[10px] border border-[#D8DEE8] bg-white px-3 text-[12px] text-[#334155]"
                            />
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium text-[#98A2B3]">Bottom</p>
                            <input
                              value={selectedLayoutMeta.style.paddingBottomPx ?? selectedLayoutMeta.style.paddingPx ?? ""}
                              onChange={(e) =>
                                selectedLayoutMeta.kind === "container"
                                  ? updateContainerStyle(selectedLayoutMeta.container.id, { paddingBottomPx: normalizeSignedPixelInput(e.target.value) })
                                  : updateColumnStyle(selectedLayoutMeta.container.id, selectedLayoutMeta.column.id, { paddingBottomPx: normalizeSignedPixelInput(e.target.value) })
                              }
                              className="h-9 w-full rounded-[10px] border border-[#D8DEE8] bg-white px-3 text-[12px] text-[#334155]"
                            />
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium text-[#98A2B3]">Left</p>
                            <input
                              value={selectedLayoutMeta.style.paddingLeftPx ?? selectedLayoutMeta.style.paddingPx ?? ""}
                              onChange={(e) =>
                                selectedLayoutMeta.kind === "container"
                                  ? updateContainerStyle(selectedLayoutMeta.container.id, { paddingLeftPx: normalizeSignedPixelInput(e.target.value) })
                                  : updateColumnStyle(selectedLayoutMeta.container.id, selectedLayoutMeta.column.id, { paddingLeftPx: normalizeSignedPixelInput(e.target.value) })
                              }
                              className="h-9 w-full rounded-[10px] border border-[#D8DEE8] bg-white px-3 text-[12px] text-[#334155]"
                            />
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium text-[#98A2B3]">Right</p>
                            <input
                              value={selectedLayoutMeta.style.paddingRightPx ?? selectedLayoutMeta.style.paddingPx ?? ""}
                              onChange={(e) =>
                                selectedLayoutMeta.kind === "container"
                                  ? updateContainerStyle(selectedLayoutMeta.container.id, { paddingRightPx: normalizeSignedPixelInput(e.target.value) })
                                  : updateColumnStyle(selectedLayoutMeta.container.id, selectedLayoutMeta.column.id, { paddingRightPx: normalizeSignedPixelInput(e.target.value) })
                              }
                              className="h-9 w-full rounded-[10px] border border-[#D8DEE8] bg-white px-3 text-[12px] text-[#334155]"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLayoutEditTarget(null)}
                      className="inline-flex h-9 w-full items-center justify-center rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFD] text-[12px] font-semibold text-[#475467]"
                    >
                      Done
                    </button>
                    {selectedLayoutMeta.kind === "column" ? (
                      <button
                        type="button"
                        onClick={() => {
                          removeColumnFromContainer(selectedLayoutMeta.container.id, selectedLayoutMeta.column.id);
                          setLayoutEditTarget(null);
                        }}
                        className="inline-flex h-9 w-full items-center justify-center rounded-[10px] border border-[#F2B8B5] bg-[#FDECEC] text-[12px] font-semibold text-[#B42318]"
                      >
                        Delete Column
                      </button>
                    ) : null}
                  </div>
                ) : selectedBlockMeta ? (
                  <div className="mt-3 space-y-3">
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#667085]">Element Label</p>
                      <input
                        value={selectedBlockMeta.block.label}
                        onChange={(e) =>
                          updateBlockInColumn(
                            selectedBlockMeta.container.id,
                            selectedBlockMeta.column.id,
                            selectedBlockMeta.block.id,
                            { label: e.target.value },
                          )
                        }
                        className="h-9 w-full rounded-[10px] border border-[#D8DEE8] bg-white px-3 text-[12px] text-[#334155]"
                      />
                    </div>
                    {selectedBlockMeta.block.type !== "logo" ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          {[
                            { command: "bold" as const, label: "B" },
                            { command: "italic" as const, label: "I" },
                            { command: "underline" as const, label: "U" },
                            { command: "strikeThrough" as const, label: "S" },
                          ].map((item) => (
                            <button
                              key={item.command}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySelectedElementCommand(item.command);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFD] text-[12px] font-bold text-[#344054]"
                              title={item.label}
                            >
                              {item.label}
                            </button>
                          ))}
                          {[
                            { value: "left" as const, label: "L" },
                            { value: "center" as const, label: "C" },
                            { value: "right" as const, label: "R" },
                          ].map((item) => (
                            <button
                              key={item.value}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySelectedElementAlignment(item.value);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFD] text-[12px] font-bold text-[#344054]"
                              title={`Align ${item.value}`}
                            >
                              {item.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              skipSelectedElementBlurRef.current = true;
                              captureSelectedElementRange();
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              selectedElementColorInputRef.current?.click();
                            }}
                            className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFD] px-2 text-[11px] font-semibold text-[#344054]"
                            title="Text colour"
                          >
                            <span
                              className="inline-block h-4 w-4 rounded-[4px] border border-[#D8DEE8]"
                              style={{ backgroundColor: selectedElementColorDraft || companyThemeColor || "#12345B" }}
                            />
                            Color
                          </button>
                          <input
                            ref={selectedElementColorInputRef}
                            type="color"
                            value={selectedElementColorDraft || companyThemeColor || "#12345B"}
                            onClick={(e) => e.stopPropagation()}
                            onInput={(e) => {
                              const nextColor = (e.target as HTMLInputElement).value;
                              setSelectedElementColorDraft(nextColor);
                            }}
                            onChange={(e) => {
                              const nextColor = e.target.value;
                              setSelectedElementColorDraft(nextColor);
                              applySelectedElementColor(nextColor);
                              endSelectedElementFormatInteraction();
                            }}
                            className="absolute h-0 w-0 opacity-0 pointer-events-none"
                            tabIndex={-1}
                            aria-hidden="true"
                          />
                        </div>
                        <div className="grid grid-cols-[1fr_84px] gap-2">
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium text-[#98A2B3]">Font</p>
                            <select
                              value={selectedElementFontFamilyDraft}
                              onPointerDown={() => beginSelectedElementFormatInteraction()}
                              onChange={(e) => {
                                const nextFont = e.target.value;
                                setSelectedElementFontFamilyDraft(nextFont);
                                applySelectedElementInlineStyle({ fontFamily: nextFont });
                                captureSelectedElementRange();
                                endSelectedElementFormatInteraction();
                                window.setTimeout(() => restoreSelectedElementRange(), 0);
                              }}
                              className="h-8 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[11px] text-[#344054]"
                            >
                              {quoteFontOptions.map((font) => (
                                <option key={font.label} value={font.value}>
                                  {font.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium text-[#98A2B3]">Size</p>
                            <select
                              value={selectedElementFontSizeDraft}
                              onPointerDown={() => beginSelectedElementFormatInteraction()}
                              onChange={(e) => {
                                const nextSize = e.target.value;
                                setSelectedElementFontSizeDraft(nextSize);
                                applySelectedElementInlineStyle({ fontSizePx: `${nextSize}px` });
                                endSelectedElementFormatInteraction();
                                window.setTimeout(() => restoreSelectedElementRange(), 0);
                              }}
                              className="h-8 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[11px] text-[#344054]"
                            >
                              {quoteFontSizeOptions.map((size) => (
                                <option key={size} value={size}>
                                  {size}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <p className="text-[11px] text-[#98A2B3]">
                          Type directly into the selected element on the preview. Use these controls for formatting only.
                        </p>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          removeBlockFromColumn(
                            selectedBlockMeta.container.id,
                            selectedBlockMeta.column.id,
                            selectedBlockMeta.block.id,
                          )
                        }
                        className="inline-flex h-9 items-center justify-center rounded-[10px] border border-[#F2B8B5] bg-[#FDECEC] text-[12px] font-semibold text-[#B42318]"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-[10px] border border-dashed border-[#CBD5E1] bg-[#F8FAFD] px-3 py-4 text-[12px] text-[#667085]">
                    Select an element from the preview to edit its content.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[18px] border border-[#D7DEE8] bg-[#EDEFF4] p-4 shadow-[inset_0_1px_2px_rgba(16,24,40,0.04)]">
              <div className="mx-auto mb-3 flex w-full max-w-[800px] items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-[#475467]">
                  {template.pageSize} preview • {previewPaper.widthMm} x {previewPaper.heightMm} mm • {template.marginMm || "12"}mm margin
                </p>
                <span className="rounded-[999px] border border-[#D8DEE8] bg-white px-3 py-1 text-[11px] font-semibold text-[#475467]">
                  {enabledContainers.length} active containers
                </span>
              </div>
              <div
                className="relative z-0 mx-auto w-full max-w-[800px] rounded-[18px] border border-[#D7DEE8] bg-white shadow-[0_18px_36px_rgba(15,23,42,0.08)]"
                style={{
                  aspectRatio: `${previewPaper.widthMm} / ${previewPaper.heightMm}`,
                  padding: `${Math.max(10, Number(template.marginMm || 12)) * 2.6}px`,
                  overflow: "visible",
                }}
              >
                <div className="flex h-full flex-col">
                  <div className="space-y-4">
                    {topMountedContainers.map((container) => (
                    <div
                      key={container.id}
                      className={`group relative z-10 w-full transition-all ${
                          dragItem?.type === "container" && dragItem.containerId === container.id
                            ? "z-30 scale-[1.01] opacity-80 shadow-[0_20px_40px_rgba(15,23,42,0.18)]"
                            : ""
                        } ${
                          containerDropTargetId === container.id && dragItem?.type === "container"
                            ? "translate-y-2"
                            : ""
                        }`}
                        onDragOver={(event) => {
                          if (dragItem?.type !== "container") return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setContainerDropTargetId(container.id);
                        }}
                        onMouseEnter={(event) => showContainerEditButton(container.id, event.currentTarget)}
                        onDragEnter={(event) => {
                          if (dragItem?.type !== "container") return;
                          event.preventDefault();
                          setContainerDropTargetId(container.id);
                        }}
                        onMouseLeave={scheduleHideContainerEditButton}
                        onDragLeave={(event) => {
                          if (dragItem?.type !== "container") return;
                          const nextTarget = event.relatedTarget as Node | null;
                          if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                          setContainerDropTargetId((prev) => (prev === container.id ? null : prev));
                        }}
                        onDrop={(event) => {
                          if (dragItem?.type !== "container") return;
                          event.preventDefault();
                          moveContainerBefore(dragItem.containerId, container.id);
                          setDragItem(null);
                          setContainerDropTargetId(null);
                        }}
                      >
                        <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-px bg-[#7E9EBB] opacity-0 transition-opacity group-hover:opacity-100" />
                        <div className="pointer-events-none absolute left-0 right-0 bottom-0 z-20 h-px bg-[#7E9EBB] opacity-0 transition-opacity group-hover:opacity-100" />
                        {containerDropTargetId === container.id && dragItem?.type === "container" ? (
                          <div className="mb-2 h-[10px] w-full bg-[#DCE7F8]" />
                        ) : null}
                        {container.columns.length > 0 ? (
                          <div
                            className="flex w-full flex-wrap items-stretch"
                            style={{ minHeight: "20px", border: `1px solid ${companyThemeColor}`, ...layoutBoxStyle(container.style, companyThemeColor) }}
                          >
                            {container.columns.map((column, index) => (
                              <div
                                key={column.id}
                                className="group/column relative flex min-h-[20px] flex-col border-[#D7DEE8]"
                                style={{
                                  flex: `0 0 ${columnWidthPercent(column.span)}%`,
                                  maxWidth: `${columnWidthPercent(column.span)}%`,
                                  borderRightWidth: "1px",
                                  borderBottomWidth: "1px",
                                  ...layoutBoxStyle(column.style),
                                }}
                              onDragOver={(event) => {
                                if (!dragItem || (dragItem.type !== "column" && dragItem.type !== "block")) return;
                                event.preventDefault();
                              }}
                              onMouseEnter={(event) => showColumnEditButton(container.id, column.id, event.currentTarget)}
                              onMouseLeave={(event) => {
                                const nextTarget = event.relatedTarget;
                                if (hasClosest(nextTarget) && nextTarget.closest("[data-quote-column-edit-portal]")) return;
                                scheduleHideColumnEditButton();
                              }}
                              onDrop={(event) => {
                                if (!dragItem) return;
                                event.preventDefault();
                                event.stopPropagation();
                                  if (dragItem.type === "column") {
                                    moveColumnBefore(dragItem.containerId, dragItem.columnId, container.id, column.id);
                                  }
                                  if (dragItem.type === "block") {
                                    moveBlockToColumn(dragItem.containerId, dragItem.columnId, dragItem.blockId, container.id, column.id);
                                }
                                setDragItem(null);
                              }}
                            >
                              <div className="pointer-events-none absolute right-3 top-3 z-20 transition-opacity opacity-0 group-hover/column:opacity-100">
                                <div className="pointer-events-auto relative z-30">
                                  <button
                                    type="button"
                                    data-quote-element-button
                                    onClick={(event) => openElementPickerAtButton(event, container.id, column.id)}
                                    className="inline-flex h-6 items-center gap-1 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[10px] font-semibold text-[#475467]"
                                  >
                                    <Plus size={12} />
                                    Element
                                  </button>
                                </div>
                              </div>
                                <div className="flex flex-1 flex-col gap-0">
                                  {column.blocks.filter((block) => block.enabled).length > 0 ? (
                                    column.blocks.filter((block) => block.enabled).map((block) =>
                                      renderBuilderBlock(container.id, column.id, block),
                                    )
                                  ) : (
                                    <div className="flex flex-1 items-center justify-center px-3 py-4 text-center text-[11px] text-[#94A3B8]">
                                      Add an element to this column
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex min-h-[20px] w-full items-center justify-center rounded-[12px] border border-dashed border-[#CBD5E1] bg-white px-3 py-2 text-[12px] text-[#667085]">
                            Choose a column layout for this container
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-4">
                  {flowContainers.map((container) => (
                      <div
                        key={container.id}
                      className={`group relative z-10 w-full transition-all ${
                        dragItem?.type === "container" && dragItem.containerId === container.id
                          ? "z-30 scale-[1.01] opacity-80 shadow-[0_20px_40px_rgba(15,23,42,0.18)]"
                          : ""
                      } ${
                        containerDropTargetId === container.id && dragItem?.type === "container"
                          ? "translate-y-2"
                          : ""
                      }`}
                      onDragOver={(event) => {
                        if (dragItem?.type !== "container") return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setContainerDropTargetId(container.id);
                      }}
                      onMouseEnter={(event) => showContainerEditButton(container.id, event.currentTarget)}
                      onDragEnter={(event) => {
                        if (dragItem?.type !== "container") return;
                        event.preventDefault();
                        setContainerDropTargetId(container.id);
                      }}
                      onMouseLeave={scheduleHideContainerEditButton}
                      onDragLeave={(event) => {
                        if (dragItem?.type !== "container") return;
                        const nextTarget = event.relatedTarget as Node | null;
                        if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                        setContainerDropTargetId((prev) => (prev === container.id ? null : prev));
                      }}
                      onDrop={(event) => {
                        if (dragItem?.type !== "container") return;
                        event.preventDefault();
                        moveContainerBefore(dragItem.containerId, container.id);
                        setDragItem(null);
                        setContainerDropTargetId(null);
                      }}
                    >
                      <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-px bg-[#7E9EBB] opacity-0 transition-opacity group-hover:opacity-100" />
                      <div className="pointer-events-none absolute left-0 right-0 bottom-0 z-20 h-px bg-[#7E9EBB] opacity-0 transition-opacity group-hover:opacity-100" />
                      {containerDropTargetId === container.id && dragItem?.type === "container" ? (
                        <div className="mb-2 h-[10px] w-full bg-[#DCE7F8]" />
                      ) : null}
                      {container.columns.length > 0 ? (
                          <div
                            className="flex w-full flex-wrap items-stretch"
                            style={{ minHeight: "20px", border: `1px solid ${companyThemeColor}`, ...layoutBoxStyle(container.style, companyThemeColor) }}
                          >
                          {container.columns.map((column, index) => (
                            <div
                              key={column.id}
                              className="group/column relative flex min-h-[20px] flex-col border-[#D7DEE8]"
                              style={{
                                flex: `0 0 ${columnWidthPercent(column.span)}%`,
                                maxWidth: `${columnWidthPercent(column.span)}%`,
                                borderRightWidth: "1px",
                                borderBottomWidth: "1px",
                                  ...layoutBoxStyle(column.style),
                                }}
                              onDragOver={(event) => {
                                if (!dragItem || (dragItem.type !== "column" && dragItem.type !== "block")) return;
                                event.preventDefault();
                              }}
                              onMouseEnter={(event) => showColumnEditButton(container.id, column.id, event.currentTarget)}
                              onMouseLeave={(event) => {
                                const nextTarget = event.relatedTarget;
                                if (hasClosest(nextTarget) && nextTarget.closest("[data-quote-column-edit-portal]")) return;
                                scheduleHideColumnEditButton();
                              }}
                              onDrop={(event) => {
                                if (!dragItem) return;
                                event.preventDefault();
                                event.stopPropagation();
                                if (dragItem.type === "column") {
                                  moveColumnBefore(dragItem.containerId, dragItem.columnId, container.id, column.id);
                                }
                                if (dragItem.type === "block") {
                                  moveBlockToColumn(dragItem.containerId, dragItem.columnId, dragItem.blockId, container.id, column.id);
                                }
                                setDragItem(null);
                              }}
                            >
                                <div className="pointer-events-none absolute right-3 top-3 z-20 transition-opacity opacity-0 group-hover/column:opacity-100">
                                  <div className="pointer-events-auto relative z-30">
                                    <button
                                      type="button"
                                      data-quote-element-button
                                      onClick={(event) => openElementPickerAtButton(event, container.id, column.id)}
                                      className="inline-flex h-6 items-center gap-1 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[10px] font-semibold text-[#475467]"
                                    >
                                      <Plus size={12} />
                                      Element
                                    </button>
                                  </div>
                                </div>
                              <div className="flex flex-1 flex-col gap-0">
                                {column.blocks.filter((block) => block.enabled).length > 0 ? (
                                  column.blocks.filter((block) => block.enabled).map((block) =>
                                    renderBuilderBlock(container.id, column.id, block),
                                  )
                                ) : (
                                  <div className="flex flex-1 items-center justify-center px-3 py-4 text-center text-[11px] text-[#94A3B8]">
                                    Add an element to this column
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex min-h-[20px] w-full items-center justify-center rounded-[12px] border border-dashed border-[#CBD5E1] bg-white px-3 py-2 text-[12px] text-[#667085]">
                          Choose a column layout for this container
                        </div>
                      )}
                    </div>
                  ))}
                  </div>
                  <div className="mt-auto space-y-4 pt-4">
                    {bottomMountedContainers.map((container) => (
                      <div
                        key={container.id}
                        className={`group relative z-10 w-full transition-all ${
                          dragItem?.type === "container" && dragItem.containerId === container.id
                            ? "z-30 scale-[1.01] opacity-80 shadow-[0_20px_40px_rgba(15,23,42,0.18)]"
                            : ""
                        } ${
                          containerDropTargetId === container.id && dragItem?.type === "container"
                            ? "translate-y-2"
                            : ""
                        }`}
                        onDragOver={(event) => {
                          if (dragItem?.type !== "container") return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setContainerDropTargetId(container.id);
                        }}
                        onMouseEnter={(event) => showContainerEditButton(container.id, event.currentTarget)}
                        onDragEnter={(event) => {
                          if (dragItem?.type !== "container") return;
                          event.preventDefault();
                          setContainerDropTargetId(container.id);
                        }}
                        onMouseLeave={scheduleHideContainerEditButton}
                        onDragLeave={(event) => {
                          if (dragItem?.type !== "container") return;
                          const nextTarget = event.relatedTarget as Node | null;
                          if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                          setContainerDropTargetId((prev) => (prev === container.id ? null : prev));
                        }}
                        onDrop={(event) => {
                          if (dragItem?.type !== "container") return;
                          event.preventDefault();
                          moveContainerBefore(dragItem.containerId, container.id);
                          setDragItem(null);
                          setContainerDropTargetId(null);
                        }}
                      >
                        <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-px bg-[#7E9EBB] opacity-0 transition-opacity group-hover:opacity-100" />
                        <div className="pointer-events-none absolute left-0 right-0 bottom-0 z-20 h-px bg-[#7E9EBB] opacity-0 transition-opacity group-hover:opacity-100" />
                        {containerDropTargetId === container.id && dragItem?.type === "container" ? (
                          <div className="mb-2 h-[10px] w-full bg-[#DCE7F8]" />
                        ) : null}
                        {container.columns.length > 0 ? (
                          <div
                            className="flex w-full flex-wrap items-stretch"
                            style={{ minHeight: "20px", border: `1px solid ${companyThemeColor}`, ...layoutBoxStyle(container.style, companyThemeColor) }}
                          >
                            {container.columns.map((column) => (
                              <div
                                key={column.id}
                                className="group/column relative flex min-h-[20px] flex-col border-[#D7DEE8]"
                                style={{
                                  flex: `0 0 ${columnWidthPercent(column.span)}%`,
                                  maxWidth: `${columnWidthPercent(column.span)}%`,
                                  borderRightWidth: "1px",
                                  borderBottomWidth: "1px",
                                  ...layoutBoxStyle(column.style),
                                }}
                                onDragOver={(event) => {
                                  if (!dragItem || (dragItem.type !== "column" && dragItem.type !== "block")) return;
                                  event.preventDefault();
                                }}
                                onMouseEnter={(event) => showColumnEditButton(container.id, column.id, event.currentTarget)}
                                onMouseLeave={(event) => {
                                  const nextTarget = event.relatedTarget;
                                  if (hasClosest(nextTarget) && nextTarget.closest("[data-quote-column-edit-portal]")) return;
                                  scheduleHideColumnEditButton();
                                }}
                                onDrop={(event) => {
                                  if (!dragItem) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (dragItem.type === "column") {
                                    moveColumnBefore(dragItem.containerId, dragItem.columnId, container.id, column.id);
                                  }
                                  if (dragItem.type === "block") {
                                    moveBlockToColumn(dragItem.containerId, dragItem.columnId, dragItem.blockId, container.id, column.id);
                                  }
                                  setDragItem(null);
                                }}
                              >
                                <div className="pointer-events-none absolute right-3 top-3 z-20 transition-opacity opacity-0 group-hover/column:opacity-100">
                                  <div className="pointer-events-auto relative z-30">
                                    <button
                                      type="button"
                                      data-quote-element-button
                                      onClick={(event) => openElementPickerAtButton(event, container.id, column.id)}
                                      className="inline-flex h-6 items-center gap-1 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[10px] font-semibold text-[#475467]"
                                    >
                                      <Plus size={12} />
                                      Element
                                    </button>
                                  </div>
                                </div>
                                <div className="flex flex-1 flex-col gap-0">
                                  {column.blocks.filter((block) => block.enabled).length > 0 ? (
                                    column.blocks.filter((block) => block.enabled).map((block) =>
                                      renderBuilderBlock(container.id, column.id, block),
                                    )
                                  ) : (
                                    <div className="flex flex-1 items-center justify-center px-3 py-4 text-center text-[11px] text-[#94A3B8]">
                                      Add an element to this column
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex min-h-[20px] w-full items-center justify-center rounded-[12px] border border-dashed border-[#CBD5E1] bg-white px-3 py-2 text-[12px] text-[#667085]">
                            Choose a column layout for this container
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="rounded-[14px] border border-[#D7DEE8] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <p className="text-[13px] font-semibold text-[#12345B]">Placeholders</p>
                <p className="mt-1 text-[11px] text-[#667085]">
                  Use these tokens inside a Text element. They will be replaced with project data in the quote.
                </p>
                <div className="mt-3 space-y-2">
                  {quotePlaceholders.map((item) => (
                    <div key={item.token} className="rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFD] px-3 py-2">
                      <p className="text-[11px] font-semibold text-[#344054]">{item.label}</p>
                      <p className="mt-1 break-all font-mono text-[11px] text-[#667085]">{item.token}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

          </div>
        </div>
        {elementPickerPortal}
        {containerEditButtonPortal}
        {columnEditButtonPortal}
      </AppShell>
    </ProtectedRoute>
  );
}

