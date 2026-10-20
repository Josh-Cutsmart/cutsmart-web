// A project's cutlist (Production or Initial measure) as a PDF laid out like its on-screen cutlist list — for a deleted
// project's emailed copy (lib/project-email-copy.ts), built from just its stored rows (cutlistData/{kind}), without the
// project page:
// - a section for each part type (in the company's part type order), in its colour: a tab with its name and how many
//   parts, then its rows, each washed in a lighter shade of it — as the list shows them;
// - each row's room, board (its sheet size chip, then its name), part name, sizes (in the company's unit), quantity,
//   clashing, information and grain — the grain's dimension bold and underlined, and its side (H / W / D) a blue pill,
//   as the list's grain toggle shows it. Depth only where a section has any.
// jsPDF and jspdf-autotable are only loaded when one's made.

export type CutlistPdfBoard = { label: string; size: string; grain: boolean };

export type CutlistPdfInput = {
  // "Production cutlist" / "Initial measure cutlist".
  title: string;
  projectName: string;
  // Under the title: the client, and when it was made.
  subtitle: string;
  companyName: string;
  rows: unknown[];
  // Part type name → its colour, and the company's order (Company Settings › Production › Part types).
  partTypeColors: Record<string, string>;
  partTypeOrder: string[];
  // The project's boards (its Board settings), by the key a row keeps ("<label> @@ <sheet>") and by label.
  boards: Record<string, CutlistPdfBoard>;
  // A stored length (mm) as the company shows it, and the unit's label for the column headers.
  formatLength: (value: string) => string;
  unitLabel: string;
};

type Part = {
  room: string;
  partType: string;
  name: string;
  height: string;
  width: string;
  depth: string;
  quantity: string;
  board: string;
  clashing: string;
  information: string;
  grain: string;
};

type Rgb = [number, number, number];

const pick = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
};

function partsFrom(rows: unknown[]): Part[] {
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      room: pick(row, "Room", "room"),
      partType: pick(row, "partType", "PartType", "Part Type", "part_type") || "Unassigned",
      name: pick(row, "Name", "name"),
      height: pick(row, "Height", "height"),
      width: pick(row, "Width", "width"),
      depth: pick(row, "Depth", "depth"),
      quantity: pick(row, "Quantity", "quantity", "Qty", "qty"),
      board: pick(row, "Board", "board"),
      clashing: pick(row, "Clashing", "clashing") || [pick(row, "clashLeft"), pick(row, "clashRight")].filter(Boolean).join(" "),
      information: pick(row, "Information", "information"),
      grain: pick(row, "Grain", "grain", "grainValue"),
    }))
    .filter((part) => part.name || part.height || part.width);
}

const hexToRgb = (hex: string): Rgb | null => {
  const match = String(hex || "").trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!match) return null;
  const value = match[1].length === 3 ? match[1].split("").map((c) => c + c).join("") : match[1];
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
};
// The list's shades of a part type's colour: towards white (keep: how much of the colour stays), or darker.
const tint = (rgb: Rgb, keep: number): Rgb => rgb.map((channel) => Math.round(255 - (255 - channel) * keep)) as Rgb;
const shade = (rgb: Rgb, keep: number): Rgb => rgb.map((channel) => Math.round(channel * keep)) as Rgb;
const isLight = (rgb: Rgb) => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.6;
const BLACK: Rgb = [17, 17, 17];
const WHITE: Rgb = [255, 255, 255];
const GRAIN_BLUE: Rgb = [37, 99, 235];
const FALLBACK_COLOUR: Rgb = [203, 213, 225];

// A row's board: the project's own settings for it (by its key, or its label) — else what the row says ("<label> @@
// <sheet>": the label, and the sheet's length in metres as its size).
function boardOf(raw: string, boards: Record<string, CutlistPdfBoard>): CutlistPdfBoard {
  const known = boards[raw] ?? boards[raw.split(" @@ ")[0].trim()];
  if (known) return known;
  const [label, sheet = ""] = raw.split(" @@ ").map((part) => part.trim());
  const mm = Number.parseFloat(sheet.split("x")[0] || "");
  return { label, size: Number.isFinite(mm) && mm > 0 ? (Math.floor(mm / 100) / 10).toFixed(1).replace(/\.0$/, "") : "", grain: false };
}

// Which dimension a row's grain runs along — "H:716" style, or a number matching one of its sizes; with grain but no
// side picked, its first size (as the list's toggle shows it).
function grainAxis(part: Part): "height" | "width" | "depth" | null {
  const grain = part.grain.trim();
  if (!grain) return null;
  const prefixed = grain.match(/^([HWD])\s*:/i);
  if (prefixed) return prefixed[1].toUpperCase() === "H" ? "height" : prefixed[1].toUpperCase() === "W" ? "width" : "depth";
  const value = Number.parseFloat(grain);
  if (Number.isFinite(value)) {
    for (const key of ["height", "width", "depth"] as const) {
      const size = Number.parseFloat(part[key]);
      if (Number.isFinite(size) && Math.abs(size - value) < 0.001) return key;
    }
  }
  return part.height ? "height" : part.width ? "width" : part.depth ? "depth" : null;
}

export async function buildCutlistPdfBlob(input: CutlistPdfInput): Promise<Blob | null> {
  const parts = partsFrom(input.rows);
  if (!parts.length) return null;
  const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableModule.default;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 28;
  const tableWidth = pageWidth - margin * 2;
  const unit = input.unitLabel ? ` (${input.unitLabel})` : "";

  // By part type: the company's order first, then any others as they come.
  const orderOf = (type: string) => {
    const index = input.partTypeOrder.findIndex((name) => name.toLowerCase() === type.toLowerCase());
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const sections: Array<{ type: string; parts: Part[] }> = [];
  for (const part of parts) {
    const section = sections.find((item) => item.type.toLowerCase() === part.partType.toLowerCase());
    if (section) section.parts.push(part);
    else sections.push({ type: part.partType, parts: [part] });
  }
  sections.sort((a, b) => orderOf(a.type) - orderOf(b.type));

  // The header: what this is and for which project, the company, the client and date — then the list's own heading.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BLACK);
  doc.text(`${input.title.toUpperCase()}  |  ${(input.projectName || "Project").toUpperCase()}`, margin, margin + 6);
  if (input.companyName) doc.text(input.companyName, pageWidth - margin, margin + 6, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  if (input.subtitle) doc.text(input.subtitle, margin, margin + 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...BLACK);
  doc.text("CUTLIST LIST", margin, margin + 44);
  const countLabel = `${parts.length} Part${parts.length === 1 ? "" : "s"}`;
  const listLabelW = doc.getTextWidth("CUTLIST LIST");
  doc.setFontSize(8);
  const countW = doc.getTextWidth(countLabel) + 12;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.6);
  doc.roundedRect(margin + listLabelW + 8, margin + 35.5, countW, 12, 6, 6, "S");
  doc.text(countLabel, margin + listLabelW + 14, margin + 44);
  let y = margin + 58;

  for (const section of sections) {
    const colour = hexToRgb(input.partTypeColors[section.type] ?? "") ?? FALLBACK_COLOUR;
    const headerFill = tint(colour, 0.69);
    const rowFill = tint(colour, 0.66);
    const rowText = isLight(rowFill) ? BLACK : WHITE;
    const chipFill = shade(colour, 0.85);
    const headerH = 30;
    // Its tab and at least a couple of rows together.
    if (y + headerH + 50 > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    const sectionTop = y;
    const startPage = doc.getNumberOfPages();

    // Its tab: a full-colour block with its name, then how many parts — on the lighter header strip.
    doc.setFillColor(...headerFill);
    doc.roundedRect(margin, y, tableWidth, headerH, 9, 9, "F");
    doc.rect(margin, y + 9, tableWidth, headerH - 9, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(15);
    const nameW = doc.getTextWidth(section.type) + 20;
    doc.setFillColor(...colour);
    doc.roundedRect(margin, y, nameW, headerH, 9, 9, "F");
    doc.rect(margin + 9, y, nameW - 9, headerH, "F");
    doc.rect(margin, y + 9, nameW, headerH - 9, "F");
    doc.setTextColor(...(isLight(colour) ? BLACK : WHITE));
    doc.text(section.type, margin + 10, y + 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...(isLight(headerFill) ? BLACK : WHITE));
    doc.text(`${section.parts.length} Part${section.parts.length === 1 ? "" : "s"}`, margin + nameW + 8, y + 18.5);
    doc.setDrawColor(...colour);
    doc.setLineWidth(1);
    doc.line(margin, y + headerH, margin + tableWidth, y + headerH);
    y += headerH;

    // Its columns — Depth only if any of its parts has one.
    const showDepth = section.parts.some((part) => part.depth);
    const showGrain = section.parts.some((part) => part.grain);
    const columns: Array<{ key: keyof Part | "grainSide"; header: string; width?: number; align: "left" | "center" }> = [
      { key: "room", header: "Room", width: 78, align: "left" },
      { key: "board", header: "Board", width: 170, align: "left" },
      { key: "name", header: "Part Name", align: "left" },
      { key: "height", header: `Height${unit}`, width: 58, align: "center" },
      { key: "width", header: `Width${unit}`, width: 58, align: "center" },
      ...(showDepth ? [{ key: "depth" as const, header: `Depth${unit}`, width: 58, align: "center" as const }] : []),
      { key: "quantity", header: "Quantity", width: 50, align: "center" },
      { key: "clashing", header: "Clashing", width: 56, align: "center" },
      { key: "information", header: "Information", width: 120, align: "left" },
      ...(showGrain ? [{ key: "grainSide" as const, header: "Grain", width: 40, align: "center" as const }] : []),
    ];
    const boardColumn = columns.findIndex((column) => column.key === "board");
    const grainColumn = columns.findIndex((column) => column.key === "grainSide");
    const sizeColumns: Record<string, "height" | "width" | "depth"> = {};
    columns.forEach((column, index) => {
      if (column.key === "height" || column.key === "width" || column.key === "depth") sizeColumns[index] = column.key;
    });
    const boards = section.parts.map((part) => boardOf(part.board, input.boards));
    // Grain shows on a grained board (or a row that has it, when its board isn't known).
    const axes = section.parts.map((part, index) => (boards[index].grain || (part.grain && !input.boards[part.board]) ? grainAxis(part) : null));
    const body = section.parts.map((part, index) =>
      columns.map((column) => {
        if (column.key === "grainSide") return "";
        if (column.key === "board") return boards[index].label || part.board;
        const value = part[column.key];
        return (column.key === "height" || column.key === "width" || column.key === "depth") && value ? input.formatLength(value) : value;
      }),
    );
    const chipW = 20;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, top: margin, bottom: margin + 12 },
      tableWidth,
      head: [columns.map((column) => column.header)],
      body,
      theme: "plain",
      showHead: "everyPage",
      styles: { font: "helvetica", fontSize: 8, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 }, textColor: rowText, fillColor: rowFill, valign: "middle", overflow: "linebreak" },
      headStyles: { fontStyle: "bold", fontSize: 8, fillColor: rowFill, textColor: rowText },
      columnStyles: Object.fromEntries(
        columns.map((column, index) => [index, { halign: column.align, ...(column.width ? { cellWidth: column.width } : {}) }]),
      ),
      didParseCell: (data) => {
        if (data.section !== "body") return;
        // The last row's corners are rounded (willDrawCell) — its end cells leave theirs to that.
        if (data.row.index === data.table.body.length - 1 && (data.column.index === 0 || data.column.index === columns.length - 1)) {
          data.cell.styles.fillColor = false;
        }
        // Room for the board's size chip before its name.
        if (data.column.index === boardColumn && boards[data.row.index]?.size) {
          data.cell.styles.cellPadding = { top: 5, bottom: 5, left: 6 + chipW + 5, right: 6 };
        }
        // The grain's dimension: bold (and underlined, below).
        const sizeKey = sizeColumns[data.column.index];
        if (sizeKey && axes[data.row.index] === sizeKey) data.cell.styles.fontStyle = "bold";
      },
      willDrawCell: (data) => {
        // The last row's background, its bottom corners rounded as the section's outline.
        if (data.section !== "body" || data.row.index !== data.table.body.length - 1 || data.column.index !== 0) return;
        doc.setFillColor(...rowFill);
        doc.roundedRect(margin, data.cell.y, tableWidth, data.cell.height, 9, 9, "F");
        doc.rect(margin, data.cell.y, tableWidth, Math.max(0, data.cell.height - 9), "F");
      },
      didDrawCell: (data) => {
        // A thin line between rows, a shade of the colour — once the row's last cell is drawn, so none of its cells covers it.
        if (data.section === "body" && data.column.index === columns.length - 1 && data.row.index > 0) {
          doc.setDrawColor(...tint(colour, 0.85));
          doc.setLineWidth(0.5);
          doc.line(margin, data.cell.y, margin + tableWidth, data.cell.y);
        }
        if (data.section !== "body") return;
        const index = data.row.index;
        // The board's size chip.
        if (data.column.index === boardColumn && boards[index]?.size) {
          const chipH = 12;
          const chipX = data.cell.x + 6;
          const chipY = data.cell.y + data.cell.height / 2 - chipH / 2;
          doc.setFillColor(...chipFill);
          doc.roundedRect(chipX, chipY, chipW, chipH, 6, 6, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(6.5);
          doc.setTextColor(...(isLight(chipFill) ? BLACK : WHITE));
          doc.text(boards[index].size, chipX + chipW / 2, chipY + chipH / 2 + 2.3, { align: "center" });
        }
        // The grain's dimension underlined.
        const sizeKey = sizeColumns[data.column.index];
        if (sizeKey && axes[index] === sizeKey) {
          const text = String(data.cell.text.join(" ")).trim();
          if (text) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8);
            const textW = doc.getTextWidth(text);
            const centreX = data.cell.x + data.cell.width / 2;
            const lineY = data.cell.y + data.cell.height / 2 + 3.6;
            doc.setDrawColor(...rowText);
            doc.setLineWidth(0.6);
            doc.line(centreX - textW / 2, lineY, centreX + textW / 2, lineY);
          }
        }
        // The grain's side, as the list's toggle shows it picked: a blue pill.
        if (data.column.index === grainColumn && axes[index]) {
          const letter = axes[index] === "height" ? "H" : axes[index] === "width" ? "W" : "D";
          const pillW = 16;
          const pillH = 12;
          const pillX = data.cell.x + data.cell.width / 2 - pillW / 2;
          const pillY = data.cell.y + data.cell.height / 2 - pillH / 2;
          doc.setFillColor(...GRAIN_BLUE);
          doc.roundedRect(pillX, pillY, pillW, pillH, 6, 6, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(7);
          doc.setTextColor(...WHITE);
          doc.text(letter, pillX + pillW / 2, pillY + pillH / 2 + 2.4, { align: "center" });
        }
      },
    });
    const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y;
    // Its outline in its colour, rounded — when it's all on the one page.
    if (doc.getNumberOfPages() === startPage) {
      doc.setDrawColor(...colour);
      doc.setLineWidth(1);
      doc.roundedRect(margin, sectionTop, tableWidth, finalY - sectionTop, 9, 9, "S");
    }
    y = finalY + 14;
  }

  // Page numbers.
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`${input.projectName} — ${input.title}`, margin, pageHeight - 14);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 14, { align: "right" });
  }
  return doc.output("blob");
}
