import { mergeCutlistRows } from "@/lib/cutlist-merge";

// Two people in the same Drawing at once: what this person changed since they last had it from the database (`base`) put
// onto it as it is now (`server`). Cabinets, panels and bench extrusions are told apart by their ids, so someone else's
// additions, moves and removals stay. Both changing the same one: this person's (the later) wins, for that one only. The
// pieces left off and the bench's settings, by their own keys, the same way. Nothing to compare with (none saved when it was
// opened): everything in both is kept, so one person starting it at the same moment doesn't wipe the other's.

type DrawingData = Record<string, unknown>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const listOf = (data: DrawingData, key: string) => (Array.isArray(data[key]) ? (data[key] as unknown[]) : []);
const mapOf = (data: DrawingData, key: string) => {
  const value = data[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
};

function mergedList(base: DrawingData, local: DrawingData, server: DrawingData, key: string): unknown[] {
  const idOf = (row: unknown) => String((row as { id?: unknown } | null)?.id ?? "");
  return mergeCutlistRows(listOf(base, key), listOf(local, key), listOf(server, key), idOf, (row) => JSON.stringify(row)) ?? listOf(local, key);
}

function mergedMap(base: DrawingData, local: DrawingData, server: DrawingData, key: string): Record<string, unknown> {
  const b = mapOf(base, key);
  const l = mapOf(local, key);
  const s = mapOf(server, key);
  const out: Record<string, unknown> = { ...s };
  for (const name of new Set([...Object.keys(b), ...Object.keys(l)])) {
    if (same(l[name], b[name])) continue;
    if (name in l) out[name] = l[name];
    else delete out[name];
  }
  return out;
}

export function mergeKitchenDrawing<T extends DrawingData>(baseOrNone: DrawingData | null, local: T, server: DrawingData): T {
  const base = baseOrNone ?? {};
  if (same(local, server) || same(base, server)) return local;
  if (same(base, local)) return server as T;
  return {
    ...local,
    items: mergedList(base, local, server, "items"),
    off: mergedMap(base, local, server, "off"),
    bench: mergedMap(base, local, server, "bench"),
    extrusions: mergedList(base, local, server, "extrusions"),
  };
}
