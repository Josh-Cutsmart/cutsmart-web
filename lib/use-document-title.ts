"use client";

import { useLayoutEffect } from "react";

// A page's tab title from what it's loaded — what its layout's metadata can't know, as a project's name: "Smith Kitchen
// · CutSmart". Kept while the page is open: Next sets the layout's own title a moment after the page appears (and may
// again), so this puts its own back whenever that happens. Gone with the page — before the next page's title arrives.
// "" leaves the layout's.

// A title held for a moment instead (printing: the PDF's file name) — not put back meanwhile.
let heldTitle: string | null = null;
export function holdDocumentTitle(title: string): () => void {
  heldTitle = title;
  document.title = title;
  return () => {
    heldTitle = null;
  };
}

export function useDocumentTitle(title: string) {
  useLayoutEffect(() => {
    if (!title) return;
    const full = `${title} · CutSmart`;
    const apply = () => {
      if (heldTitle === null && document.title !== full) document.title = full;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
