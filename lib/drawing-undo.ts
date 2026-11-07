// Undo in a Drawing with other people in it: a step only takes back what this person changed in it, onto the drawing as it is
// now, so everyone else's changes since stay. A piece someone else has changed since this step is left as they made it, and so
// is one that can't go without breaking theirs (they've run another piece off it): `skipped` says how many, for a warning.
// Redo is the same thing the other way round. Pure, for testing.

export type DrawingUndoState<I, E> = { items: I[]; extrusions: E[] };
type Row = { id: string };
type ItemRow = Row & { at?: { kind?: string; to?: string } };
type ExtrusionRow = Row & { anchor?: string };

// The same whatever order an object's fields are in.
function stableText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableText).join(",")}]`;
  if (value && typeof value === "object") {
    const fields = value as Record<string, unknown>;
    return `{${Object.keys(fields)
      .filter((key) => fields[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableText(fields[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
const same = (a: unknown, b: unknown) => stableText(a) === stableText(b);
const byId = <T extends Row>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));

// `current` with `step`'s change taken back, but for the ids in `held`.
function takenBack<T extends Row>(before: T[], after: T[], current: T[], held: Set<string>) {
  const beforeMap = byId(before);
  const afterMap = byId(after);
  const currentMap = byId(current);
  const conflicts = new Set<string>();
  const targets = new Map<string, T | undefined>();
  for (const id of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
    const was = beforeMap.get(id);
    const became = afterMap.get(id);
    if (same(was, became)) continue;
    const now = currentMap.get(id);
    // Already as it was before this step: nothing to do.
    if (same(now, was)) continue;
    // Not as this step left it: someone else has changed it since.
    if (!same(now, became) || held.has(id)) {
      conflicts.add(id);
      continue;
    }
    targets.set(id, was);
  }
  const rows: T[] = [];
  for (const row of current) {
    if (!targets.has(row.id)) rows.push(row);
    else {
      const target = targets.get(row.id);
      if (target) rows.push(target);
    }
  }
  // Pieces coming back: after the one they followed before.
  before.forEach((row, index) => {
    if (!targets.has(row.id) || currentMap.has(row.id)) return;
    let at = 0;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const found = rows.findIndex((other) => other.id === before[previous].id);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    rows.splice(at, 0, row);
  });
  // Only their order changed in this step.
  const orderOf = (list: T[]) => list.map((row) => row.id).join("\n");
  if (!targets.size && !conflicts.size && orderOf(before) !== orderOf(after) && orderOf(current) === orderOf(after)) {
    return { rows: [...before], conflicts, changed: true };
  }
  return { rows, conflicts, changed: targets.size > 0 };
}

export function undoDrawingStep<I extends ItemRow, E extends ExtrusionRow>(
  step: { before: DrawingUndoState<I, E>; after: DrawingUndoState<I, E> },
  current: DrawingUndoState<I, E>,
): { items: I[]; extrusions: E[]; changed: boolean; skipped: number } {
  const held = new Set<string>();
  // Taken back, then looked over: a piece going that something left behind is run off stays, and so does one coming back that's
  // run off something no longer there. Round again with those held, till nothing more needs holding.
  for (let round = 0; round <= current.items.length + step.before.items.length + 1; round += 1) {
    const items = takenBack(step.before.items, step.after.items, current.items, held);
    const extrusions = takenBack(step.before.extrusions, step.after.extrusions, current.extrusions, held);
    const here = new Set(items.rows.map((row) => row.id));
    const stillNeeded = new Set<string>();
    for (const row of items.rows) if (row.at?.kind === "attach" && row.at.to) stillNeeded.add(row.at.to);
    for (const row of extrusions.rows) if (row.anchor) stillNeeded.add(row.anchor);
    const hold: string[] = [];
    for (const row of current.items) if (!here.has(row.id) && stillNeeded.has(row.id)) hold.push(row.id);
    for (const row of items.rows) {
      const needs = row.at?.kind === "attach" ? row.at.to : "";
      if (needs && !here.has(needs) && !same(row, current.items.find((other) => other.id === row.id))) hold.push(row.id);
    }
    const fresh = hold.filter((id) => !held.has(id));
    if (!fresh.length) {
      return {
        items: items.rows,
        extrusions: extrusions.rows,
        changed: items.changed || extrusions.changed,
        skipped: items.conflicts.size + extrusions.conflicts.size,
      };
    }
    fresh.forEach((id) => held.add(id));
  }
  return { items: current.items, extrusions: current.extrusions, changed: false, skipped: held.size };
}
