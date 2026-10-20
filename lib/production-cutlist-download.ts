"use client";

// The sidebar's Downloads › Production Cutlist: the company's blank production workbook (lib/cutlist-template.ts),
// built from its settings as they are now — part types, hardware (drawer types and heights, hinges, other items), board
// options, staff, rooms, contractors and logo — and saved as "<Company> - Production.xlsx".

import { activeDate } from "@/lib/company-formats";
import { buildCutlistTemplateWorkbook, type CutlistTemplatePartKind } from "@/lib/cutlist-template";
import { fetchCompanyDoc, fetchCompanyMembers } from "@/lib/firestore-data";
import { normalizeBoardFinishes, normalizeHardwareRows, normalizeMmOptions, normalizeSheetSizes } from "@/lib/production-hardware";
import { resolveProjectImageDataUrl } from "@/lib/project-image-data";

const toStr = (value: unknown) => String(value ?? "").trim();

// A part type's kind, as the Production tab reads it (its category, or its own flags).
function partTypeKind(item: Record<string, unknown>): CutlistTemplatePartKind {
  const category = toStr(item.category ?? item.kind ?? item.type).toLowerCase();
  const flag = (...keys: string[]) => keys.some((key) => Boolean(item[key]));
  if (category === "cabinetry" || flag("cabinetry", "isCabinetry", "cabinetryEnabled", "enableCabinetry", "partTypeCabinetry")) return "Cabinetry";
  if (category === "drawer" || flag("drawer", "isDrawer", "drawerEnabled", "enableDrawer", "partTypeDrawer")) return "Drawer";
  if (category === "door" || flag("door", "isDoor")) return "Door";
  return "";
}

// The company's logo, redrawn as a PNG (Excel takes PNG / JPEG / GIF only) — null if there's none or it won't load.
async function companyLogoPng(companyDoc: Record<string, unknown>): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const theme = companyDoc.theme as Record<string, unknown> | undefined;
  const path = toStr(companyDoc.logoPath ?? companyDoc.logoUrl ?? theme?.logoPath ?? "");
  const source = path ? await resolveProjectImageDataUrl(path).catch(() => "") : "";
  if (!source) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const width = Math.max(1, img.naturalWidth || 1);
        const height = Math.max(1, img.naturalHeight || 1);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
        resolve({ dataUrl: canvas.toDataURL("image/png"), width, height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = source;
  });
}

export async function downloadProductionCutlistTemplate(companyId: string): Promise<void> {
  const [rawDoc, members] = await Promise.all([fetchCompanyDoc(companyId), fetchCompanyMembers(companyId)]);
  const companyDoc = (rawDoc ?? {}) as Record<string, unknown>;
  const companyName = toStr(companyDoc.companyName ?? companyDoc.name ?? "");

  const partTypeRows = (Array.isArray(companyDoc.partTypes) ? companyDoc.partTypes : []).filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
  );
  // (Each with its colour, as it is now — its rows' colour in the rooms.)
  const partTypes = partTypeRows.length
    ? partTypeRows.map((row) => ({ name: toStr(row.name), kind: partTypeKind(row), color: toStr(row.color ?? row.colour) })).filter((row) => row.name)
    : ["Cabinet", "Drawer", "Panel", "Front"].map((name) => ({ name, kind: "" as CutlistTemplatePartKind }));

  const hardwareRows = normalizeHardwareRows(companyDoc.hardwareSettings);
  const defaultHardware = hardwareRows.find((row) => row.isDefault) ?? hardwareRows[0];
  const defaultDrawer = defaultHardware?.drawers.find((row) => row.isDefault) ?? defaultHardware?.drawers[0];
  const sheetSizes = normalizeSheetSizes(companyDoc.sheetSizes);
  const defaultSheet = sheetSizes.find((row) => row.isDefault) ?? sheetSizes[0];
  const contractors = (Array.isArray(companyDoc.contractors) ? companyDoc.contractors : []).map(toStr).filter(Boolean);

  const blob = await buildCutlistTemplateWorkbook({
    companyName,
    downloadedOn: activeDate(new Date()),
    logo: await companyLogoPng(companyDoc),
    roomCount: 5,
    staff: Array.from(new Set(members.map((member) => toStr(member.displayName)).filter(Boolean))),
    roomNames: Array.from(new Set((Array.isArray(companyDoc.roomNames) ? companyDoc.roomNames : []).map(toStr).filter(Boolean))),
    thicknesses: normalizeMmOptions(companyDoc.boardThicknesses),
    finishes: normalizeBoardFinishes(companyDoc.boardFinishes),
    sheetSizes: sheetSizes.map((row) => `${row.h} x ${row.w}`),
    defaultSheetSize: defaultSheet ? `${defaultSheet.h} x ${defaultSheet.w}` : "",
    partTypes,
    hardware: hardwareRows.map((hardware) => ({
      name: hardware.name,
      drawers: hardware.drawers.map((drawer) => {
        const sizeByToken = new Map(drawer.heightOptions.map((opt) => [toStr(opt.token).toLowerCase(), toStr(opt.value)]));
        const letters = (drawer.heightLetters.length ? drawer.heightLetters : drawer.heightOptions.map((opt) => opt.token)).map(toStr).filter(Boolean);
        return { name: drawer.name, heights: letters.map((letter) => ({ letter, size: sizeByToken.get(letter.toLowerCase()) ?? "" })) };
      }),
      hinges: hardware.hinges,
      other: hardware.other,
    })),
    defaultHardware: defaultHardware?.name ?? "",
    defaultDrawer: defaultDrawer?.name ?? "",
    // (Contractor notes' boxes: the company's, and the catch-all Other, as a project's Contractors has them.)
    contractors: [...contractors, "Other"],
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(companyName || "CutSmart").replace(/[\\/:*?"<>|]+/g, " ").trim()} - Production.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}
