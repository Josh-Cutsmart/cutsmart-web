"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

// The project page's code — it's big (about 360 KB to download, then to compile) — fetched ahead, once the app's been
// open a few quiet seconds, so the first project opened doesn't wait on it. Once a visit; not where the phone's been
// asked to save data, and not when a project was what opened (it's here already).
const WARM_AFTER_MS = 4000;
let warmed = false;

export function WarmProjectPage() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (pathname.startsWith("/projects/")) warmed = true;
    if (warmed) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const timer = setTimeout(() => {
      warmed = true;
      // A full prefetch: for a page like this one the usual one is just its outline, which doesn't bring its code.
      router.prefetch("/projects/_", { kind: "full" as PrefetchKind });
    }, WARM_AFTER_MS);
    return () => clearTimeout(timer);
  }, [pathname, router]);
  return null;
}
