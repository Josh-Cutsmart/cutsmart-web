import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toPng } from "html-to-image";
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import { storage } from "@/lib/firebase";
import {
  type SpecsGrid,
  type SpecsCellStyle,
  type SpecsTextRun,
  pruneEmptySpecsRows,
  getCellSpan,
  getCellRuns,
  getExpandedRowGroups,
  DEFAULT_CELL_FONT_SIZE_PX,
  DEFAULT_BORDER_WIDTH_PX,
  DEFAULT_COL_WIDTH_PX,
  DEFAULT_ROW_HEIGHT_PX,
} from "@/lib/specs-grid-types";

// Extracted verbatim from app/(app)/projects/[projectId]/page.tsx so the client hub's own Print/PDF
// (app/client/hub/[shareId]/page.tsx) produces the EXACT same clean, vector-text PDF the staff
// editor's "Print"/"Download PDF" buttons do — not a DOM screenshot approximation. Every function
// here is a pure function of a SpecsGrid (plus, for images, a Storage/HTTP fetch) with no dependency
// on component state, which is what made this extraction possible without touching behavior.

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob."));
    reader.readAsDataURL(blob);
  });
}

// jsPDF only ships helvetica/times/courier without embedding an actual font file, and its font
// embedder (jsPDF.API.TTFFont) only understands TrueType-outline (glyf/loca) fonts — not the CFF/
// PostScript outlines most script/signature-style OTF files (including this app's own
// public/fonts/Signature.otf, confirmed via its own table directory) actually use, so there's no
// reliable way to embed the real custom font here. This maps every SYSTEM_QUOTE_FONT_OPTIONS choice
// to whichever built-in comes closest by feel — an approximation, not a promise the printed page
// matches the screen pixel-for-pixel, same as picking any of the many other OS fonts in that list
// that this PDF library was never going to have either.
function resolvePdfFontFamily(cssFontFamily: string | undefined): "helvetica" | "times" | "courier" {
  const lower = (cssFontFamily || "").toLowerCase();
  if (!lower) return "helvetica";
  if (/courier|consolas|lucida console/.test(lower)) return "courier";
  if (/times|georgia|cambria|garamond|book antiqua|palatino/.test(lower)) return "times";
  return "helvetica";
}

function escapeSpecsCellHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The exact inverse of specs-grid-editor.tsx's own runsToHtml (not imported from there — a
// component file's internal helpers aren't meant to be reached into from elsewhere, and this is a
// few lines) — <b>/<u>/<br> matching a run's own bold/underline/embedded line breaks.
function specsRunsToHtml(runs: SpecsTextRun[]): string {
  return runs
    .map((run) => {
      const escaped = escapeSpecsCellHtml(run.text).replace(/\n/g, "<br>");
      let html = escaped;
      if (run.underline) html = `<u>${html}</u>`;
      if (run.bold) html = `<b>${html}</b>`;
      return html;
    })
    .join("");
}

// Renders a cell's real rich content to a raster image using the BROWSER's own layout/font engine
// — the only way to make BOTH of the following actually true in the PDF at once: (1) a font jsPDF
// can't embed as real vector text (see resolvePdfFontFamily's own comment — this app's own
// Signature.otf included) shows up looking like itself instead of falling back to a built-in, and
// (2) a cell mixing bold/plain/underlined text across several wrapped lines lands EXACTLY where the
// editor itself would wrap it, with no risk of overflowing into the row below. That second part
// used to be hand-rolled here as an independent word-wrap re-implementation measured via jsPDF's own
// getTextWidth — close, but never pixel-identical to the browser's real layout, and any cell whose
// hand-estimated wrap came out with MORE lines than the browser's real one overflowed straight into
// whatever printed below it. Measuring the real, unclipped natural height here (returned alongside
// the image) and letting the caller grow the row's own minCellHeight to match — rather than clipping
// to whatever the row's STORED heightPx already happened to be — closes that gap from the other
// side too: a row whose height wasn't (or couldn't be) auto-grown to fit isn't silently clipped in
// print either, exactly like a too-short row never silently clips content in the live editor itself.
// Shared by both functions below — everything about how a cell's rich content gets laid out in an
// offscreen element EXCEPT what happens to it afterward (just measured and discarded, vs. pinned to
// a final height and rasterized). Caller owns attaching/detaching `wrapper` to/from the document.
function buildOffscreenSpecsCellContainer(
  runs: SpecsTextRun[],
  style: SpecsCellStyle,
  widthPx: number,
): { wrapper: HTMLDivElement; container: HTMLDivElement } {
  // A zero-size, overflow-hidden, fixed-at-the-origin WRAPPER keeps this fully invisible without
  // resorting to shoving the real content far off in negative-coordinate space — some capture
  // implementations measure/clip oddly for elements positioned way outside any plausible viewport,
  // and the actual content node underneath still gets its own real box (and therefore real layout)
  // regardless of the wrapper clipping it from view.
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.top = "0";
  wrapper.style.left = "0";
  wrapper.style.width = "0";
  wrapper.style.height = "0";
  wrapper.style.overflow = "hidden";
  wrapper.style.zIndex = "-1";
  wrapper.style.pointerEvents = "none";
  const container = document.createElement("div");
  container.style.width = `${Math.max(1, Math.round(widthPx))}px`;
  // Height starts auto (unclipped) so scrollHeight reports how tall this content genuinely needs to
  // be — only pinned to a fixed px height (with clipping) afterward, once that's known, and only by
  // the caller that actually needs a final image rather than just a measurement.
  container.style.boxSizing = "border-box";
  container.style.padding = "2px 8px";
  container.style.background = "transparent";
  // Matches the editor's own vertical-align wrapper (specs-grid-editor.tsx) — flex column + one of
  // these three justify-content values. Harmless to set before a final height is pinned to anything
  // taller than the content's own natural height: a flex container's OWN natural size (what
  // scrollHeight measures) is unaffected by justify-content until there's actually extra space
  // inside it to redistribute, which there isn't yet while height is still auto.
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.justifyContent = style.verticalAlign === "middle" ? "center" : style.verticalAlign === "bottom" ? "flex-end" : "flex-start";
  // A single inner element holds the actual run HTML — every DIRECT child of a `display:flex`
  // container becomes its own flex item, so setting a multi-run cell's <b>/<u> spans straight as
  // THIS container's innerHTML made each run (a separate top-level node: a bare text node followed
  // by a <b> element, say) its own stacked flex item under flex-direction:column, forcing every run
  // onto its own line no matter how much width was actually available — exactly what made a bolded
  // placeholder at the end of a sentence always drop to a new line in print. Keeping the flex
  // container down to this ONE child (which justify-content then positions as a whole) lets the
  // runs inside it stay ordinary inline content that wraps together like any normal paragraph.
  const content = document.createElement("div");
  content.style.whiteSpace = "pre-wrap";
  content.style.wordBreak = "break-word";
  // Matches SpecsCellTextArea's own fallback exactly — "inherit" resolves against the real page's
  // body font-family (this element ends up appended to that same document below), the same as an
  // on-screen cell that never had a font explicitly chosen. A hardcoded font color, though, NOT
  // var(--text-main) — jsPDF's own vector-text path already defaults to plain black regardless of
  // the viewer's light/dark theme (it has no CSS/theme context of its own to read), and a captured
  // image inheriting a light dark-mode text color would print invisible on a white page.
  content.style.fontFamily = style.fontFamily || "inherit";
  content.style.fontSize = `${style.fontSize ?? DEFAULT_CELL_FONT_SIZE_PX}px`;
  content.style.textAlign = style.align ?? "left";
  content.style.color = style.textColor || "#000000";
  content.innerHTML = specsRunsToHtml(runs);
  container.appendChild(content);
  wrapper.appendChild(container);
  return { wrapper, container };
}

// Just the height measurement half of renderSpecsCellRunsToDataUrl below, without the (comparatively
// expensive) rasterization step — used for EVERY plain text cell, not just the rich/unembeddable-font
// ones that actually get rendered as images, so a row whose real (browser-wrapped) content needs more
// lines than jspdf-autotable's own internal wrap estimate assumed also gets grown to fit, the same
// way a rich cell already does. That mismatch — this app's own PDF-side text measurement landing on a
// different wrapped-line count than the real one the row's stored height was ever actually sized for
// — is what let a plain cell's second wrapped line overflow into the row below it in print.
async function measureSpecsCellNaturalHeightPx(runs: SpecsTextRun[], style: SpecsCellStyle, widthPx: number): Promise<number> {
  const { wrapper, container } = buildOffscreenSpecsCellContainer(runs, style, widthPx);
  document.body.appendChild(wrapper);
  try {
    return Math.max(1, container.scrollHeight);
  } finally {
    document.body.removeChild(wrapper);
  }
}

async function renderSpecsCellRunsToDataUrl(
  runs: SpecsTextRun[],
  style: SpecsCellStyle,
  widthPx: number,
  minHeightPx: number,
): Promise<{ dataUrl: string; heightPx: number } | null> {
  const { wrapper, container } = buildOffscreenSpecsCellContainer(runs, style, widthPx);
  document.body.appendChild(wrapper);
  try {
    // Explicitly requests THIS font/size combo, not just whatever's already loaded — a custom
    // @font-face like Signature might not have been requested by anything on the page yet (its
    // font-display: swap means the fallback renders immediately while it loads in the background),
    // so document.fonts.ready alone could resolve before it's actually ready to draw with.
    if (typeof document.fonts?.load === "function") {
      await document.fonts.load(`${style.fontSize ?? DEFAULT_CELL_FONT_SIZE_PX}px ${container.style.fontFamily}`).catch(() => {});
    }
    if (typeof document.fonts?.ready?.then === "function") await document.fonts.ready;
    const heightPx = Math.max(1, Math.round(minHeightPx), container.scrollHeight);
    container.style.height = `${heightPx}px`;
    container.style.overflow = "hidden";
    const dataUrl = await toPng(container, { pixelRatio: 2, cacheBust: true });
    return { dataUrl, heightPx };
  } catch {
    // Rendering this one cell as an image failed (an unavailable browser API, an unexpected DOM/
    // capture error) — the caller falls back to plain vector text for it rather than letting one
    // cell's failure abort the whole export.
    return null;
  } finally {
    document.body.removeChild(wrapper);
  }
}

export async function resolveProjectImageUrl(raw: string): Promise<string> {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const storageClient = storage;
  if (!storageClient) return "";
  const normalized = value.replace(/^\/+/, "");
  try {
    return await getDownloadURL(storageRef(storageClient, normalized));
  } catch {
    try {
      return await getDownloadURL(storageRef(storageClient, value));
    } catch {
      return "";
    }
  }
}

export async function resolveProjectImageDataUrl(raw: string): Promise<string> {
  const resolvedUrl =
    (await resolveProjectImageUrl(raw)) ||
    (/^https?:\/\//i.test(String(raw || "").trim()) ? String(raw || "").trim() : "");
  if (!resolvedUrl) return "";
  try {
    const response = await fetch(resolvedUrl, { mode: "cors", credentials: "omit", cache: "force-cache" });
    if (!response.ok) return resolvedUrl;
    const imageBlob = await response.blob();
    return await blobToDataUrl(imageBlob);
  } catch {
    return resolvedUrl;
  }
}

// Reads the grid's own columnWidths/row heights/cell text/style directly — no style-pool
// indirection, no hidden rows/columns, no Excel-style "text spills into the next empty cell"
// simulation to fight (cells just wrap normally like a plain table). Much simpler than the old
// Univer-based version, since this data model is entirely ours end-to-end.
export async function buildSpecsGridPdfBlob(rawGrid: SpecsGrid): Promise<Blob | null> {
  // Older projects (and anything a company's 100-row default template still carries) can have a
  // stored sheet full of unused blank rows from before empty rows were pruned at clone time — strip
  // them here too, right before export, so print/PDF output never regresses to spilling those rows
  // across several mostly-blank extra pages, regardless of how the on-screen grid got that way.
  const grid = pruneEmptySpecsRows(rawGrid);
  if (grid.rows.length === 0 || grid.columnWidths.length === 0) return null;

  // Same defensive sanitizing as the editor's own render path (specs-grid-editor.tsx) — a single
  // bad stored width/height would otherwise poison the whole PDF's layout math.
  const columnWidths = grid.columnWidths.map((w) => (typeof w === "number" && Number.isFinite(w) && w > 0 ? w : DEFAULT_COL_WIDTH_PX));
  const rowHeights = grid.rows.map((r) => (typeof r.heightPx === "number" && Number.isFinite(r.heightPx) && r.heightPx > 0 ? r.heightPx : DEFAULT_ROW_HEIGHT_PX));

  // CSS reference pixel (96 DPI) -> PDF point (72 DPI) — the exact ratio a browser uses when it
  // prints px-sized content, so a column/row converted this way lands at the same physical size
  // on paper as it renders on screen, instead of stretching to always fill the full page width.
  const PX_TO_PT = 0.75;
  // jspdf-autotable's own approximate ratio between a cell's font size and the line-height it
  // actually needs (its internal FONT_ROW_RATIO) — used below to size text down to fit a short
  // row's own padding-adjusted space, rather than letting autoTable's default floor inflate it.
  const SPECS_PDF_LINE_HEIGHT_FACTOR = 1.15;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: grid.pageSize.toLowerCase() });
  const pageWidthPt = doc.internal.pageSize.getWidth();
  const marginPt = 24;
  const usableWidthPt = pageWidthPt - marginPt * 2;
  const totalWidthPt = columnWidths.reduce((sum, w) => sum + w, 0) * PX_TO_PT || 1;
  // Only ever shrink (never stretch) so a narrow grid prints at its true designed size instead of
  // being blown up to fill the page — the same factor applies to width/height/font/border/padding
  // so a cell's shape stays faithful to what it looked like on screen.
  const scale = totalWidthPt > usableWidthPt ? usableWidthPt / totalWidthPt : 1;

  // Cell images are stored as plain (small) URLs, not embedded data — resolve every distinct one
  // to a data URL up front (jsPDF's addImage/getImageProperties need real image data, not a bare
  // URL) since `didDrawCell` below runs synchronously during the table's render pass.
  const distinctImageUrls = Array.from(
    new Set(grid.rows.flatMap((row) => row.cells.flatMap((cell) => (cell?.imageUrl ? [cell.imageUrl] : [])))),
  );
  const imageDataUrlEntries = await Promise.all(
    distinctImageUrls.map(async (url) => [url, await resolveProjectImageDataUrl(url)] as const),
  );
  const imageDataUrlCache: Record<string, string> = Object.fromEntries(imageDataUrlEntries);

  type AutoTableCell = {
    content: string;
    colSpan?: number;
    rowSpan?: number;
    styles?: Record<string, unknown>;
    imageUrl?: string;
    imageAlign?: SpecsCellStyle["align"];
    imageVerticalAlign?: SpecsCellStyle["verticalAlign"];
    underline?: boolean;
    // A richCellKey image (rendered text, not a real logo/picture) — see its own push-site comment
    // for why this bypasses the fit-centered/imageAlign math entirely in didDrawCell below.
    isRichCellImage?: boolean;
  };
  // Expanded once here (not per-cell) — see getExpandedRowGroups' own comment: a group's saved
  // bounds can cut through a merged cell it was only meant to partially border, so every read of a
  // group's bounds goes through this correction rather than the raw grid.groups list. A hidden
  // group's rows are skipped from the output entirely (not just blanked) — matching the editor's
  // own "completely hides" behavior for a project's own copy of the sheet.
  const expandedGroups = getExpandedRowGroups(grid);
  const hiddenRowIndexes = new Set<number>();
  for (const g of expandedGroups) {
    if (!g.hidden) continue;
    for (let r = g.startRow; r <= g.endRow; r += 1) hiddenRowIndexes.add(r);
  }
  // Every non-image, non-empty cell's real (browser-wrapped) height gets measured up front, all in
  // parallel — for a rich cell (mixed bold/underline, or an unembeddable font — see
  // renderSpecsCellRunsToDataUrl's own comment for both), that's a full render to an image; for a
  // plain one, it's just a layout measurement (measureSpecsCellNaturalHeightPx's own comment on
  // why: jspdf-autotable's own internal wrap estimate can land on a different line count than the
  // browser's real one, and a row whose stored height was only ever sized for the real count came
  // up short in print exactly where the estimate needed an extra line the row had no room for).
  // Done here rather than inside didDrawCell because that hook runs synchronously and can't await.
  type CellHeightTarget = { key: string; runs: SpecsTextRun[]; style: SpecsCellStyle; widthPx: number; minHeightPx: number; isRich: boolean };
  const cellHeightTargets: CellHeightTarget[] = [];
  for (let r = 0; r < grid.rows.length; r += 1) {
    if (hiddenRowIndexes.has(r)) continue;
    for (let c = 0; c < grid.columnWidths.length; c += 1) {
      const cell = grid.rows[r].cells[c];
      if (!cell || cell.imageUrl || !cell.text) continue;
      const runs = getCellRuns(cell);
      const style = cell.style ?? {};
      const usesUnembeddableFont = Boolean(style.fontFamily && style.fontFamily.toLowerCase().includes("signature"));
      const isRich = runs.length > 1 || usesUnembeddableFont;
      const { rowSpan, colSpan } = getCellSpan(cell);
      let widthPx = 0;
      for (let ci = c; ci < c + colSpan && ci < columnWidths.length; ci += 1) widthPx += columnWidths[ci];
      let minHeightPx = 0;
      for (let ri = r; ri < r + rowSpan && ri < rowHeights.length; ri += 1) minHeightPx += rowHeights[ri];
      cellHeightTargets.push({ key: `richcell:${r}:${c}`, runs, style, widthPx, minHeightPx, isRich });
    }
  }
  // Rich cells' rendered images (data URL + the height they actually got rendered at); keyed
  // separately from imageDataUrlCache (rather than merged into it) because the main pass below
  // also needs to read that height back out, not just the data URL — a rendering FAILURE (null;
  // see renderSpecsCellRunsToDataUrl's own comment) simply has no entry here, and that cell falls
  // back to plain vector text instead.
  const richCellRenderCache: Record<string, { dataUrl: string; heightPx: number }> = {};
  // Every measured cell's natural height in px (rich or plain) — the main pass below grows a
  // cell's own minCellHeight to at least this, regardless of which path ends up drawing it.
  const cellNaturalHeightCache: Record<string, number> = {};
  await Promise.all(
    cellHeightTargets.map(async (t) => {
      if (t.isRich) {
        const rendered = await renderSpecsCellRunsToDataUrl(t.runs, t.style, t.widthPx, t.minHeightPx);
        if (rendered) {
          richCellRenderCache[t.key] = rendered;
          imageDataUrlCache[t.key] = rendered.dataUrl;
          cellNaturalHeightCache[t.key] = rendered.heightPx;
        }
      } else {
        cellNaturalHeightCache[t.key] = await measureSpecsCellNaturalHeightPx(t.runs, t.style, t.widthPx);
      }
    }),
  );
  // anchorFirstPageBottom (see its own comment on SpecsRowGroup) — the spacer height needed to push
  // the earliest such group to the bottom of page 1 can only be known AFTER every row's real height
  // (including any natural-content growth from wrapped text/rich cells, computed below) is settled —
  // an earlier version of this calc summed raw stored row heights before that growth was known,
  // which drastically underestimated tall paragraph rows and made the anchor math wrong. See the
  // real calc, using `body`'s own finalized per-row heights, right before the autoTable() call below.
  const anchoredGroups = expandedGroups.filter((g) => g.anchorFirstPageBottom && !g.hidden);
  const anchorStartRow = anchoredGroups.length > 0 ? Math.min(...anchoredGroups.map((g) => g.startRow)) : -1;
  const body: AutoTableCell[][] = [];
  // Parallel to `body` — which original grid row each body row came from — so the anchor-spacer calc
  // below can find where `anchorStartRow` landed after hidden rows are skipped and (further down)
  // fully-covered rowSpan rows are collapsed away.
  const bodyRowGridIndex: number[] = [];

  for (let r = 0; r < grid.rows.length; r += 1) {
    if (hiddenRowIndexes.has(r)) continue;
    const row = grid.rows[r];
    const rowArr: AutoTableCell[] = [];
    for (let c = 0; c < grid.columnWidths.length; c += 1) {
      const cell = row.cells[c];
      if (cell === null) continue;
      const { rowSpan, colSpan } = getCellSpan(cell);
      const style = cell.style ?? {};
      // A cell's runs (see getCellRuns' own comment) are the one source of truth for bold/underline
      // now — a legacy or never-rich-edited cell synthesizes a single run from style.bold/underline
      // automatically, so reading runs here instead of `style` directly still sees the right value
      // for those, while also picking up a cell that WAS edited through the rich-text path but ended
      // up uniformly one style (style.bold/underline itself is not kept in sync with that case).
      const runs = getCellRuns(cell);
      const isMixedFormatting = runs.length > 1;
      // A confirmable cell's actual Yes/No state is drawn as a runtime overlay on screen
      // (ConfirmToggle in components/specs-grid-client-view.tsx) — never stored in cell.text — so
      // this generator has to reconstruct it explicitly here, or a client's own print/PDF of their
      // answers would always come out blank regardless of what they actually confirmed. Colors
      // match ConfirmToggle's own locked-state look (light-theme values — a printed page has no
      // dark mode to match).
      const isConfirmable = Boolean(cell.confirmable);
      const confirmLabel = isConfirmable ? (cell.confirmedYes === true ? "Yes" : cell.confirmedYes === false ? "No" : "—") : undefined;
      const usesUnembeddableFont = Boolean(style.fontFamily && style.fontFamily.toLowerCase().includes("signature"));
      const cellHeightKey = !cell.imageUrl && cell.text ? `richcell:${r}:${c}` : undefined;
      const richCellKey = cellHeightKey && (isMixedFormatting || usesUnembeddableFont) ? cellHeightKey : undefined;
      const richCellRendered = richCellKey ? richCellRenderCache[richCellKey] : undefined;
      // A rowSpan cell needs the SUM of every row it spans for its minimum height, or a merged
      // cell prints far shorter than it actually looks in the editor. Grown further still if this
      // cell's own real (browser-measured) natural height needed more room than that — a rich cell
      // rendered as an image (renderSpecsCellRunsToDataUrl's own comment), or a plain one that
      // simply wraps to more lines than the row's stored height was ever sized for
      // (measureSpecsCellNaturalHeightPx's own comment) — autoTable grows the WHOLE row to match
      // automatically once any one of its cells asks for more via minCellHeight below, so nothing
      // else here needs to know this happened.
      let spannedHeightPx = 0;
      for (let idx = r; idx < r + rowSpan && idx < grid.rows.length; idx += 1) {
        spannedHeightPx += rowHeights[idx];
      }
      const naturalHeightPx = cellHeightKey ? cellNaturalHeightCache[cellHeightKey] : undefined;
      if (naturalHeightPx) spannedHeightPx = Math.max(spannedHeightPx, naturalHeightPx);
      const targetHeightPt = spannedHeightPx * PX_TO_PT * scale;
      // Falls back to the editor's own on-screen default cell font size (converted the same
      // px->pt way as an explicit style.fontSize would be), not an unrelated fixed pt value —
      // otherwise every cell that never had its font size manually changed prints at a different
      // size than what the Specifications window actually shows for it.
      const requestedFontSizePt = (style.fontSize ?? DEFAULT_CELL_FONT_SIZE_PX) * PX_TO_PT * scale;
      // Matches SpecsCellTextArea's own `py-0.5` (2px, not 4 — Tailwind's spacing scale is
      // quarter-rem steps, so `0.5` is 2px, half of what a bare "4" here silently assumed, and
      // that "4" was never itself px->pt converted either). Previously overstating the padding by
      // roughly 3x meant this shrank text far more than the on-screen row actually needed to —
      // exactly why a normal-sized default cell could come out visibly smaller in the PDF than it
      // ever looked in the editor, worse the shorter a row got (e.g. the 20px default row height).
      const basePaddingPt = 2 * PX_TO_PT * scale;
      // jspdf-autotable's own cellPadding/fontSize table defaults are a FLOOR on a row's height,
      // not a cap — a compact row that renders fine on screen (where the editor genuinely clips
      // content to the configured height, per the earlier row-height fix) would otherwise get
      // forced taller here to fit the default padding + font's line height, printing noticeably
      // larger than the on-screen preview. Shrink padding first (down to a small minimum), then
      // font size, so short rows print at roughly their real size instead of inflating — the PDF
      // equivalent of the editor's own "clip, don't grow" behavior.
      const cellPaddingPt = Math.max(0.5, Math.min(basePaddingPt, targetHeightPt * 0.25));
      const availableForTextPt = Math.max(1, targetHeightPt - cellPaddingPt * 2);
      const fontSizePt = cell.imageUrl ? requestedFontSizePt : Math.min(requestedFontSizePt, availableForTextPt / SPECS_PDF_LINE_HEIGHT_FACTOR);
      const cellStyles: Record<string, unknown> = {
        fontSize: fontSizePt,
        cellPadding: cellPaddingPt,
        halign: style.align ?? "left",
        valign: style.verticalAlign ?? "top",
      };
      if (!isMixedFormatting && runs[0]?.bold) cellStyles.fontStyle = "bold";
      cellStyles.font = resolvePdfFontFamily(style.fontFamily);
      if (style.bgColor) cellStyles.fillColor = style.bgColor;
      if (style.textColor) cellStyles.textColor = style.textColor;
      if (isConfirmable) {
        cellStyles.halign = "center";
        cellStyles.fontStyle = "bold";
        if (cell.confirmedYes === true) {
          // A solid, saturated fill (not a soft tint) with plain black text on top — reads clearly
          // at a glance on a printed page, where a light tint against white paper is much harder
          // to distinguish than it is on a backlit screen.
          cellStyles.fillColor = "#86EFAC";
          cellStyles.textColor = "#000000";
        } else if (cell.confirmedYes === false) {
          cellStyles.fillColor = "#FCA5A5";
          cellStyles.textColor = "#000000";
        } else {
          cellStyles.fillColor = "#FBFBFD";
          cellStyles.textColor = "#6E6E73";
        }
      }
      cellStyles.minCellHeight = targetHeightPt;
      const borderWidthPt = (style.borderWidthPx ?? DEFAULT_BORDER_WIDTH_PX) * PX_TO_PT * scale;
      cellStyles.lineWidth = {
        top: style.borderTop ? borderWidthPt : 0,
        right: style.borderRight ? borderWidthPt : 0,
        bottom: style.borderBottom ? borderWidthPt : 0,
        left: style.borderLeft ? borderWidthPt : 0,
      };
      if (style.borderColor && (style.borderTop || style.borderRight || style.borderBottom || style.borderLeft)) {
        cellStyles.lineColor = style.borderColor;
      }
      // richCellKey only actually gets used as the AutoTableCell's own imageUrl once its render
      // succeeded (richCellRendered) — a FAILED render (renderSpecsCellRunsToDataUrl's own null
      // case) falls back to plain vector content instead of a blank cell, same as any other cell.
      const imageUrl = cell.imageUrl || (richCellRendered ? richCellKey : undefined);
      rowArr.push({
        // An image (a real one, or a rendered-text one from richCellKey) replaces the cell's
        // visible text entirely (matching the editor), drawn on top in didDrawCell below once
        // autoTable has placed this cell's box.
        content: imageUrl ? "" : confirmLabel ?? cell.text,
        ...(imageUrl && richCellRendered
          // A rich-cell image already has its own text alignment/padding baked in (the offscreen
          // capture used the exact same style.align/textAlign, matching the on-screen cell) — fit-
          // centering it like a logo on TOP of that would shift already-aligned text again, off of
          // where it actually sits within the image. didDrawCell instead stretches this one to
          // fill the cell's own box exactly, at (0,0), with no fit/align math at all.
          ? { imageUrl, isRichCellImage: true }
          : imageUrl
            ? { imageUrl, imageAlign: style.align, imageVerticalAlign: style.verticalAlign }
            : {}),
        ...(!imageUrl && !isMixedFormatting && runs[0]?.underline ? { underline: true } : {}),
        ...(rowSpan > 1 ? { rowSpan } : {}),
        ...(colSpan > 1 ? { colSpan } : {}),
        styles: cellStyles,
      });
    }
    body.push(rowArr);
    bodyRowGridIndex.push(r);
  }

  // jspdf-autotable's own fitContent() (node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.js)
  // only floors a row's height to the active rowSpan's share when that row has at least one cell —
  // its per-column loop does `if (!cell) continue`, skipping the floor entirely for a row. A rowSpan
  // cell that also spans the full row width leaves every row it covers with zero cells (nothing else
  // occupies them), so those rows never get floored and collapse toward zero height, letting the next
  // row's content start too early and overlap the still-tall spanning cell above it — this is the
  // source of the text-overlap-in-print bug. Our minCellHeight on the spanning cell already holds its
  // FULL required height (undivided — the library divides by rowSpan itself), so instead of fighting
  // the library's per-row floor, collapse any such cell down to a single un-spanned row: same total
  // height, same column width, no covered rows left for the bug to bite.
  for (let i = 0; i < body.length; i += 1) {
    const rowArr = body[i];
    const soleCell = rowArr.length === 1 ? rowArr[0] : undefined;
    const span = soleCell?.rowSpan ?? 1;
    if (!soleCell || span <= 1) continue;
    let allCoveredRowsEmpty = true;
    for (let k = 1; k < span && i + k < body.length; k += 1) {
      if (body[i + k].length !== 0) {
        allCoveredRowsEmpty = false;
        break;
      }
    }
    if (!allCoveredRowsEmpty) continue;
    soleCell.rowSpan = 1;
    body.splice(i + 1, span - 1);
    bodyRowGridIndex.splice(i + 1, span - 1);
  }

  // anchorFirstPageBottom — if the content strictly before the earliest anchored group, PLUS that
  // group and everything after it, together still fit within one physical page, a blank spacer row
  // is inserted right before it sized to close exactly that gap, so it (and anything trailing it)
  // lands flush against the bottom of page 1 instead of wherever it would have naturally fallen
  // right after the preceding content. If the combined height already exceeds a page, no spacer is
  // inserted at all — the group just flows onto whichever page autoTable's own pagination naturally
  // puts it on, same as any other content. Computed here (using `body`'s own finalized per-row
  // heights, after natural-content growth and the rowSpan collapse above have both already settled
  // every row's real height) rather than from raw stored row heights up front, which badly
  // underestimated any row containing wrapped/rich text and threw the spacer size off.
  if (anchoredGroups.length > 0) {
    const pageHeightPt = doc.internal.pageSize.getHeight();
    const usableHeightPt = pageHeightPt - marginPt * 2;
    const bodyRowHeightPt = body.map((rowArr) =>
      rowArr.reduce((max, c) => {
        const h = c.styles?.minCellHeight;
        return typeof h === "number" && h > max ? h : max;
      }, 0),
    );
    let anchorBodyIndex = bodyRowGridIndex.findIndex((gridRow) => gridRow >= anchorStartRow);
    if (anchorBodyIndex === -1) anchorBodyIndex = body.length;
    const heightBeforeAnchorPt = bodyRowHeightPt.slice(0, anchorBodyIndex).reduce((sum, h) => sum + h, 0);
    const heightFromAnchorPt = bodyRowHeightPt.slice(anchorBodyIndex).reduce((sum, h) => sum + h, 0);
    const requiredSpacerPt = usableHeightPt - heightBeforeAnchorPt - heightFromAnchorPt;
    if (requiredSpacerPt > 0.01) {
      body.splice(anchorBodyIndex, 0, [
        {
          content: "",
          colSpan: grid.columnWidths.length,
          styles: { minCellHeight: requiredSpacerPt, cellPadding: 0, lineWidth: 0 },
        },
      ]);
    }
  }

  const columnStyles: Record<number, { cellWidth: number }> = {};
  columnWidths.forEach((w, idx) => {
    columnStyles[idx] = { cellWidth: w * PX_TO_PT * scale };
  });

  autoTable(doc, {
    body,
    theme: "plain",
    startY: marginPt,
    margin: { left: marginPt, right: marginPt, top: marginPt, bottom: marginPt },
    styles: { fontSize: DEFAULT_CELL_FONT_SIZE_PX * PX_TO_PT * scale, cellPadding: 4 * scale, overflow: "linebreak", valign: "middle", lineWidth: 0 },
    columnStyles,
    didDrawCell: (data) => {
      const raw = data.cell.raw as AutoTableCell | undefined;
      const imageUrl = raw?.imageUrl;
      const dataUrl = imageUrl ? imageDataUrlCache[imageUrl] : undefined;
      if (dataUrl && dataUrl.startsWith("data:")) {
        try {
          if (raw?.isRichCellImage) {
            // This image WAS the cell — captured at the exact same width text wraps to on screen
            // (the column's own width), so scaling it to data.cell.width is lossless; height comes
            // along for the ride at whatever THAT scale factor implies, preserving the image's own
            // proportions instead of independently stretching height to data.cell.height too (which
            // squashed/stretched it whenever autoTable's own final row height came out even slightly
            // off from what this image was actually captured at). Anchored at the cell's own
            // top-left, matching where the on-screen cell's own padding starts text from — the
            // fit-CENTERED math in the else branch below (built for a logo that's free to be
            // smaller than its cell and wants centering) would otherwise re-offset already-aligned
            // text a second time on top of its own baked-in alignment.
            const props = doc.getImageProperties(dataUrl);
            const drawWidth = data.cell.width;
            const drawHeight = props.width > 0 ? drawWidth * (props.height / props.width) : data.cell.height;
            doc.addImage(dataUrl, "PNG", data.cell.x, data.cell.y, drawWidth, drawHeight);
          } else {
            const props = doc.getImageProperties(dataUrl);
            const fitScale = Math.min(data.cell.width / props.width, data.cell.height / props.height);
            const drawWidth = props.width * fitScale;
            const drawHeight = props.height * fitScale;
            // Matches imageObjectPositionFor's on-screen defaults: unset -> centered, since that
            // reads best for a logo placed in a cell larger than it needs.
            const extraX = data.cell.width - drawWidth;
            const extraY = data.cell.height - drawHeight;
            const x = data.cell.x + (raw?.imageAlign === "left" ? 0 : raw?.imageAlign === "right" ? extraX : extraX / 2);
            const y = data.cell.y + (raw?.imageVerticalAlign === "top" ? 0 : raw?.imageVerticalAlign === "bottom" ? extraY : extraY / 2);
            doc.addImage(dataUrl, props.fileType, x, y, drawWidth, drawHeight);
          }
        } catch {
          // Malformed/unsupported image data — leave the cell blank rather than failing the export.
        }
        return;
      }
      // jsPDF has no built-in underline — autoTable draws the text itself internally, so this
      // re-measures each of ITS OWN already-wrapped lines (data.cell.text, populated by autoTable's
      // own word-wrap before this hook runs) with the exact font it drew them in, and draws a plain
      // line under each one. Vertical placement mirrors autoTable's own valign block-centering math
      // (top/middle/bottom against the cell's actual rendered height) closely enough to sit right
      // under the text it's tracking, without hooking into autoTable's private layout internals.
      if (!raw?.underline || !Array.isArray(data.cell.text) || data.cell.text.length === 0) return;
      const cellStyles = (raw.styles ?? {}) as Record<string, unknown>;
      const fontSizePt = typeof cellStyles.fontSize === "number" ? cellStyles.fontSize : DEFAULT_CELL_FONT_SIZE_PX * PX_TO_PT * scale;
      const paddingPt = typeof cellStyles.cellPadding === "number" ? cellStyles.cellPadding : 4 * scale;
      const halign = (cellStyles.halign as string) ?? "left";
      const valign = (cellStyles.valign as string) ?? "top";
      doc.setFontSize(fontSizePt);
      doc.setFont(typeof cellStyles.font === "string" ? cellStyles.font : "helvetica", cellStyles.fontStyle === "bold" ? "bold" : "normal");
      if (cellStyles.textColor) doc.setDrawColor(cellStyles.textColor as string);
      else doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(Math.max(0.4, fontSizePt * 0.04));
      // jsPDF's own approximate ratio between a font's size and the line-height it actually needs —
      // same constant the layout pass above uses, so these lines land at the same spacing autoTable
      // itself used when it wrapped and placed this same text.
      const lineHeightPt = fontSizePt * 1.15;
      const textBlockHeightPt = data.cell.text.length * lineHeightPt;
      let cursorY =
        valign === "middle"
          ? data.cell.y + (data.cell.height - textBlockHeightPt) / 2
          : valign === "bottom"
            ? data.cell.y + data.cell.height - textBlockHeightPt - paddingPt
            : data.cell.y + paddingPt;
      for (const line of data.cell.text) {
        const textWidthPt = doc.getTextWidth(line);
        const underlineY = cursorY + lineHeightPt * 0.85;
        const x =
          halign === "center"
            ? data.cell.x + (data.cell.width - textWidthPt) / 2
            : halign === "right"
              ? data.cell.x + data.cell.width - paddingPt - textWidthPt
              : data.cell.x + paddingPt;
        doc.line(x, underlineY, x + textWidthPt, underlineY);
        cursorY += lineHeightPt;
      }
    },
  });

  return doc.output("blob");
}

export function openPdfBlobInPrintWindow(pdfBlob: Blob) {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(pdfBlob);
  const printWindow = window.open(url, "_blank");
  if (printWindow) {
    const triggerPrint = () => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch {
        // no-op
      }
    };
    printWindow.addEventListener("load", triggerPrint, { once: true });
    window.setTimeout(triggerPrint, 500);
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120000);
}
