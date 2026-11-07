import type { SpecsGrid, SpecsRow } from "@/lib/specs-grid-types";

// Two people in the same Quote or Specifications sheet at once: what this person changed since they last had the sheet from
// the database (`base`) put onto the sheet as it is now (`server`), cell by cell. A cell someone else changed stays as they
// left it; both changing the same cell, this person's (the later) wins, for that cell only.
// Rows and columns added, removed or moved: a group's bounds are row positions, so the layout comes whole from whichever of
// the two changed it, with the other's changes to the cells in rows they both still have. Both changed it at once: this
// person's layout. A brand new sheet with nothing to compare with: this person's.

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const layoutOf = (grid: SpecsGrid) => `${grid.rows.map((row) => row.id).join("\n")}|${grid.columnWidths.length}`;

function mergedRow(base: SpecsRow, local: SpecsRow, server: SpecsRow, layoutRow: SpecsRow): SpecsRow {
  if (base.cells.length !== local.cells.length || base.cells.length !== server.cells.length) return layoutRow;
  return {
    ...server,
    heightPx: local.heightPx !== base.heightPx ? local.heightPx : server.heightPx,
    cells: server.cells.map((cell, index) => (same(local.cells[index], base.cells[index]) ? cell : local.cells[index])),
  };
}

export function mergeSpecsGrids(base: SpecsGrid | null, local: SpecsGrid, server: SpecsGrid): SpecsGrid {
  if (!base) return local;
  if (same(local, server)) return local;
  if (same(base, local)) return server;
  if (same(base, server)) return local;

  const layout = layoutOf(server) !== layoutOf(base) && layoutOf(local) === layoutOf(base) ? server : local;
  const byId = (rows: SpecsRow[]) => new Map(rows.map((row) => [row.id, row]));
  const baseRows = byId(base.rows);
  const localRows = byId(local.rows);
  const serverRows = byId(server.rows);
  const rows = layout.rows.map((row) => {
    const b = baseRows.get(row.id);
    const l = localRows.get(row.id);
    const s = serverRows.get(row.id);
    return b && l && s ? mergedRow(b, l, s, row) : row;
  });

  // A group's own settings (shown or hidden, its price...) as whichever of them changed each; its bounds with the layout.
  const groupById = <T extends { id: string }>(groups: T[] | undefined) => new Map((groups ?? []).map((group) => [group.id, group]));
  const baseGroups = groupById(base.groups);
  const localGroups = groupById(local.groups);
  const serverGroups = groupById(server.groups);
  const groups = layout.groups.map((group) => {
    const b = baseGroups.get(group.id) as Record<string, unknown> | undefined;
    const l = localGroups.get(group.id) as Record<string, unknown> | undefined;
    const s = serverGroups.get(group.id) as Record<string, unknown> | undefined;
    if (!b || !l || !s) return group;
    const merged: Record<string, unknown> = { ...s };
    for (const key of new Set([...Object.keys(l), ...Object.keys(s), ...Object.keys(b)])) {
      if (!same(l[key], b[key])) merged[key] = l[key];
    }
    return { ...(merged as typeof group), startRow: group.startRow, endRow: group.endRow };
  });

  return {
    pageSize: local.pageSize !== base.pageSize ? local.pageSize : server.pageSize,
    columnWidths:
      local.columnWidths.length === server.columnWidths.length
        ? same(local.columnWidths, base.columnWidths)
          ? server.columnWidths
          : local.columnWidths
        : layout.columnWidths,
    rows,
    groups,
    deletedGroups: same(local.deletedGroups, base.deletedGroups) ? server.deletedGroups : local.deletedGroups,
  };
}
