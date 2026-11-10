"use client";

import { useLayoutEffect, useRef } from "react";

// A drawer bank's fronts' green box (the Cutlist List's and the CNC Cutlist's): one outline drawn over all of the bank's
// rows, so it's the same 2px all the way round on any screen — the rows' own edges (borders or inset shadows) came out
// thicker or thinner side to side on a scaled screen, and borders at the sides widened the table's edges. A box straight
// under another sits up over its bottom edge: the line between them is one line, as thick as the rest.
// Put it in the bank's first row's first cell (position: relative), with every row of the bank marked
// data-bank-box-id={its bankGroupId}. It reaches across the table and down the bank's rows, measured, and again whenever
// the table or the rows change size.
export function BankBoxOutline({ bankId, underAnotherBox }: { bankId: string; underAnotherBox: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const outline = ref.current;
    const cell = outline?.parentElement;
    const firstRow = outline?.closest("tr");
    const table = outline?.closest("table");
    if (!outline || !cell || !firstRow || !table) return;
    const bankRows = () => {
      const rows: Element[] = [firstRow];
      for (let next = firstRow.nextElementSibling; next && next.getAttribute("data-bank-box-id") === bankId; next = next.nextElementSibling) {
        rows.push(next);
      }
      return rows;
    };
    const observer = new ResizeObserver(() => place());
    const place = () => {
      const rows = bankRows();
      const cellBox = cell.getBoundingClientRect();
      const tableBox = table.getBoundingClientRect();
      // (Under another box: its top edge laid exactly over that one's bottom edge.)
      const above = underAnotherBox ? firstRow.previousElementSibling : null;
      const top = above ? above.getBoundingClientRect().bottom - 2 : rows[0].getBoundingClientRect().top;
      const bottom = rows[rows.length - 1].getBoundingClientRect().bottom;
      outline.style.left = `${tableBox.left - cellBox.left}px`;
      outline.style.top = `${top - cellBox.top}px`;
      outline.style.width = `${tableBox.width}px`;
      outline.style.height = `${bottom - top}px`;
      // (The table's last rows, down at the bottom of its rounded card: its bottom corners rounded as the card's are, inside
      // its border.)
      const lastRow = rows[rows.length - 1];
      let cornerPx = 0;
      if (!lastRow.nextElementSibling && !lastRow.parentElement?.nextElementSibling) {
        for (let el = table.parentElement; el && el !== document.body; el = el.parentElement) {
          const style = getComputedStyle(el);
          const radius = Number.parseFloat(style.borderBottomLeftRadius) || 0;
          if (radius <= 0) continue;
          const borderPx = Number.parseFloat(style.borderBottomWidth) || 0;
          const flush = Math.abs(el.getBoundingClientRect().bottom - borderPx - bottom) < 2;
          if (flush) cornerPx = Math.max(0, radius - borderPx);
          break;
        }
      }
      outline.style.borderBottomLeftRadius = `${cornerPx}px`;
      outline.style.borderBottomRightRadius = `${cornerPx}px`;
      outline.style.visibility = "visible";
      for (const row of rows) observer.observe(row);
    };
    observer.observe(table);
    place();
    return () => observer.disconnect();
  }, [bankId, underAnotherBox]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute z-[3]"
      style={{ visibility: "hidden", border: "2px solid var(--success-strong)" }}
    />
  );
}
