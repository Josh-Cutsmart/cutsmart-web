export type DoorModeValue = "" | "manual" | "door" | "drawer";

export type CabinetBuilderRowKind = "container" | "generated";

export type CutlistRow = {
  id: string;
  room: string;
  partType: string;
  board: string;
  name: string;
  doorMode?: DoorModeValue;
  doorFrontCount?: string;
  doorTopGap?: string;
  doorBetweenGap?: string;
  doorSideLeft?: "front" | "panel";
  doorSideRight?: "front" | "panel";
  doorSideLeftGap?: string;
  doorSideRightGap?: string;
  doorFrontWidths?: string[];
  doorFrontWidthManual?: boolean[];
  doorFrontHeights?: string[];
  doorFrontHeightManual?: boolean[];
  height: string;
  width: string;
  depth: string;
  quantity: string;
  clashing: string;
  clashLeft?: string;
  clashRight?: string;
  fixedShelf?: string;
  adjustableShelf?: string;
  fixedShelfDrilling?: string;
  adjustableShelfDrilling?: string;
  hingesUp?: string[];
  hingesDown?: string[];
  information: string;
  grain: boolean;
  grainValue: string;
  includeInNesting?: boolean;
  parentName?: string;
  cabinetBuilderRowKind?: CabinetBuilderRowKind;
  cabinetBuilderContainerId?: string;
  cabinetBuilderData?: CabinetBuilderDraft | null;
};

export type CutlistDraftRow = CutlistRow;
export type CutlistEntryDraft = Omit<CutlistRow, "id" | "room">;

export type CabinetBuilderAttachmentKind = "cabinet" | "panel";
export type CabinetBuilderPanelHeightMode = "base" | "tall";
export type CabinetBuilderPanelSpanMode = "floorToCeiling" | "floorToTopOfCab" | "bottomToCeiling" | "bottomToTopOfCab";

export type CabinetBuilderChildDraft = {
  id: string;
  row: CutlistEntryDraft;
};

export type CabinetBuilderAttachmentDraft = {
  id: string;
  side: "left" | "right";
  position?: number;
  parentWallId?: string;
  kind: CabinetBuilderAttachmentKind;
  verticalAlign?: "top" | "bottom";
  newCabinet?: boolean;
  panelHeightMode?: CabinetBuilderPanelHeightMode;
  panelSpanMode?: CabinetBuilderPanelSpanMode;
  row: CutlistEntryDraft;
  doorsRow?: CutlistEntryDraft | null;
  drawersRow?: CutlistEntryDraft | null;
  childRows?: CabinetBuilderChildDraft[];
};

export type CabinetBuilderDraft = {
  row: CutlistEntryDraft;
  newCabinet: boolean;
  doorsRow: CutlistEntryDraft | null;
  drawersRow: CutlistEntryDraft | null;
  childRows: CabinetBuilderChildDraft[];
  attachments: CabinetBuilderAttachmentDraft[];
};

export type CabinetBuilderWallPiece = {
  id: string;
  position: number;
  side?: "left" | "right";
  parentWallId?: string;
  kind: CabinetBuilderAttachmentKind | "main";
  verticalAlign?: "top" | "bottom";
  newCabinet: boolean;
  row: CutlistEntryDraft;
  isMain: boolean;
  panelHeightMode?: CabinetBuilderPanelHeightMode;
  panelSpanMode?: CabinetBuilderPanelSpanMode;
  doorsRow: CutlistEntryDraft | null;
  drawersRow: CutlistEntryDraft | null;
  childRows: CabinetBuilderChildDraft[];
};

export type CabinetBuilderAttachedDisplayRowSource =
  | { kind: "cabinetSelf"; ownerId: string }
  | { kind: "panelSelf"; ownerId: string }
  | { kind: "child"; ownerId: string; childId: string }
  | { kind: "configuredFront"; ownerId: string; frontKind: "doorsRow" | "drawersRow"; indexes: number[] };

export type CabinetBuilderAttachedDisplayRow = {
  row: CutlistEntryDraft;
  source: CabinetBuilderAttachedDisplayRowSource;
};

export type CabinetBuilderDeleteMeta = {
  id: string;
  name: string;
  isMain: boolean;
  descendantIds: Set<string>;
  connectedPartsCount: number;
  requiresConfirm: boolean;
  nextSelectedWallId: string;
};

export type CabinetBuilderDisplayPieceLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CabinetBuilderEditableCabinetSelection = {
  id: string;
  isMain: boolean;
  kind: "main" | "cabinet";
  newCabinet: boolean;
  row: CutlistEntryDraft;
  doorsRow: CutlistEntryDraft | null;
  drawersRow: CutlistEntryDraft | null;
  childRows: CabinetBuilderChildDraft[];
};

export type CabinetBuilderPreviewViewport = {
  viewWidth: number;
  viewHeight: number;
  paddingX: number;
  paddingY: number;
};

export type CabinetBuilderDisplayPieceWithPalette<TPalette> = CabinetBuilderWallPiece & {
  rawWidth: number;
  rawHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  palette: TPalette;
};

export function buildCabinetBuilderWallPieces(draft: CabinetBuilderDraft): CabinetBuilderWallPiece[] {
  const leftLegacy = draft.attachments.filter((item) => typeof item.position !== "number" && item.side === "left");
  const rightLegacy = draft.attachments.filter((item) => typeof item.position !== "number" && item.side === "right");
  const explicit = draft.attachments.filter((item) => typeof item.position === "number");
  const normalizedAttachments: CabinetBuilderWallPiece[] = [
    ...explicit.map((item) => ({
      id: item.id,
      position: Number(item.position),
      side: item.side,
      parentWallId: item.parentWallId,
      kind: item.kind,
      verticalAlign: item.verticalAlign ?? "bottom",
      newCabinet: Boolean(item.newCabinet),
      panelHeightMode: item.panelHeightMode,
      panelSpanMode: item.panelSpanMode,
      row: item.row,
      isMain: false,
      doorsRow: item.doorsRow ?? null,
      drawersRow: item.drawersRow ?? null,
      childRows: item.childRows ?? [],
    })),
    ...leftLegacy.map((item, index) => ({
      id: item.id,
      position: -leftLegacy.length + index,
      side: item.side,
      parentWallId: item.parentWallId,
      kind: item.kind,
      verticalAlign: item.verticalAlign ?? "bottom",
      newCabinet: Boolean(item.newCabinet),
      panelHeightMode: item.panelHeightMode,
      panelSpanMode: item.panelSpanMode,
      row: item.row,
      isMain: false,
      doorsRow: item.doorsRow ?? null,
      drawersRow: item.drawersRow ?? null,
      childRows: item.childRows ?? [],
    })),
    ...rightLegacy.map((item, index) => ({
      id: item.id,
      position: index + 1,
      side: item.side,
      parentWallId: item.parentWallId,
      kind: item.kind,
      verticalAlign: item.verticalAlign ?? "bottom",
      newCabinet: Boolean(item.newCabinet),
      panelHeightMode: item.panelHeightMode,
      panelSpanMode: item.panelSpanMode,
      row: item.row,
      isMain: false,
      doorsRow: item.doorsRow ?? null,
      drawersRow: item.drawersRow ?? null,
      childRows: item.childRows ?? [],
    })),
  ];
  const mainPiece: CabinetBuilderWallPiece = {
    id: "main",
    position: 0,
    side: undefined,
    parentWallId: undefined,
    kind: "main",
    verticalAlign: "bottom",
    newCabinet: draft.newCabinet,
    panelHeightMode: undefined,
    panelSpanMode: undefined,
    row: draft.row,
    isMain: true,
    doorsRow: draft.doorsRow,
    drawersRow: draft.drawersRow,
    childRows: draft.childRows,
  };
  return [...normalizedAttachments, mainPiece].sort((a, b) => a.position - b.position);
}

export function getCabinetBuilderSelectedWallPiece(
  draft: CabinetBuilderDraft,
  selectedWallId?: string | null,
): CabinetBuilderWallPiece | null {
  const wallPieces = buildCabinetBuilderWallPieces(draft);
  const selectedId = String(selectedWallId || "").trim();
  if (selectedId) {
    return wallPieces.find((item) => item.id === selectedId) ?? null;
  }
  return wallPieces.find((item) => item.isMain) ?? null;
}

export function getCabinetBuilderSelectedConfiguredRow(
  draft: CabinetBuilderDraft,
  kind: "doorsRow" | "drawersRow",
  selectedWallId?: string | null,
) {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall) return null;
  return kind === "doorsRow" ? selectedWall.doorsRow ?? null : selectedWall.drawersRow ?? null;
}

export function getCabinetBuilderSelectedFrontRow(
  draft: CabinetBuilderDraft,
  selectedWallId?: string | null,
) {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall) return null;
  return selectedWall.doorsRow || selectedWall.drawersRow || null;
}

export function getCabinetBuilderSelectedFrontKind(
  draft: CabinetBuilderDraft,
  selectedWallId?: string | null,
): "doorsRow" | "drawersRow" | null {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall) return null;
  if (selectedWall.doorsRow) return "doorsRow";
  if (selectedWall.drawersRow) return "drawersRow";
  return null;
}

export function getCabinetBuilderSelectedEditableCabinet(
  draft: CabinetBuilderDraft,
  selectedWallId?: string | null,
): CabinetBuilderEditableCabinetSelection | null {
  const selectedWall = getCabinetBuilderSelectedWallPiece(draft, selectedWallId);
  if (!selectedWall) return null;
  if (selectedWall.isMain) {
    return {
      id: "main",
      isMain: true,
      kind: "main",
      newCabinet: draft.newCabinet,
      row: draft.row,
      doorsRow: draft.doorsRow,
      drawersRow: draft.drawersRow,
      childRows: draft.childRows,
    };
  }
  if (selectedWall.kind !== "cabinet") return null;
  const attachment = draft.attachments.find((item) => item.id === selectedWall.id);
  if (!attachment) return null;
  return {
    id: attachment.id,
    isMain: false,
    kind: "cabinet",
    newCabinet: Boolean(attachment.newCabinet),
    row: attachment.row,
    doorsRow: attachment.doorsRow ?? null,
    drawersRow: attachment.drawersRow ?? null,
    childRows: attachment.childRows ?? [],
  };
}

export function getCabinetBuilderDeleteDescendantIds() {
  return new Set<string>();
}

export function buildCabinetBuilderDeleteMeta(
  draft: CabinetBuilderDraft,
  wallId?: string | null,
  selectedWallId?: string | null,
): CabinetBuilderDeleteMeta | null {
  const selectedWall =
    (wallId
      ? buildCabinetBuilderWallPieces(draft).find((item) => item.id === wallId) ?? null
      : null) ??
    getCabinetBuilderSelectedEditableCabinet(draft, selectedWallId);
  if (!selectedWall) return null;
  const selectedAttachment = selectedWall.isMain
    ? null
    : draft.attachments.find((attachment) => attachment.id === selectedWall.id) ?? null;
  const descendantIds = getCabinetBuilderDeleteDescendantIds();
  const connectedPartsCount =
    (selectedWall.doorsRow ? 1 : 0) +
    (selectedWall.drawersRow ? 1 : 0) +
    (selectedWall.childRows?.length ?? 0) +
    descendantIds.size;
  return {
    id: selectedWall.id,
    name: selectedWall.row.name || (selectedWall.kind === "panel" ? "Panel" : "Cabinet"),
    isMain: selectedWall.isMain,
    descendantIds,
    connectedPartsCount,
    requiresConfirm: connectedPartsCount > 0,
    nextSelectedWallId: selectedWall.isMain ? "main" : selectedAttachment?.parentWallId || "main",
  };
}

export function removeCabinetBuilderWallByDeleteMeta(
  draft: CabinetBuilderDraft,
  deleteMeta: CabinetBuilderDeleteMeta,
): CabinetBuilderDraft | null {
  const removeIds = new Set<string>([deleteMeta.id, ...deleteMeta.descendantIds]);
  const survivingAttachments = draft.attachments.filter((attachment) => !removeIds.has(attachment.id));
  if (deleteMeta.isMain) {
    const replacementAttachment =
      [...survivingAttachments].sort((a, b) => Number(a.position) - Number(b.position))[0] ?? null;
    if (!replacementAttachment) return null;
    return {
      row: replacementAttachment.row,
      newCabinet: Boolean(replacementAttachment.newCabinet),
      doorsRow: replacementAttachment.doorsRow ?? null,
      drawersRow: replacementAttachment.drawersRow ?? null,
      childRows: replacementAttachment.childRows ?? [],
      attachments: survivingAttachments
        .filter((attachment) => attachment.id !== replacementAttachment.id)
        .map((attachment) => ({
          ...attachment,
          parentWallId:
            (attachment.parentWallId || "main") === deleteMeta.id ||
            (attachment.parentWallId || "main") === replacementAttachment.id ||
            (attachment.parentWallId || "main") === "main"
              ? "main"
              : attachment.parentWallId,
        })),
    };
  }
  return {
    ...draft,
    attachments: survivingAttachments,
  };
}

export function getCabinetBuilderWallPieceHorizontalTrack(item: CabinetBuilderWallPiece) {
  return (item.verticalAlign ?? "bottom") === "top" ? "top" : "bottom";
}

export function getCabinetBuilderWallPieceRawWidth(
  item: CabinetBuilderWallPiece,
  boardThicknessFor: (board: string) => number,
) {
  const panelWidthFallback = item.kind === "panel" ? Math.max(1, boardThicknessFor(String(item.row.board || "")) || 18) : 18;
  return Math.max(1, Number.parseFloat(String(item.row.width || "").replace(/[^\d.-]/g, "")) || (item.isMain ? 600 : panelWidthFallback));
}

export function getCabinetBuilderLaneRawWidth(
  laneItems: CabinetBuilderWallPiece[],
  getRawWidth: (item: CabinetBuilderWallPiece) => number,
) {
  const bottomAnchoredWidths = laneItems
    .filter((item) => item.kind === "panel" || (item.verticalAlign ?? "bottom") !== "top")
    .map(getRawWidth);
  if (bottomAnchoredWidths.length) {
    return bottomAnchoredWidths.reduce((maxWidth, width) => Math.max(maxWidth, width), 1);
  }
  return laneItems
    .map(getRawWidth)
    .reduce((maxWidth, width) => Math.max(maxWidth, width), 1);
}

export function buildCabinetBuilderPreviewWallPieces(args: {
  draft: CabinetBuilderDraft;
  draggingId: string;
  pointerX: number | null;
  viewport: CabinetBuilderPreviewViewport | null;
  getRawWidth: (item: CabinetBuilderWallPiece) => number;
}) {
  const { draft, draggingId, pointerX, viewport, getRawWidth } = args;
  const wallPieces = buildCabinetBuilderWallPieces(draft);
  if (!draggingId || pointerX === null || !viewport || wallPieces.length <= 1) return wallPieces;
  const draggingPiece = wallPieces.find((item) => item.id === draggingId);
  if (!draggingPiece) return wallPieces;
  const remainingPieces = wallPieces.filter((item) => item.id !== draggingId);
  if (!remainingPieces.length) return wallPieces;

  const lanes = Array.from(
    remainingPieces.reduce((map, item) => {
      const laneItems = map.get(item.position) ?? [];
      laneItems.push(item);
      map.set(item.position, laneItems);
      return map;
    }, new Map<number, CabinetBuilderWallPiece[]>()),
  )
    .sort((a, b) => a[0] - b[0])
    .map(([position, items]) => ({ position, items }));

  const totalWidth = lanes.reduce((sum, lane) => sum + getCabinetBuilderLaneRawWidth(lane.items, getRawWidth), 0);
  const totalHeight = Math.max(
    ...wallPieces.map((item) => Math.max(1, Number.parseFloat(String(item.row.height || "").replace(/[^\d.-]/g, "")) || 720)),
  );
  const scale = Math.min(
    (viewport.viewWidth - viewport.paddingX * 2) / totalWidth,
    (viewport.viewHeight - viewport.paddingY * 2) / totalHeight,
  );
  const originX = (viewport.viewWidth - totalWidth * scale) / 2;
  let currentX = originX;
  const baseLayouts = lanes.map((lane) => {
    const rawWidth = getCabinetBuilderLaneRawWidth(lane.items, getRawWidth);
    const width = rawWidth * scale;
    const layout = {
      lane,
      x: currentX,
      width,
      center: currentX + width / 2,
    };
    currentX += width;
    return layout;
  });

  const overlappingLayout =
    baseLayouts.find((layout) => pointerX >= layout.x && pointerX <= layout.x + layout.width) ?? null;
  const laneAllowsSharedStack = (laneItems: CabinetBuilderWallPiece[]) =>
    laneItems.some(
      (laneItem) =>
        laneItem.kind !== "panel" &&
        draggingPiece.kind !== "panel" &&
        (laneItem.verticalAlign ?? "bottom") !== (draggingPiece.verticalAlign ?? "bottom"),
    );

  let nextPosition = draggingPiece.position;
  const panelLayouts = baseLayouts
    .map((layout) => {
      const panelPiece = layout.lane.items.find((item) => item.kind === "panel") ?? null;
      return panelPiece ? { layout, panelPiece } : null;
    })
    .filter((entry): entry is { layout: (typeof baseLayouts)[number]; panelPiece: CabinetBuilderWallPiece } => Boolean(entry));

  const resolveNearestPanelForPosition = (position: number) =>
    panelLayouts.length
      ? ([...panelLayouts].sort(
          (a, b) =>
            Math.abs(Number(a.panelPiece.position) - Number(position)) -
            Math.abs(Number(b.panelPiece.position) - Number(position)),
        )[0]?.panelPiece ?? null)
      : null;

  const targetPanelEntry =
    (overlappingLayout
      ? panelLayouts.find((entry) => entry.layout.lane.position === overlappingLayout.lane.position) ?? null
      : null) ??
    (panelLayouts.length
      ? [...panelLayouts].sort((a, b) => Math.abs(a.layout.center - pointerX) - Math.abs(b.layout.center - pointerX))[0]
      : null);

  const targetAnchorPanel =
    draggingPiece.kind === "panel"
      ? targetPanelEntry?.panelPiece ?? resolveNearestPanelForPosition(Number(draggingPiece.position))
      : targetPanelEntry?.panelPiece ?? resolveNearestPanelForPosition(Number(draggingPiece.position));

  const anchorPanelLayout =
    targetAnchorPanel
      ? baseLayouts.find((layout) => layout.lane.position === targetAnchorPanel.position) ?? null
      : null;

  const targetSide: "left" | "right" =
    targetAnchorPanel && anchorPanelLayout
      ? pointerX < anchorPanelLayout.center
        ? "left"
        : "right"
      : draggingPiece.side ?? (draggingPiece.position < 0 ? "left" : "right");

  const samePanelSideTrackSiblings =
    draggingPiece.kind !== "panel" && targetAnchorPanel
      ? remainingPieces
          .filter((item) => {
            if (item.kind === "panel") return false;
            if ((item.verticalAlign ?? "bottom") !== (draggingPiece.verticalAlign ?? "bottom")) return false;
            if (item.side !== targetSide) return false;
            const itemAnchorPanel = resolveNearestPanelForPosition(Number(item.position));
            return itemAnchorPanel?.id === targetAnchorPanel.id;
          })
          .sort((a, b) => a.position - b.position)
      : [];

  if (samePanelSideTrackSiblings.length) {
    const siblingLayouts = samePanelSideTrackSiblings
      .map((item) => {
        const layout = baseLayouts.find((candidate) => candidate.lane.position === item.position);
        return layout ? { item, layout } : null;
      })
      .filter((entry): entry is { item: CabinetBuilderWallPiece; layout: (typeof baseLayouts)[number] } => Boolean(entry));
    const panelPosition = Number(targetAnchorPanel?.position ?? 0);
    if (targetSide === "right") {
      if (siblingLayouts.length === 1) {
        nextPosition =
          pointerX <= siblingLayouts[0].layout.center
            ? (panelPosition + siblingLayouts[0].item.position) / 2
            : siblingLayouts[0].item.position + 1;
      } else if (pointerX <= siblingLayouts[0].layout.center) {
        nextPosition = (panelPosition + siblingLayouts[0].item.position) / 2;
      } else if (pointerX >= siblingLayouts[siblingLayouts.length - 1].layout.center) {
        nextPosition = siblingLayouts[siblingLayouts.length - 1].item.position + 1;
      } else {
        for (let index = 1; index < siblingLayouts.length; index += 1) {
          const previous = siblingLayouts[index - 1];
          const next = siblingLayouts[index];
          if (pointerX < next.layout.center) {
            nextPosition = (previous.item.position + next.item.position) / 2;
            break;
          }
        }
      }
    } else {
      const innerMost = siblingLayouts[siblingLayouts.length - 1];
      const outerMost = siblingLayouts[0];
      if (siblingLayouts.length === 1) {
        nextPosition =
          pointerX >= siblingLayouts[0].layout.center
            ? (panelPosition + siblingLayouts[0].item.position) / 2
            : siblingLayouts[0].item.position - 1;
      } else if (pointerX >= innerMost.layout.center) {
        nextPosition = (panelPosition + innerMost.item.position) / 2;
      } else if (pointerX <= outerMost.layout.center) {
        nextPosition = outerMost.item.position - 1;
      } else {
        for (let index = 1; index < siblingLayouts.length; index += 1) {
          const previous = siblingLayouts[index - 1];
          const next = siblingLayouts[index];
          if (pointerX < next.layout.center) {
            nextPosition = (previous.item.position + next.item.position) / 2;
            break;
          }
        }
      }
    }
  } else if (targetAnchorPanel) {
    nextPosition = targetSide === "left" ? targetAnchorPanel.position - 1 : targetAnchorPanel.position + 1;
  } else if (overlappingLayout && laneAllowsSharedStack(overlappingLayout.lane.items)) {
    nextPosition = overlappingLayout.lane.position;
  } else if (baseLayouts.length) {
    if (pointerX < baseLayouts[0].center) {
      nextPosition = baseLayouts[0].lane.position - 1;
    } else if (pointerX > baseLayouts[baseLayouts.length - 1].center) {
      nextPosition = baseLayouts[baseLayouts.length - 1].lane.position + 1;
    } else if (overlappingLayout) {
      const overlappingIndex = baseLayouts.findIndex((layout) => layout.lane.position === overlappingLayout.lane.position);
      if (overlappingIndex >= 0) {
        const placeAfter = pointerX >= overlappingLayout.center;
        if (placeAfter) {
          if (overlappingIndex === baseLayouts.length - 1) {
            nextPosition = overlappingLayout.lane.position + 1;
          } else {
            nextPosition =
              (overlappingLayout.lane.position + baseLayouts[overlappingIndex + 1].lane.position) / 2;
          }
        } else if (overlappingIndex === 0) {
          nextPosition = overlappingLayout.lane.position - 1;
        } else {
          nextPosition =
            (baseLayouts[overlappingIndex - 1].lane.position + overlappingLayout.lane.position) / 2;
        }
      }
    } else {
      const insertIndex = baseLayouts.findIndex((layout) => pointerX < layout.center);
      if (insertIndex > 0) {
        nextPosition = (baseLayouts[insertIndex - 1].lane.position + baseLayouts[insertIndex].lane.position) / 2;
      }
    }
  }

  return wallPieces
    .map((item) =>
      item.id === draggingId
        ? { ...item, position: nextPosition, side: targetSide }
        : item,
    )
    .sort((a, b) => a.position - b.position);
}

export function applyCabinetBuilderWallOrder(draft: CabinetBuilderDraft, previewPieces: CabinetBuilderWallPiece[]) {
  if (!previewPieces.length) return draft;
  const previewMap = new Map(previewPieces.filter((piece) => !piece.isMain).map((piece) => [piece.id, piece]));
  const previewPanels = previewPieces.filter((piece) => piece.kind === "panel");

  const resolveNearestPreviewPanel = (piece: CabinetBuilderWallPiece | null | undefined) => {
    if (!piece || piece.kind === "panel") return null;
    if (!previewPanels.length) return null;
    return (
      [...previewPanels].sort(
        (a, b) => Math.abs(Number(a.position) - Number(piece.position)) - Math.abs(Number(b.position) - Number(piece.position)),
      )[0] ?? null
    );
  };

  const reorderedAttachments: CabinetBuilderAttachmentDraft[] = [];
  draft.attachments.forEach((attachment) => {
    const previewPiece = previewMap.get(attachment.id);
    if (!previewPiece) {
      reorderedAttachments.push(attachment);
      return;
    }
    const nextPosition = Number(previewPiece.position);
    const parentPanel = resolveNearestPreviewPanel(previewPiece);
    const nextSide: "left" | "right" =
      parentPanel
        ? nextPosition < Number(parentPanel.position)
          ? "left"
          : nextPosition > Number(parentPanel.position)
            ? "right"
            : attachment.side
        : nextPosition < 0
          ? "left"
          : nextPosition > 0
            ? "right"
            : attachment.side;
    reorderedAttachments.push({
      ...attachment,
      side: nextSide,
      position: nextPosition,
    });
  });

  return {
    ...draft,
    attachments: reorderedAttachments,
  };
}

export function getCabinetBuilderPanelBaseHeight(
  mode: CabinetBuilderPanelHeightMode,
  tallCabHeight: string,
  baseCabHeight: string,
) {
  return mode === "tall"
    ? Number.parseFloat(String(tallCabHeight || "").replace(/[^\d.-]/g, "")) || 0
    : Number.parseFloat(String(baseCabHeight || "").replace(/[^\d.-]/g, "")) || 0;
}

export function getCabinetBuilderPanelHeightBaseline(
  heightMode: CabinetBuilderPanelHeightMode,
  spanMode: CabinetBuilderPanelSpanMode,
  tallCabHeight: string,
  baseCabHeight: string,
  footHeight: string,
) {
  const baseHeight = getCabinetBuilderPanelBaseHeight(heightMode, tallCabHeight, baseCabHeight);
  const parsedFootHeight = Number.parseFloat(String(footHeight || "").replace(/[^\d.-]/g, "")) || 0;
  if (spanMode === "floorToCeiling" || spanMode === "floorToTopOfCab") {
    return baseHeight + parsedFootHeight;
  }
  return baseHeight;
}

export function getCabinetBuilderWallPieceVerticalBounds(args: {
  item: CabinetBuilderWallPiece;
  rawHeight: number;
  wallPieces: CabinetBuilderWallPiece[];
  tallCabHeight: string;
  baseCabHeight: string;
  footHeight: string;
}): { top: number; bottom: number } {
  const { item, rawHeight, wallPieces, tallCabHeight, baseCabHeight, footHeight } = args;
  if (item.kind !== "panel") {
    if (item.verticalAlign === "top" && item.parentWallId) {
      const wallPieceMap = new Map(wallPieces.map((piece) => [piece.id, piece]));
      let currentParent = wallPieceMap.get(item.parentWallId) ?? null;
      const visited = new Set<string>();
      while (currentParent && currentParent.kind !== "panel" && currentParent.parentWallId && !visited.has(currentParent.parentWallId)) {
        visited.add(currentParent.parentWallId);
        currentParent = wallPieceMap.get(currentParent.parentWallId) ?? null;
      }
      const parentWall = currentParent?.kind === "panel" ? currentParent : null;
      if (parentWall) {
        const parentRawHeight = Math.max(1, Number.parseFloat(String(parentWall.row.height || "").replace(/[^\d.-]/g, "")) || 720);
        const parentBounds = getCabinetBuilderWallPieceVerticalBounds({
          item: parentWall,
          rawHeight: parentRawHeight,
          wallPieces,
          tallCabHeight,
          baseCabHeight,
          footHeight,
        });
        const parsedTallCabHeight = Number.parseFloat(String(tallCabHeight || "").replace(/[^\d.-]/g, "")) || 0;
        const topMountTop = parsedTallCabHeight > 0 ? -parsedTallCabHeight : parentBounds.top;
        return {
          top: topMountTop,
          bottom: topMountTop + rawHeight,
        };
      }
    }
    return { top: -rawHeight, bottom: 0 };
  }

  const panelHeightMode = item.panelHeightMode ?? "base";
  const baselineCabHeight = getCabinetBuilderPanelBaseHeight(panelHeightMode, tallCabHeight, baseCabHeight);
  const parsedFootHeight = Number.parseFloat(String(footHeight || "").replace(/[^\d.-]/g, "")) || 0;
  const spanMode = item.panelSpanMode ?? "bottomToTopOfCab";
  if (spanMode === "floorToTopOfCab" || spanMode === "bottomToTopOfCab") {
    const top = -baselineCabHeight;
    return {
      top,
      bottom: top + rawHeight,
    };
  }
  const bottomOverhang = spanMode === "floorToCeiling" ? parsedFootHeight : 0;
  const topOverhang = Math.max(0, rawHeight - baselineCabHeight - bottomOverhang);
  return {
    top: -(baselineCabHeight + topOverhang),
    bottom: bottomOverhang,
  };
}

export function buildCabinetBuilderDisplayPieceLayouts<TPalette>(args: {
  displayWallPieces: CabinetBuilderWallPiece[];
  viewWidth: number;
  viewHeight: number;
  paddingX: number;
  paddingY: number;
  draft: CabinetBuilderDraft;
  tallCabHeight: string;
  baseCabHeight: string;
  footHeight: string;
  getRawWidth: (item: CabinetBuilderWallPiece) => number;
  getLaneRawWidth: (laneItems: CabinetBuilderWallPiece[]) => number;
  getHorizontalTrack: (item: CabinetBuilderWallPiece) => "top" | "bottom";
  getPalette: (item: CabinetBuilderWallPiece, draft: CabinetBuilderDraft) => TPalette;
}): Array<CabinetBuilderDisplayPieceWithPalette<TPalette>> {
  const {
    displayWallPieces,
    viewWidth,
    viewHeight,
    paddingX,
    paddingY,
    draft,
    tallCabHeight,
    baseCabHeight,
    footHeight,
    getRawWidth,
    getLaneRawWidth,
    getHorizontalTrack,
    getPalette,
  } = args;

  const rawPieceMetrics = displayWallPieces.map((item) => {
    const rawWidth = getRawWidth(item);
    const rawHeight = Math.max(1, Number.parseFloat(String(item.row.height || "").replace(/[^\d.-]/g, "")) || 720);
    const verticalBounds = getCabinetBuilderWallPieceVerticalBounds({
      item,
      rawHeight,
      wallPieces: displayWallPieces,
      tallCabHeight,
      baseCabHeight,
      footHeight,
    });
    return {
      item,
      rawWidth,
      rawHeight,
      rawTop: verticalBounds.top,
      rawBottom: verticalBounds.bottom,
    };
  });

  const lanePositions = Array.from(new Set(rawPieceMetrics.map((metric) => metric.item.position))).sort((a, b) => a - b);
  const topLaneRawWidths = new Map<number, number>();
  const bottomLaneRawWidths = new Map<number, number>();
  lanePositions.forEach((position) => {
    const laneMetrics = rawPieceMetrics.filter((metric) => metric.item.position === position);
    const topItems = laneMetrics.filter((metric) => getHorizontalTrack(metric.item) === "top").map((metric) => metric.item);
    const bottomItems = laneMetrics.filter((metric) => getHorizontalTrack(metric.item) === "bottom").map((metric) => metric.item);
    topLaneRawWidths.set(
      position,
      topItems.length ? topItems.reduce((maxWidth, item) => Math.max(maxWidth, getRawWidth(item)), 1) : 0,
    );
    bottomLaneRawWidths.set(position, bottomItems.length ? getLaneRawWidth(bottomItems) : 0);
  });

  const topTrackStepWidths = new Map<number, number>();
  const bottomTrackStepWidths = new Map<number, number>();
  lanePositions.forEach((position) => {
    const topWidth = topLaneRawWidths.get(position) || 0;
    const bottomWidth = bottomLaneRawWidths.get(position) || 0;
    topTrackStepWidths.set(position, topWidth > 0 ? topWidth : bottomWidth);
    bottomTrackStepWidths.set(position, bottomWidth);
  });

  const totalTopWidth = lanePositions.reduce((sum, position) => sum + (topTrackStepWidths.get(position) || 0), 0);
  const totalBottomWidth = lanePositions.reduce((sum, position) => sum + (bottomTrackStepWidths.get(position) || 0), 0);
  const totalWidth = Math.max(1, totalTopWidth, totalBottomWidth);
  const globalTop = Math.min(...rawPieceMetrics.map((metric) => metric.rawTop));
  const globalBottom = Math.max(...rawPieceMetrics.map((metric) => metric.rawBottom));
  const totalHeight = Math.max(1, globalBottom - globalTop);
  const scale = Math.min((viewWidth - paddingX * 2) / totalWidth, (viewHeight - paddingY * 2) / totalHeight);
  const originX = (viewWidth - totalWidth * scale) / 2;
  const originY = (viewHeight - totalHeight * scale) / 2;

  let currentTopLaneX = originX;
  let currentBottomLaneX = originX;
  const topLaneLayouts = new Map<number, { x: number; width: number }>();
  const bottomLaneLayouts = new Map<number, { x: number; width: number }>();
  lanePositions.forEach((position) => {
    const topLaneWidth = topLaneRawWidths.get(position) || 0;
    const bottomLaneWidth = bottomLaneRawWidths.get(position) || 0;
    topLaneLayouts.set(position, { x: currentTopLaneX, width: topLaneWidth * scale });
    bottomLaneLayouts.set(position, { x: currentBottomLaneX, width: bottomLaneWidth * scale });
    currentTopLaneX += (topTrackStepWidths.get(position) || 0) * scale;
    currentBottomLaneX += (bottomTrackStepWidths.get(position) || 0) * scale;
  });

  const defaultPieceLayouts = rawPieceMetrics.map((metric) => {
    const horizontalTrack = getHorizontalTrack(metric.item);
    const laneLayout =
      (horizontalTrack === "top" ? topLaneLayouts : bottomLaneLayouts).get(metric.item.position) ??
      { x: originX, width: metric.rawWidth * scale };
    const scaledPieceWidth = metric.rawWidth * scale;
    const laneRight = laneLayout.x + laneLayout.width;
    const anchoredToLeftEdge = metric.item.isMain || metric.item.side === "right";
    const anchoredToRightEdge = metric.item.side === "left";
    const resolvedX = anchoredToLeftEdge
      ? laneLayout.x
      : anchoredToRightEdge
        ? laneRight - scaledPieceWidth
        : laneLayout.x + (laneLayout.width - scaledPieceWidth) / 2;
    return {
      metric,
      horizontalTrack,
      laneLayout,
      scaledPieceWidth,
      resolvedX,
    };
  });

  const defaultPieceLayoutMap = new Map(defaultPieceLayouts.map((layout) => [layout.metric.item.id, layout]));

  const nearestPanelIdForLayout = (item: CabinetBuilderWallPiece) => {
    if (item.kind === "panel") return item.id;
    const panelLayouts = defaultPieceLayouts.filter((layout) => layout.metric.item.kind === "panel");
    if (!panelLayouts.length) return "";
    return (
      [...panelLayouts].sort(
        (a, b) =>
          Math.abs(Number(a.metric.item.position) - Number(item.position)) -
          Math.abs(Number(b.metric.item.position) - Number(item.position)),
      )[0]?.metric.item.id ?? ""
    );
  };

  const resolveDisplayAnchorPanelId = (item: CabinetBuilderWallPiece) => {
    let current: CabinetBuilderWallPiece | null = item;
    const visited = new Set<string>();
    while (current && current.parentWallId && !visited.has(current.parentWallId)) {
      visited.add(current.parentWallId);
      const parentLayout = defaultPieceLayoutMap.get(current.parentWallId);
      const parentItem = parentLayout?.metric.item ?? null;
      if (!parentItem) break;
      if (parentItem.kind === "panel") return parentItem.id;
      current = parentItem;
    }
    return nearestPanelIdForLayout(item);
  };

  const panelAnchoredXOverrides = new Map<string, number>();
  const panelAnchoredGroups = new Map<string, Array<(typeof defaultPieceLayouts)[number]>>();
  defaultPieceLayouts.forEach((layout) => {
    if (layout.metric.item.kind === "panel") return;
    const anchorPanelId = resolveDisplayAnchorPanelId(layout.metric.item);
    if (!anchorPanelId || !layout.metric.item.side) return;
    const parentLayout = defaultPieceLayoutMap.get(anchorPanelId);
    if (!parentLayout || parentLayout.metric.item.kind !== "panel") return;
    const groupKey = `${anchorPanelId}__${layout.metric.item.side}__${layout.horizontalTrack}`;
    const group = panelAnchoredGroups.get(groupKey) ?? [];
    group.push(layout);
    panelAnchoredGroups.set(groupKey, group);
  });

  panelAnchoredGroups.forEach((groupLayouts, groupKey) => {
    const [parentWallId, side] = groupKey.split("__");
    const parentLayout = defaultPieceLayoutMap.get(parentWallId);
    if (!parentLayout) return;
    const parentLeft = parentLayout.resolvedX;
    const parentRight = parentLeft + parentLayout.scaledPieceWidth;
    const orderedLayouts =
      side === "left"
        ? [...groupLayouts].sort((a, b) => b.metric.item.position - a.metric.item.position)
        : [...groupLayouts].sort((a, b) => a.metric.item.position - b.metric.item.position);
    let offset = 0;
    orderedLayouts.forEach((layout) => {
      const nextX =
        side === "left"
          ? parentLeft - offset - layout.scaledPieceWidth
          : parentRight + offset;
      panelAnchoredXOverrides.set(layout.metric.item.id, nextX);
      offset += layout.scaledPieceWidth;
    });
  });

  return defaultPieceLayouts.map((layout) => {
    const metric = layout.metric;
    const resolvedX = panelAnchoredXOverrides.get(metric.item.id) ?? layout.resolvedX;
    return {
      ...metric.item,
      rawWidth: metric.rawWidth,
      rawHeight: metric.rawHeight,
      x: resolvedX,
      y: originY + (metric.rawTop - globalTop) * scale,
      width: layout.scaledPieceWidth,
      height: (metric.rawBottom - metric.rawTop) * scale,
      scale,
      palette: getPalette(metric.item, draft),
    };
  });
}
