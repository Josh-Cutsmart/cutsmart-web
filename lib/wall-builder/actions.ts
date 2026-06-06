import {
  buildCabinetBuilderWallPieces,
  getCabinetBuilderSelectedWallPiece,
  type CabinetBuilderAttachmentKind,
  type CabinetBuilderAttachmentDraft,
  type CabinetBuilderChildDraft,
  type CabinetBuilderDraft,
  type CabinetBuilderPanelHeightMode,
  type CabinetBuilderPanelSpanMode,
  type CutlistEntryDraft,
  type DoorModeValue,
  type CabinetBuilderWallPiece,
} from "@/lib/wall-builder/model";

export function setCabinetBuilderSelectedNewCabinetInDraft(
  draft: CabinetBuilderDraft,
  selectedWallId: string | null | undefined,
  value: boolean,
): CabinetBuilderDraft {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall || (!selectedWall.isMain && selectedWall.kind !== "cabinet")) return draft;
  if (selectedWall.isMain) {
    return { ...draft, newCabinet: value };
  }
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) =>
      attachment.id === selectedWall.id ? { ...attachment, newCabinet: value } : attachment,
    ),
  };
}

export function updateCabinetBuilderConfiguredRowInDraft(
  draft: CabinetBuilderDraft,
  selectedWallId: string | null | undefined,
  kind: "doorsRow" | "drawersRow",
  updater: (row: CutlistEntryDraft) => CutlistEntryDraft,
): CabinetBuilderDraft {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall) return draft;
  if (selectedWall.isMain) {
    if (!draft[kind]) return draft;
    return {
      ...draft,
      [kind]: updater(draft[kind] as CutlistEntryDraft),
    };
  }
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) => {
      if (attachment.id !== selectedWall.id || !attachment[kind]) return attachment;
      return {
        ...attachment,
        [kind]: updater(attachment[kind] as CutlistEntryDraft),
      };
    }),
  };
}

export function updateCabinetBuilderChildRowInDraft(
  draft: CabinetBuilderDraft,
  selectedWallId: string | null | undefined,
  childId: string,
  rowUpdater: (row: CutlistEntryDraft) => CutlistEntryDraft,
): CabinetBuilderDraft {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall || (!selectedWall.isMain && selectedWall.kind !== "cabinet")) return draft;
  const mapChildRows = (childRows: CabinetBuilderChildDraft[]) =>
    childRows.map((child) => (child.id === childId ? { ...child, row: rowUpdater(child.row) } : child));
  if (selectedWall.isMain) {
    return {
      ...draft,
      childRows: mapChildRows(draft.childRows),
    };
  }
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) =>
      attachment.id === selectedWall.id
        ? {
            ...attachment,
            childRows: mapChildRows(attachment.childRows ?? []),
          }
        : attachment,
    ),
  };
}

export function removeCabinetBuilderChildRowInDraft(
  draft: CabinetBuilderDraft,
  selectedWallId: string | null | undefined,
  childId: string,
): CabinetBuilderDraft {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall || (!selectedWall.isMain && selectedWall.kind !== "cabinet")) return draft;
  if (selectedWall.isMain) {
    return { ...draft, childRows: draft.childRows.filter((child) => child.id !== childId) };
  }
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) =>
      attachment.id === selectedWall.id
        ? { ...attachment, childRows: (attachment.childRows ?? []).filter((child) => child.id !== childId) }
        : attachment,
    ),
  };
}

export function updateCabinetBuilderAttachmentRowInDraft(
  draft: CabinetBuilderDraft,
  attachmentId: string,
  patch: Partial<CutlistEntryDraft>,
): CabinetBuilderDraft {
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) =>
      attachment.id === attachmentId
        ? {
            ...attachment,
            row: { ...attachment.row, ...patch },
            doorsRow: attachment.doorsRow
              ? {
                  ...attachment.doorsRow,
                  name: String(patch.name ?? attachment.doorsRow.name ?? attachment.row.name ?? ""),
                  height: String(patch.height ?? attachment.doorsRow.height ?? attachment.row.height ?? ""),
                  width: String(patch.width ?? attachment.doorsRow.width ?? attachment.row.width ?? ""),
                  board: String(patch.board ?? attachment.doorsRow.board ?? attachment.row.board ?? ""),
                }
              : attachment.doorsRow,
            drawersRow: attachment.drawersRow
              ? {
                  ...attachment.drawersRow,
                  name: String(patch.name ?? attachment.drawersRow.name ?? attachment.row.name ?? ""),
                  height: String(patch.height ?? attachment.drawersRow.height ?? attachment.row.height ?? ""),
                  width: String(patch.width ?? attachment.drawersRow.width ?? attachment.row.width ?? ""),
                  board: String(patch.board ?? attachment.drawersRow.board ?? attachment.row.board ?? ""),
                }
              : attachment.drawersRow,
          }
        : attachment,
    ),
  };
}

export function updateCabinetBuilderAttachmentMetaInDraft(
  draft: CabinetBuilderDraft,
  attachmentId: string,
  patch: Partial<Pick<CabinetBuilderAttachmentDraft, "panelHeightMode" | "panelSpanMode">>,
): CabinetBuilderDraft {
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) =>
      attachment.id === attachmentId
        ? {
            ...attachment,
            ...patch,
          }
        : attachment,
    ),
  };
}

export function updateCabinetBuilderChildRowByOwnerInDraft(
  draft: CabinetBuilderDraft,
  ownerId: string,
  childId: string,
  rowUpdater: (row: CutlistEntryDraft) => CutlistEntryDraft,
): CabinetBuilderDraft {
  const mapChildRows = (childRows: CabinetBuilderChildDraft[]) =>
    childRows.map((child) => (child.id === childId ? { ...child, row: rowUpdater(child.row) } : child));
  if (ownerId === "main") {
    return {
      ...draft,
      childRows: mapChildRows(draft.childRows),
    };
  }
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) =>
      attachment.id === ownerId
        ? {
            ...attachment,
            childRows: mapChildRows(attachment.childRows ?? []),
          }
        : attachment,
    ),
  };
}

export function updateCabinetBuilderConfiguredRowByOwnerInDraft(
  draft: CabinetBuilderDraft,
  ownerId: string,
  kind: "doorsRow" | "drawersRow",
  updater: (row: CutlistEntryDraft) => CutlistEntryDraft,
): CabinetBuilderDraft {
  if (ownerId === "main") {
    const existing = draft[kind];
    if (!existing) return draft;
    return { ...draft, [kind]: updater(existing) };
  }
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) => {
      if (attachment.id !== ownerId || !attachment[kind]) return attachment;
      return { ...attachment, [kind]: updater(attachment[kind] as CutlistEntryDraft) };
    }),
  };
}

export function ensureCabinetBuilderSelectedFrontsInDraft(
  draft: CabinetBuilderDraft,
  selectedWallId: string | null | undefined,
  createConfiguredCabinetFrontRow: (mode: "door" | "drawer", seed?: Partial<CutlistEntryDraft>) => CutlistEntryDraft,
): CabinetBuilderDraft {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall) return draft;
  if (selectedWall.doorsRow || selectedWall.drawersRow) return draft;
  const nextFrontRow = createConfiguredCabinetFrontRow("door", {
    name: selectedWall.row.name,
    height: selectedWall.row.height,
    width: selectedWall.row.width,
    board: selectedWall.row.board,
  });
  if (selectedWall.isMain) {
    return {
      ...draft,
      doorsRow: nextFrontRow,
      drawersRow: null,
    };
  }
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) =>
      attachment.id === selectedWall.id
        ? {
            ...attachment,
            doorsRow: nextFrontRow,
            drawersRow: null,
          }
        : attachment,
    ),
  };
}

export function setCabinetBuilderSelectedFrontModeInDraft(
  draft: CabinetBuilderDraft,
  selectedWallId: string | null | undefined,
  mode: DoorModeValue,
  normalizeDoorModeValue: (value: unknown) => DoorModeValue,
  createConfiguredCabinetFrontRow: (mode: "door" | "drawer", seed?: Partial<CutlistEntryDraft>) => CutlistEntryDraft,
): CabinetBuilderDraft {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall) return draft;
  const existingRow = selectedWall.doorsRow || selectedWall.drawersRow;
  if (!existingRow) return draft;
  const resolvedMode: "door" | "drawer" = mode === "drawer" ? "drawer" : "door";
  const targetKind = resolvedMode === "drawer" ? "drawersRow" : "doorsRow";
  const isModeChanging = normalizeDoorModeValue(existingRow.doorMode) !== resolvedMode;
  const nextRow = createConfiguredCabinetFrontRow(resolvedMode, {
    ...existingRow,
    board: existingRow.board,
    name: existingRow.name,
    height: existingRow.height,
    width: existingRow.width,
    clashLeft: existingRow.clashLeft,
    clashRight: existingRow.clashRight,
    quantity: existingRow.quantity,
    grainValue: existingRow.grainValue,
    grain: existingRow.grain,
    information: existingRow.information,
    doorTopGap: isModeChanging ? undefined : existingRow.doorTopGap,
    doorBetweenGap: isModeChanging ? undefined : existingRow.doorBetweenGap,
    doorSideLeftGap: isModeChanging ? undefined : existingRow.doorSideLeftGap,
    doorSideRightGap: isModeChanging ? undefined : existingRow.doorSideRightGap,
    doorFrontWidths: resolvedMode === "door" && !isModeChanging ? existingRow.doorFrontWidths : undefined,
    doorFrontWidthManual: resolvedMode === "door" && !isModeChanging ? existingRow.doorFrontWidthManual : undefined,
    doorFrontHeights: resolvedMode === "drawer" && !isModeChanging ? existingRow.doorFrontHeights : undefined,
    doorFrontHeightManual: resolvedMode === "drawer" && !isModeChanging ? existingRow.doorFrontHeightManual : undefined,
  });
  if (selectedWall.isMain) {
    return {
      ...draft,
      doorsRow: targetKind === "doorsRow" ? nextRow : null,
      drawersRow: targetKind === "drawersRow" ? nextRow : null,
    };
  }
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) =>
      attachment.id === selectedWall.id
        ? {
            ...attachment,
            doorsRow: targetKind === "doorsRow" ? nextRow : null,
            drawersRow: targetKind === "drawersRow" ? nextRow : null,
          }
        : attachment,
    ),
  };
}

export function addCabinetBuilderChildRowInDraft(args: {
  draft: CabinetBuilderDraft;
  selectedWallId: string | null | undefined;
  partType: string;
  carcassThicknessText: string;
  panelThicknessText: string;
  boardThicknessFor: (board: string) => number;
  isDoorPartType: (partType: string) => boolean;
  isDrawerPartType: (partType: string) => boolean;
  isPanelPartType: (partType: string) => boolean;
  createCabinetBuilderBaseRow: (partType: string, seed?: Partial<CutlistEntryDraft>) => CutlistEntryDraft;
  createConfiguredCabinetFrontRow: (mode: "door" | "drawer", seed?: Partial<CutlistEntryDraft>) => CutlistEntryDraft;
  numericDimensionText: (value: string) => string;
}): { draft: CabinetBuilderDraft; childId: string } {
  const {
    draft,
    selectedWallId,
    partType,
    carcassThicknessText,
    panelThicknessText,
    boardThicknessFor,
    isDoorPartType,
    isDrawerPartType,
    isPanelPartType,
    createCabinetBuilderBaseRow,
    createConfiguredCabinetFrontRow,
    numericDimensionText,
  } = args;
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall || (!selectedWall.isMain && selectedWall.kind !== "cabinet")) {
    return { draft, childId: "" };
  }
  const targetRow = selectedWall.row;
  const carcassThickness = Number.parseFloat(String(carcassThicknessText || "").replace(/[^\d.-]/g, "")) || 0;
  const selectedBoardThickness = boardThicknessFor(String(targetRow.board || "").trim()) || carcassThickness;
  const drawerWidthThickness = selectedWall.newCabinet ? selectedBoardThickness : carcassThickness;
  const cabinetWidth = Number.parseFloat(String(targetRow.width || "").replace(/[^\d.-]/g, "")) || 0;
  const cabinetDepth = Number.parseFloat(String(targetRow.depth || "").replace(/[^\d.-]/g, "")) || 0;
  const drawerWidth =
    cabinetWidth > 0 ? numericDimensionText(String(Math.max(0, cabinetWidth - drawerWidthThickness * 2))) : "";
  const drawerDepth =
    selectedWall.newCabinet && cabinetDepth > 0
      ? numericDimensionText(String(Math.max(0, cabinetDepth - selectedBoardThickness)))
      : "";
  const baseRow =
    isDrawerPartType(partType) && !isDoorPartType(partType)
      ? createCabinetBuilderBaseRow(partType, {
          name: targetRow.name,
          width: drawerWidth || targetRow.width,
          height: "",
          depth: drawerDepth,
          quantity: "1",
        } as Partial<CutlistEntryDraft>)
      : isDoorPartType(partType)
        ? createConfiguredCabinetFrontRow("door", {
            partType,
            name: targetRow.name,
            width: targetRow.width,
            height: targetRow.height,
            quantity: "1",
          } as Partial<CutlistEntryDraft>)
        : createCabinetBuilderBaseRow(partType, {
            name: targetRow.name,
            height: targetRow.height,
            width: isPanelPartType(partType)
              ? numericDimensionText(String(panelThicknessText || carcassThicknessText || "18"))
              : targetRow.width,
            depth: targetRow.depth,
          });
  const childId = `cab_child_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const nextChild = {
    id: childId,
    row: baseRow,
  };
  if (selectedWall.isMain) {
    return {
      draft: {
        ...draft,
        childRows: [...draft.childRows, nextChild],
      },
      childId,
    };
  }
  return {
    draft: {
      ...draft,
      attachments: draft.attachments.map((attachment) =>
        attachment.id === selectedWall.id
          ? { ...attachment, childRows: [...(attachment.childRows ?? []), nextChild] }
          : attachment,
      ),
    },
    childId,
  };
}

export function updateCabinetBuilderConfiguredFrontCountRow(
  row: CutlistEntryDraft,
  value: string,
  helpers: {
    normalizeDoorModeValue: (value: unknown) => DoorModeValue;
    normalizeDoorFrontCountValue: (value: unknown) => string;
    normalizeDoorFrontWidths: (value: unknown, count: number) => string[];
    normalizeDoorFrontWidthManual: (value: unknown, count: number) => boolean[];
    normalizeDoorFrontHeights: (value: unknown, count: number) => string[];
    normalizeDoorFrontHeightManual: (value: unknown, count: number) => boolean[];
    rebalanceDoorFrontWidths: (
      widths: string[],
      totalWidth: string,
      sideLeftGap: string,
      sideRightGap: string,
      betweenGap: string,
      manual: boolean[],
    ) => { widths: string[]; manual: boolean[] };
    rebalanceDoorFrontHeights: (
      heights: string[],
      totalHeight: string,
      topGap: string,
      betweenGap: string,
      manual: boolean[],
    ) => { heights: string[]; manual: boolean[] };
  },
): CutlistEntryDraft {
  const mode = helpers.normalizeDoorModeValue(row.doorMode) === "door" ? "door" : "drawer";
  const frontCount = helpers.normalizeDoorFrontCountValue(value) || "1";
  const count = Number.parseInt(frontCount, 10) || 1;
  const nextWidths =
    mode === "door"
      ? helpers.rebalanceDoorFrontWidths(
          helpers.normalizeDoorFrontWidths(row.doorFrontWidths, count),
          String(row.width ?? ""),
          String(row.doorSideLeftGap ?? ""),
          String(row.doorSideRightGap ?? ""),
          String(row.doorBetweenGap ?? ""),
          helpers.normalizeDoorFrontWidthManual(row.doorFrontWidthManual, count),
        )
      : { widths: [], manual: [] as boolean[] };
  const nextHeights =
    mode === "drawer"
      ? helpers.rebalanceDoorFrontHeights(
          helpers.normalizeDoorFrontHeights(row.doorFrontHeights, count),
          String(row.height ?? ""),
          String(row.doorTopGap ?? ""),
          String(row.doorBetweenGap ?? ""),
          helpers.normalizeDoorFrontHeightManual(row.doorFrontHeightManual, count),
        )
      : { heights: [], manual: [] as boolean[] };
  return {
    ...row,
    doorFrontCount: frontCount,
    doorFrontWidths: nextWidths.widths,
    doorFrontWidthManual: nextWidths.manual,
    doorFrontHeights: nextHeights.heights,
    doorFrontHeightManual: nextHeights.manual,
  };
}

export function updateCabinetBuilderConfiguredGapRow(
  row: CutlistEntryDraft,
  key: "doorTopGap" | "doorBetweenGap",
  value: string,
  helpers: {
    numericDecimalText: (value: string) => string;
    normalizeDoorModeValue: (value: unknown) => DoorModeValue;
    normalizeDoorFrontWidths: (value: unknown, count: number) => string[];
    normalizeDoorFrontWidthManual: (value: unknown, count: number) => boolean[];
    normalizeDoorFrontHeights: (value: unknown, count: number) => string[];
    normalizeDoorFrontHeightManual: (value: unknown, count: number) => boolean[];
    rebalanceDoorFrontWidths: (
      widths: string[],
      totalWidth: string,
      sideLeftGap: string,
      sideRightGap: string,
      betweenGap: string,
      manual: boolean[],
    ) => { widths: string[]; manual: boolean[] };
    rebalanceDoorFrontHeights: (
      heights: string[],
      totalHeight: string,
      topGap: string,
      betweenGap: string,
      manual: boolean[],
    ) => { heights: string[]; manual: boolean[] };
  },
): CutlistEntryDraft {
  const nextValue = helpers.numericDecimalText(value);
  const count = Number.parseInt(String(row.doorFrontCount || "1"), 10) || 1;
  const mode = helpers.normalizeDoorModeValue(row.doorMode) === "door" ? "door" : "drawer";
  const nextRow = { ...row, [key]: nextValue };
  return mode === "door"
    ? {
        ...nextRow,
        doorFrontWidths: helpers.rebalanceDoorFrontWidths(
          helpers.normalizeDoorFrontWidths(row.doorFrontWidths, count),
          String(row.width ?? ""),
          String(row.doorSideLeftGap ?? ""),
          String(row.doorSideRightGap ?? ""),
          key === "doorBetweenGap" ? nextValue : String(row.doorBetweenGap ?? ""),
          helpers.normalizeDoorFrontWidthManual(row.doorFrontWidthManual, count),
        ).widths,
      }
    : {
        ...nextRow,
        doorFrontHeights: helpers.rebalanceDoorFrontHeights(
          helpers.normalizeDoorFrontHeights(row.doorFrontHeights, count),
          String(row.height ?? ""),
          key === "doorTopGap" ? nextValue : String(row.doorTopGap ?? ""),
          key === "doorBetweenGap" ? nextValue : String(row.doorBetweenGap ?? ""),
          helpers.normalizeDoorFrontHeightManual(row.doorFrontHeightManual, count),
        ).heights,
      };
}

export function updateCabinetBuilderConfiguredFrontValueRow(
  row: CutlistEntryDraft,
  index: number,
  value: string,
  helpers: {
    normalizeDoorModeValue: (value: unknown) => DoorModeValue;
    normalizeDoorFrontWidths: (value: unknown, count: number) => string[];
    normalizeDoorFrontWidthManual: (value: unknown, count: number) => boolean[];
    normalizeDoorFrontHeights: (value: unknown, count: number) => string[];
    normalizeDoorFrontHeightManual: (value: unknown, count: number) => boolean[];
    numericDimensionText: (value: string) => string;
  },
): CutlistEntryDraft {
  const mode = helpers.normalizeDoorModeValue(row.doorMode) === "door" ? "door" : "drawer";
  const count = Number.parseInt(String(row.doorFrontCount || "1"), 10) || 1;
  if (mode === "door") {
    const widths = helpers.normalizeDoorFrontWidths(row.doorFrontWidths, count);
    const manual = helpers.normalizeDoorFrontWidthManual(row.doorFrontWidthManual, count);
    widths[index] = helpers.numericDimensionText(value);
    manual[index] = Boolean(String(value).trim());
    return { ...row, doorFrontWidths: widths, doorFrontWidthManual: manual };
  }
  const heights = helpers.normalizeDoorFrontHeights(row.doorFrontHeights, count);
  const manual = helpers.normalizeDoorFrontHeightManual(row.doorFrontHeightManual, count);
  heights[index] = helpers.numericDimensionText(value);
  manual[index] = Boolean(String(value).trim());
  return { ...row, doorFrontHeights: heights, doorFrontHeightManual: manual };
}

export function blurCabinetBuilderConfiguredFrontValueRow(
  row: CutlistEntryDraft,
  helpers: {
    normalizeDoorModeValue: (value: unknown) => DoorModeValue;
    normalizeDoorFrontWidths: (value: unknown, count: number) => string[];
    normalizeDoorFrontWidthManual: (value: unknown, count: number) => boolean[];
    normalizeDoorFrontHeights: (value: unknown, count: number) => string[];
    normalizeDoorFrontHeightManual: (value: unknown, count: number) => boolean[];
    rebalanceDoorFrontWidths: (
      widths: string[],
      totalWidth: string,
      sideLeftGap: string,
      sideRightGap: string,
      betweenGap: string,
      manual: boolean[],
    ) => { widths: string[]; manual: boolean[] };
    rebalanceDoorFrontHeights: (
      heights: string[],
      totalHeight: string,
      topGap: string,
      betweenGap: string,
      manual: boolean[],
    ) => { heights: string[]; manual: boolean[] };
  },
): CutlistEntryDraft {
  const mode = helpers.normalizeDoorModeValue(row.doorMode) === "door" ? "door" : "drawer";
  const count = Number.parseInt(String(row.doorFrontCount || "1"), 10) || 1;
  if (mode === "door") {
    const rebalanced = helpers.rebalanceDoorFrontWidths(
      helpers.normalizeDoorFrontWidths(row.doorFrontWidths, count),
      String(row.width ?? ""),
      String(row.doorSideLeftGap ?? ""),
      String(row.doorSideRightGap ?? ""),
      String(row.doorBetweenGap ?? ""),
      helpers.normalizeDoorFrontWidthManual(row.doorFrontWidthManual, count),
    );
    return { ...row, doorFrontWidths: rebalanced.widths, doorFrontWidthManual: rebalanced.manual };
  }
  const rebalanced = helpers.rebalanceDoorFrontHeights(
    helpers.normalizeDoorFrontHeights(row.doorFrontHeights, count),
    String(row.height ?? ""),
    String(row.doorTopGap ?? ""),
    String(row.doorBetweenGap ?? ""),
    helpers.normalizeDoorFrontHeightManual(row.doorFrontHeightManual, count),
  );
  return { ...row, doorFrontHeights: rebalanced.heights, doorFrontHeightManual: rebalanced.manual };
}

export function updateCabinetBuilderConfiguredSideRow(
  row: CutlistEntryDraft,
  key: "doorSideLeft" | "doorSideRight",
  value: "front" | "panel",
): CutlistEntryDraft {
  return { ...row, [key]: value };
}

export function updateCabinetBuilderConfiguredSideGapRow(
  row: CutlistEntryDraft,
  key: "doorSideLeftGap" | "doorSideRightGap",
  value: string,
  helpers: {
    numericDecimalText: (value: string) => string;
    normalizeDoorFrontWidths: (value: unknown, count: number) => string[];
    normalizeDoorFrontWidthManual: (value: unknown, count: number) => boolean[];
    rebalanceDoorFrontWidths: (
      widths: string[],
      totalWidth: string,
      sideLeftGap: string,
      sideRightGap: string,
      betweenGap: string,
      manual: boolean[],
    ) => { widths: string[]; manual: boolean[] };
  },
): CutlistEntryDraft {
  const nextValue = helpers.numericDecimalText(value);
  const count = Number.parseInt(String(row.doorFrontCount || "1"), 10) || 1;
  const rebalanced = helpers.rebalanceDoorFrontWidths(
    helpers.normalizeDoorFrontWidths(row.doorFrontWidths, count),
    String(row.width ?? ""),
    key === "doorSideLeftGap" ? nextValue : String(row.doorSideLeftGap ?? ""),
    key === "doorSideRightGap" ? nextValue : String(row.doorSideRightGap ?? ""),
    String(row.doorBetweenGap ?? ""),
    helpers.normalizeDoorFrontWidthManual(row.doorFrontWidthManual, count),
  );
  return {
    ...row,
    [key]: nextValue,
    doorFrontWidths: rebalanced.widths,
    doorFrontWidthManual: rebalanced.manual,
  };
}

export function updateCabinetBuilderConfiguredFrontIndexesRow(
  row: CutlistEntryDraft,
  indexes: number[],
  value: string,
  helpers: {
    normalizeDoorModeValue: (value: unknown) => DoorModeValue;
    normalizeDoorFrontWidths: (value: unknown, count: number) => string[];
    normalizeDoorFrontWidthManual: (value: unknown, count: number) => boolean[];
    normalizeDoorFrontHeights: (value: unknown, count: number) => string[];
    normalizeDoorFrontHeightManual: (value: unknown, count: number) => boolean[];
    numericDimensionText: (value: string) => string;
  },
): CutlistEntryDraft {
  const mode = helpers.normalizeDoorModeValue(row.doorMode) === "door" ? "door" : "drawer";
  const count = Number.parseInt(String(row.doorFrontCount || "1"), 10) || 1;
  if (mode === "door") {
    const widths = helpers.normalizeDoorFrontWidths(row.doorFrontWidths, count);
    const manual = helpers.normalizeDoorFrontWidthManual(row.doorFrontWidthManual, count);
    const targetIndexes = indexes.length ? indexes : widths.map((_value, currentIndex) => currentIndex);
    targetIndexes.forEach((currentIndex) => {
      widths[currentIndex] = helpers.numericDimensionText(value);
      manual[currentIndex] = Boolean(String(value).trim());
    });
    return { ...row, doorFrontWidths: widths, doorFrontWidthManual: manual };
  }
  const heights = helpers.normalizeDoorFrontHeights(row.doorFrontHeights, count);
  const manual = helpers.normalizeDoorFrontHeightManual(row.doorFrontHeightManual, count);
  const targetIndexes = indexes.length ? indexes : heights.map((_value, currentIndex) => currentIndex);
  targetIndexes.forEach((currentIndex) => {
    heights[currentIndex] = helpers.numericDimensionText(value);
    manual[currentIndex] = Boolean(String(value).trim());
  });
  return { ...row, doorFrontHeights: heights, doorFrontHeightManual: manual };
}

export function updateCabinetBuilderChildDrawerHeightTokensInDraft(
  draft: CabinetBuilderDraft,
  selectedWallId: string | null | undefined,
  childId: string,
  tokens: string[],
  helpers: {
    formatDrawerHeightTokens: (tokens: string[]) => string;
    parseDrawerHeightTokens: (value: string) => string[];
  },
): CabinetBuilderDraft {
  const formatted = helpers.formatDrawerHeightTokens(tokens);
  return updateCabinetBuilderChildRowInDraft(
    draft,
    selectedWallId,
    childId,
    (row) => ({
      ...row,
      height: formatted,
      quantity: String(Math.max(1, helpers.parseDrawerHeightTokens(formatted).length)),
    }),
  );
}

export function addCabinetBuilderChildDrawerHeightTokenInDraft(
  draft: CabinetBuilderDraft,
  selectedWallId: string | null | undefined,
  childId: string,
  token: string,
  helpers: {
    formatDrawerHeightTokens: (tokens: string[]) => string;
    parseDrawerHeightTokens: (value: string) => string[];
  },
): CabinetBuilderDraft {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall || (!selectedWall.isMain && selectedWall.kind !== "cabinet")) return draft;
  const sourceChildren = selectedWall.isMain
    ? draft.childRows
    : draft.attachments.find((attachment) => attachment.id === selectedWall.id)?.childRows ?? [];
  const child = sourceChildren.find((item) => item.id === childId);
  if (!child) return draft;
  const next = [...helpers.parseDrawerHeightTokens(String(child.row.height ?? "")), String(token || "").trim()].filter(Boolean);
  return updateCabinetBuilderChildDrawerHeightTokensInDraft(draft, selectedWallId, childId, next, helpers);
}

export function removeCabinetBuilderChildDrawerHeightTokenInDraft(
  draft: CabinetBuilderDraft,
  selectedWallId: string | null | undefined,
  childId: string,
  token: string,
  helpers: {
    formatDrawerHeightTokens: (tokens: string[]) => string;
    parseDrawerHeightTokens: (value: string) => string[];
  },
): CabinetBuilderDraft {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall || (!selectedWall.isMain && selectedWall.kind !== "cabinet")) return draft;
  const sourceChildren = selectedWall.isMain
    ? draft.childRows
    : draft.attachments.find((attachment) => attachment.id === selectedWall.id)?.childRows ?? [];
  const child = sourceChildren.find((item) => item.id === childId);
  if (!child) return draft;
  const current = helpers.parseDrawerHeightTokens(String(child.row.height ?? ""));
  const idx = current.findIndex((item) => item.toLowerCase() === String(token || "").trim().toLowerCase());
  if (idx < 0) return draft;
  current.splice(idx, 1);
  return updateCabinetBuilderChildDrawerHeightTokensInDraft(draft, selectedWallId, childId, current, helpers);
}

function resolveAnchorPanelForWallPiece(
  wallPieces: CabinetBuilderWallPiece[],
  piece: CabinetBuilderWallPiece | null | undefined,
): CabinetBuilderWallPiece | null {
  const wallPieceMap = new Map(wallPieces.map((item) => [item.id, item]));
  let current = piece ?? null;
  const visited = new Set<string>();
  while (current && current.parentWallId && !visited.has(current.parentWallId)) {
    visited.add(current.parentWallId);
    const parent = wallPieceMap.get(current.parentWallId) ?? null;
    if (!parent) break;
    if (parent.kind === "panel") return parent;
    current = parent;
  }
  return null;
}

export function createCabinetBuilderRootDraft(args: {
  row: CutlistEntryDraft;
  newCabinet: boolean;
}): CabinetBuilderDraft {
  return {
    row: args.row,
    newCabinet: args.newCabinet,
    doorsRow: null,
    drawersRow: null,
    childRows: [],
    attachments: [],
  };
}

export function addCabinetBuilderAttachmentInDraft(args: {
  draft: CabinetBuilderDraft;
  selectedWallId: string | null | undefined;
  kind: CabinetBuilderAttachmentKind;
  side: "left" | "right";
  row: CutlistEntryDraft;
  newCabinet?: boolean;
  verticalAlign?: "top" | "bottom";
  panelHeightMode?: CabinetBuilderPanelHeightMode;
  panelSpanMode?: CabinetBuilderPanelSpanMode;
}): { draft: CabinetBuilderDraft; selectedId: string } {
  const {
    draft,
    selectedWallId,
    kind,
    side,
    row,
    newCabinet = false,
    verticalAlign = "bottom",
    panelHeightMode,
    panelSpanMode,
  } = args;
  const wallPieces = buildCabinetBuilderWallPieces(draft);
  const selectedWall =
    wallPieces.find((item) => item.id === selectedWallId) ?? wallPieces.find((item) => item.isMain) ?? null;
  const explicitAnchorPanel =
    selectedWall?.kind === "panel"
      ? selectedWall
      : selectedWall?.parentWallId
        ? wallPieces.find((item) => item.id === selectedWall.parentWallId && item.kind === "panel") ?? null
        : null;
  const inferredAnchorPanel =
    !explicitAnchorPanel && selectedWall?.kind === "cabinet"
      ? wallPieces
          .filter((item) => item.kind === "panel")
          .sort(
            (a, b) =>
              Math.abs(a.position - (selectedWall.position ?? 0)) -
              Math.abs(b.position - (selectedWall.position ?? 0)),
          )[0] ?? null
      : null;
  const anchorPanel = explicitAnchorPanel ?? inferredAnchorPanel;
  const shouldSharePanelLane = Boolean(
    anchorPanel &&
      selectedWall?.kind === "cabinet" &&
      selectedWall.side &&
      verticalAlign !== (selectedWall.verticalAlign ?? "bottom"),
  );
  const anchorPanelId = shouldSharePanelLane ? anchorPanel?.id ?? "main" : "";
  const laneAnchor = shouldSharePanelLane ? anchorPanel : selectedWall ?? anchorPanel;
  const selectedPosition = laneAnchor?.position ?? 0;
  const effectiveSide = shouldSharePanelLane
    ? selectedWall?.side ?? side
    : selectedWall?.kind === "panel"
      ? side
      : anchorPanel && selectedWall?.kind !== "cabinet"
        ? (selectedWall?.position ?? 0) < anchorPanel.position
          ? "left"
          : "right"
        : side;
  const stackedSibling =
    shouldSharePanelLane
      ? draft.attachments.find(
          (attachment) =>
            attachment.kind === kind &&
            attachment.side === effectiveSide &&
            (attachment.parentWallId || "main") === anchorPanelId &&
            (attachment.verticalAlign ?? "bottom") !== verticalAlign,
        ) ?? null
      : null;
  const leftNeighbor =
    wallPieces.filter((item) => item.position < selectedPosition).sort((a, b) => b.position - a.position)[0] ?? null;
  const rightNeighbor =
    wallPieces.filter((item) => item.position > selectedPosition).sort((a, b) => a.position - b.position)[0] ?? null;
  const nextPosition =
    stackedSibling && typeof stackedSibling.position === "number"
      ? Number(stackedSibling.position)
      : effectiveSide === "left"
        ? leftNeighbor
          ? (selectedPosition + leftNeighbor.position) / 2
          : selectedPosition - 1
        : rightNeighbor
          ? (selectedPosition + rightNeighbor.position) / 2
          : selectedPosition + 1;
  const nextId = `cab_att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    selectedId: nextId,
    draft: {
      ...draft,
      attachments: [
        ...draft.attachments,
        {
          id: nextId,
          side: effectiveSide,
          position: nextPosition,
          parentWallId: anchorPanel ? anchorPanel.id : selectedWall?.id || "main",
          kind,
          verticalAlign,
          newCabinet,
          panelHeightMode,
          panelSpanMode,
          row,
          doorsRow: null,
          drawersRow: null,
          childRows: [],
        },
      ],
    },
  };
}

export function confirmCabinetBuilderPendingAttachmentInDraft(args: {
  draft: CabinetBuilderDraft;
  selectedWallId: string | null | undefined;
  pendingKind: CabinetBuilderAttachmentKind;
  pendingAttachment: { side: "left" | "right"; kind: CabinetBuilderAttachmentKind; align: "top" | "bottom" };
  normalizedPendingRow: CutlistEntryDraft;
  pendingNewCabinet: boolean;
  pendingPanelHeightMode: CabinetBuilderPanelHeightMode;
  pendingPanelSpanMode: CabinetBuilderPanelSpanMode;
}): { draft: CabinetBuilderDraft; selectedId: string } {
  const {
    draft,
    selectedWallId,
    pendingKind,
    pendingAttachment,
    normalizedPendingRow,
    pendingNewCabinet,
    pendingPanelHeightMode,
    pendingPanelSpanMode,
  } = args;
  const wallPieces = buildCabinetBuilderWallPieces(draft);
  const selectedWall =
    wallPieces.find((item) => item.id === selectedWallId) ?? wallPieces.find((item) => item.isMain) ?? null;
  const effectiveAlign: "top" | "bottom" =
    pendingKind === "cabinet" && selectedWall?.kind === "cabinet"
      ? (selectedWall.verticalAlign ?? pendingAttachment.align)
      : pendingAttachment.align;
  const explicitAnchorPanel =
    selectedWall?.kind === "panel"
      ? selectedWall
      : selectedWall?.parentWallId
        ? wallPieces.find((item) => item.id === selectedWall.parentWallId && item.kind === "panel") ?? null
        : null;
  const inferredAnchorPanel =
    !explicitAnchorPanel && selectedWall?.kind === "cabinet"
      ? resolveAnchorPanelForWallPiece(wallPieces, selectedWall) ??
        (wallPieces
          .filter((item) => item.kind === "panel")
          .sort(
            (a, b) =>
              Math.abs(a.position - (selectedWall.position ?? 0)) -
              Math.abs(b.position - (selectedWall.position ?? 0)),
          )[0] ?? null)
      : null;
  const anchorPanel = explicitAnchorPanel ?? inferredAnchorPanel;
  const shouldSharePanelLane = Boolean(
    anchorPanel &&
      selectedWall?.kind === "cabinet" &&
      selectedWall.side &&
      effectiveAlign !== (selectedWall.verticalAlign ?? "bottom"),
  );
  const anchorPanelId = shouldSharePanelLane ? anchorPanel?.id ?? "main" : "";
  const laneAnchor = shouldSharePanelLane ? anchorPanel : selectedWall ?? anchorPanel;
  const selectedPosition = laneAnchor?.position ?? 0;
  const parentWallId =
    pendingKind === "cabinet" &&
    selectedWall?.kind === "cabinet" &&
    anchorPanel &&
    effectiveAlign === (selectedWall.verticalAlign ?? "bottom")
      ? selectedWall.id
      : pendingKind === "panel" && selectedWall?.kind === "cabinet"
        ? selectedWall.id
        : anchorPanel
          ? anchorPanel.id
          : selectedWall?.id || "main";
  const effectiveSide = shouldSharePanelLane
    ? selectedWall?.side ?? pendingAttachment.side
    : selectedWall?.kind === "panel"
      ? pendingAttachment.side
      : anchorPanel && selectedWall?.kind !== "cabinet"
        ? (selectedWall?.position ?? 0) < anchorPanel.position
          ? "left"
          : "right"
        : pendingAttachment.side;
  const stackedSibling =
    shouldSharePanelLane
      ? draft.attachments.find(
          (attachment) =>
            attachment.kind === pendingKind &&
            attachment.side === effectiveSide &&
            (attachment.parentWallId || "main") === anchorPanelId &&
            (attachment.verticalAlign ?? "bottom") !== effectiveAlign,
        ) ?? null
      : null;
  const samePanelSideTrackChain =
    anchorPanel && selectedWall?.kind === "cabinet"
      ? wallPieces
          .filter((item) => {
            if (item.id === anchorPanel.id) return false;
            if ((item.verticalAlign ?? "bottom") !== effectiveAlign) return false;
            const itemAnchorPanel = resolveAnchorPanelForWallPiece(wallPieces, item);
            return item.side === effectiveSide && itemAnchorPanel?.id === anchorPanel.id;
          })
          .sort((a, b) => a.position - b.position)
      : [];
  const horizontalSiblingPool =
    samePanelSideTrackChain.length > 0
      ? samePanelSideTrackChain.filter((item) => item.id !== selectedWall?.id)
      : pendingKind === "cabinet" && selectedWall?.kind === "cabinet"
        ? wallPieces.filter((item) => {
            if (item.id === selectedWall.id || item.kind === "panel") return false;
            if ((item.verticalAlign ?? "bottom") !== effectiveAlign) return false;
            if (anchorPanel) {
              return item.side === effectiveSide && (item.parentWallId || "main") === anchorPanel.id;
            }
            return item.side === effectiveSide;
          })
        : wallPieces;
  const samePanelSideTrackSiblings = samePanelSideTrackChain;
  const leftNeighbor =
    horizontalSiblingPool
      .filter((item) => item.position < selectedPosition)
      .sort((a, b) => b.position - a.position)[0] ?? null;
  const rightNeighbor =
    horizontalSiblingPool
      .filter((item) => item.position > selectedPosition)
      .sort((a, b) => a.position - b.position)[0] ?? null;
  const selectedSiblingIndex = samePanelSideTrackSiblings.findIndex((item) => item.id === selectedWall?.id);
  const chainInsertPosition =
    selectedSiblingIndex >= 0
      ? effectiveSide === "left"
        ? selectedSiblingIndex === 0
          ? samePanelSideTrackSiblings[0].position - 1
          : (samePanelSideTrackSiblings[selectedSiblingIndex - 1].position + selectedPosition) / 2
        : selectedSiblingIndex === samePanelSideTrackSiblings.length - 1
          ? samePanelSideTrackSiblings[selectedSiblingIndex].position + 1
          : (selectedPosition + samePanelSideTrackSiblings[selectedSiblingIndex + 1].position) / 2
      : null;
  const nextPosition =
    stackedSibling && typeof stackedSibling.position === "number"
      ? Number(stackedSibling.position)
      : chainInsertPosition !== null
        ? chainInsertPosition
        : effectiveSide === "left"
          ? leftNeighbor
            ? (selectedPosition + leftNeighbor.position) / 2
            : selectedPosition - 1
          : rightNeighbor
            ? (selectedPosition + rightNeighbor.position) / 2
            : selectedPosition + 1;
  const nextId = `cab_att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    selectedId: nextId,
    draft: {
      ...draft,
      attachments: [
        ...draft.attachments,
        {
          id: nextId,
          side: effectiveSide,
          position: nextPosition,
          parentWallId,
          kind: pendingKind,
          verticalAlign: effectiveAlign,
          newCabinet: pendingNewCabinet,
          panelHeightMode: pendingKind === "panel" ? pendingPanelHeightMode : undefined,
          panelSpanMode: pendingKind === "panel" ? pendingPanelSpanMode : undefined,
          row: normalizedPendingRow,
          doorsRow: null,
          drawersRow: null,
          childRows: [],
        },
      ],
    },
  };
}
