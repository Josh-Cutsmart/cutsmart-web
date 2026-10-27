"use client";

import dynamic from "next/dynamic";
import { Skeleton, SkeletonGroup } from "@/components/skeleton";

// specs-grid-editor.tsx is one of the biggest client components in the app, and it's only shown on
// the Specs/Quote sheet views and Company Settings' template builders — so it gets its own chunk,
// fetched the first time one of those opens instead of shipping in those pages' initial bundles.
const SpecsGridEditor = dynamic(() => import("@/components/specs-grid-editor"), {
  ssr: false,
  loading: () => (
    <SkeletonGroup label="Loading the editor" className="space-y-2 py-4">
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="grid grid-cols-[1fr_2fr] gap-2">
          <Skeleton className="h-8 rounded-[8px]" />
          <Skeleton className="h-8 rounded-[8px]" />
        </div>
      ))}
    </SkeletonGroup>
  ),
});

// Starts fetching that same chunk ahead of time (e.g. once the tab that leads to the editor opens),
// so it's usually ready by the time the editor is actually shown.
export function preloadSpecsGridEditor() {
  import("@/components/specs-grid-editor").catch(() => {
    // Nothing to do here — the editor's own load above fetches it again when it actually mounts.
  });
}

export default SpecsGridEditor;
