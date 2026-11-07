"use client";

import { useEffect, useState } from "react";
import { subscribeCompanyJobsChanged } from "@/lib/firestore-data";

// A number that goes up each time one of the company's projects is added or changed, by anyone (a run of changes together
// counts as one) — for a page listing them to read them again: that costs nothing, as they're already kept up to date.
const SETTLE_MS = 400;

export function useCompanyJobsTick(companyId: string | null | undefined): number {
  const [tick, setTick] = useState(0);
  const cid = String(companyId || "").trim();
  useEffect(() => {
    if (!cid) return;
    let timer: number | null = null;
    const unsubscribe = subscribeCompanyJobsChanged(cid, () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        setTick((value) => value + 1);
      }, SETTLE_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [cid]);
  return tick;
}
