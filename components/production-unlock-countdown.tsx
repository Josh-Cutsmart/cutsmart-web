"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getProductionUnlockRemainingSeconds } from "@/lib/permissions";
import type { Project } from "@/lib/types";

export function formatProductionUnlockRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) {
    return `${s}s`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h <= 0) {
    return `${Math.max(1, m)}m`;
  }
  return `${h}h ${m}m`;
}

type ProductionUnlockCountdownProps = {
  project: Project | null;
  uid?: string;
  // Only called while that user's temporary production unlock is still running, with the time
  // left already formatted ("45s", "12m", "5h 3m"). Renders nothing once it has run out.
  children: (label: string) => ReactNode;
  // Fires after the label changes (including appearing/disappearing), for a parent that has to
  // re-measure something laid out around it.
  onLabelChange?: () => void;
};

// Refreshes itself every 15s, so a running unlock only re-renders this little countdown instead of
// the whole project page around it just to keep the time left current.
export function ProductionUnlockCountdown({ project, uid, children, onLabelChange }: ProductionUnlockCountdownProps) {
  // Only bumped to trigger a re-render; the time left is read fresh from the clock every render.
  const [, setTick] = useState(0);
  const remainingSeconds = getProductionUnlockRemainingSeconds(project, uid);
  const isActive = remainingSeconds > 0;
  const label = isActive ? formatProductionUnlockRemaining(remainingSeconds) : "";

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => {
      setTick((v) => v + 1);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  const onLabelChangeRef = useRef(onLabelChange);
  useLayoutEffect(() => {
    onLabelChangeRef.current = onLabelChange;
  });
  useLayoutEffect(() => {
    onLabelChangeRef.current?.();
  }, [label]);

  return isActive ? <>{children(label)}</> : null;
}
