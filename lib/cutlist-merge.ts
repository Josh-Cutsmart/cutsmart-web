// Two people in the same cutlist at once: what one person's save puts back is only what THEY changed — the rows they
// added, edited or deleted since they last had the cutlist from the database (`base`), applied onto the rows as they are
// now (`server`, with everyone else's changes in it). A row someone else changed, added or removed meanwhile stays as
// they left it. Both changing the same row: this save's version of it (the later one) wins, for that row only.
// Order: a reorder here (the rows both have, in a different order) is kept, with anyone else's new rows put in after
// the row they follow there; otherwise the order in the database, with the new rows from here after the row they follow
// here.
// Rows are told apart by `keyOf` (their stable key) and compared by `sigOf`. null when a list's keys aren't usable
// (a row without one, or two with the same) — the caller then saves its own rows as they are, as it always has.
export function mergeCutlistRows<T>(
  base: readonly T[],
  local: readonly T[],
  server: readonly T[],
  keyOf: (row: T) => string,
  sigOf: (row: T) => string,
): T[] | null {
  const byKey = (rows: readonly T[]) => {
    const map = new Map<string, T>();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key || map.has(key)) return null;
      map.set(key, row);
    }
    return map;
  };
  const baseMap = byKey(base);
  const localMap = byKey(local);
  const serverMap = byKey(server);
  if (!baseMap || !localMap || !serverMap) return null;

  const changedHere = (key: string) => {
    const localRow = localMap.get(key);
    const baseRow = baseMap.get(key);
    if (!localRow || !baseRow) return Boolean(localRow) !== Boolean(baseRow);
    return sigOf(localRow) !== sigOf(baseRow);
  };
  const kept = new Map<string, T>();
  for (const key of new Set([...serverMap.keys(), ...localMap.keys()])) {
    // Changed here: as it is here (a deletion here, gone). Else: as it is in the database (gone from it, gone).
    const row = changedHere(key) ? localMap.get(key) : serverMap.get(key);
    if (row !== undefined) kept.set(key, row);
  }

  const baseKeys = base.map(keyOf);
  const localKeys = local.map(keyOf);
  const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((key, idx) => key === b[idx]);
  const reorderedHere = !sameOrder(
    baseKeys.filter((key) => localMap.has(key)),
    localKeys.filter((key) => baseMap.has(key)),
  );
  const primary = reorderedHere ? localKeys : server.map(keyOf);
  const secondary = reorderedHere ? server.map(keyOf) : localKeys;
  const order = primary.filter((key) => kept.has(key));
  const placed = new Set(order);
  secondary.forEach((key, idx) => {
    if (placed.has(key) || !kept.has(key)) return;
    // After the nearest row before it (in the list it came from) that's already placed — else first.
    let at = 0;
    for (let prev = idx - 1; prev >= 0; prev -= 1) {
      const found = order.indexOf(secondary[prev]);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    order.splice(at, 0, key);
    placed.add(key);
  });
  return order.map((key) => kept.get(key) as T);
}

// The same, on the rows as stored (cutlistData/{kind} `rows`): keyed by `__cutlist_key` (`__id` on rows from before
// them), compared without `__id` — that's only the row's position, renumbered here once the order is settled.
const storedKeyOf = (row: unknown) => {
  const item = (row ?? {}) as Record<string, unknown>;
  return String(item.__cutlist_key ?? item.__id ?? "").trim();
};
const storedSigOf = (row: unknown) => {
  const { __id: _position, ...rest } = (row ?? {}) as Record<string, unknown>;
  void _position;
  return JSON.stringify(rest);
};
export function mergeStoredCutlistRows(base: readonly unknown[], local: readonly unknown[], server: readonly unknown[]): unknown[] | null {
  const merged = mergeCutlistRows(base, local, server, storedKeyOf, storedSigOf);
  if (!merged) return null;
  return merged.map((row, idx) => {
    const item = (row ?? {}) as Record<string, unknown>;
    // (Not on a row from before keys, where `__id` is the key itself.)
    return item.__cutlist_key != null && typeof item.__id === "number" ? { ...item, __id: idx + 1 } : item;
  });
}
