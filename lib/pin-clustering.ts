export interface ClusterablePin {
  id: string;
  xPct: number;
  yPct: number;
}

export interface PinCluster<T extends ClusterablePin> {
  clusterId: string;
  members: T[];
  centroidXPct: number;
  centroidYPct: number;
  isCluster: boolean;
}

function singleton<T extends ClusterablePin>(pin: T): PinCluster<T> {
  return {
    clusterId: pin.id,
    members: [pin],
    centroidXPct: pin.xPct,
    centroidYPct: pin.yPct,
    isCluster: false,
  };
}

/**
 * Groups pins into clusters using screen-pixel distance (transitive / union-find).
 * fittedWidth/fittedHeight = unzoomed rendered image box size (px). scale = current zoom.
 * Pan is intentionally NOT a parameter — it cancels out of pairwise deltas.
 */
export function clusterPins<T extends ClusterablePin>(
  pins: T[],
  fittedWidth: number,
  fittedHeight: number,
  scale: number,
  thresholdPx = 30,
): PinCluster<T>[] {
  const n = pins.length;
  if (n === 0) return [];
  if (!(fittedWidth > 0) || !(fittedHeight > 0) || !(scale > 0)) {
    return pins.map((pin) => singleton(pin));
  }

  const fx = pins.map((pin) => (pin.xPct / 100) * fittedWidth);
  const fy = pins.map((pin) => (pin.yPct / 100) * fittedHeight);

  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else {
      parent[rb] = ra;
      rank[ra] += 1;
    }
  };

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = (fx[i] - fx[j]) * scale;
      const dy = (fy[i] - fy[j]) * scale;
      if (Math.sqrt(dx * dx + dy * dy) <= thresholdPx) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(i);
    else groups.set(root, [i]);
  }

  const result: PinCluster<T>[] = [];
  for (const indices of groups.values()) {
    const members = indices.map((i) => pins[i]);
    if (members.length === 1) {
      result.push(singleton(members[0]));
      continue;
    }
    const sortedIds = members.map((m) => m.id).slice().sort();
    const centroidXPct = members.reduce((sum, m) => sum + m.xPct, 0) / members.length;
    const centroidYPct = members.reduce((sum, m) => sum + m.yPct, 0) / members.length;
    result.push({
      clusterId: `cluster:${sortedIds.join(",")}`,
      members,
      centroidXPct,
      centroidYPct,
      isCluster: true,
    });
  }
  return result;
}

/** Finds the cluster (isCluster: true) currently containing a given pin id, if any. */
export function findClusterContainingPin<T extends ClusterablePin>(
  clusters: PinCluster<T>[],
  pinId: string,
): PinCluster<T> | undefined {
  return clusters.find((cluster) => cluster.isCluster && cluster.members.some((m) => m.id === pinId));
}

/**
 * Spreads a cluster's members evenly around its centroid in a small screen-space
 * circle (radius stays a constant SCREEN size regardless of zoom, by dividing the
 * screen radius by `scale` before converting to percent). Display-only — never
 * persist these coordinates.
 */
export function computeSpreadPositions<T extends ClusterablePin>(
  cluster: PinCluster<T>,
  fittedWidth: number,
  fittedHeight: number,
  scale: number,
  spreadRadiusPx = 22,
): Array<{ id: string; xPct: number; yPct: number }> {
  const members = cluster.members;
  const n = members.length;
  if (n <= 1 || !(fittedWidth > 0) || !(fittedHeight > 0) || !(scale > 0)) {
    return members.map((m) => ({ id: m.id, xPct: m.xPct, yPct: m.yPct }));
  }
  const centroidFx = (cluster.centroidXPct / 100) * fittedWidth;
  const centroidFy = (cluster.centroidYPct / 100) * fittedHeight;
  const radiusFittedPx = spreadRadiusPx / scale;
  return members.map((m, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const fxp = centroidFx + radiusFittedPx * Math.cos(angle);
    const fyp = centroidFy + radiusFittedPx * Math.sin(angle);
    return {
      id: m.id,
      xPct: Math.min(100, Math.max(0, (fxp / fittedWidth) * 100)),
      yPct: Math.min(100, Math.max(0, (fyp / fittedHeight) * 100)),
    };
  });
}
