"use client";

import { useEffect } from "react";

// Right-clicked, anywhere in the app: when one of the app's own menus opens from it, what was right-clicked — its row, or
// its card (a Dashboard card, not the column it's in) — is magnified, lifted off the page, and the rest of the app darkens
// round it; the menu stays clear, over the dark. Back as the menu goes (or with Escape, a scroll or a resize).
// Clicked off while one of those menus is open: the menu just closes — the click doesn't go on to what it landed on.
// - The menus: role="menu" or data-hold-menu, there within a moment of a right-click the app took (the browser's own
//   menu kept away — defaultPrevented).
// - What lifts: the nearest data-context-lift, project card or row (data-project-actions), contact row, table row or
//   Dashboard column round what was right-clicked — nothing (no darkening either) if none, as in a drawing.
// - The lifted one is a copy of it over the dark sheet, bigger by CSS zoom (laid out bigger, so its text stays sharp — a
//   scaled one blurred), a table row's in a table of its own with the same column widths and the row's background, so the
//   whole row comes up with it. The page itself isn't touched. The menu's own layer is put over both.
// Mounted once (app/layout.tsx).

const MENU_SELECTOR = '[role="menu"], [data-hold-menu="true"]';
const LIFT_SELECTOR = "[data-context-lift], [data-project-actions], [data-contact-row-id], tr, [data-automation-board]";
const SHEET_Z = 2147483000;
// How long a menu has to turn up after the right-click, and how often a lifted one checks its menu's still there.
const WAIT_FOR_MENU_MS = 400;
const POLL_MS = 120;
// How much bigger it comes up.
const MAGNIFY = 1.04;

// The part of it that can be seen: its box cut down by every box round it that clips (a table scrolled sideways, a list
// scrolled up), and the screen.
function visibleBox(el: Element, rect: DOMRect) {
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right);
  let bottom = Math.min(window.innerHeight, rect.bottom);
  for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
    const style = getComputedStyle(at);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const box = at.getBoundingClientRect();
    if (style.overflowX !== "visible") {
      left = Math.max(left, box.left);
      right = Math.min(right, box.right);
    }
    if (style.overflowY !== "visible") {
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

// A computed colour as [r, g, b, a] (0–255, alpha 0–1): rgb()/rgba(), either syntax, or color(srgb …) (a color-mix's).
function parseColor(text: string): [number, number, number, number] | null {
  const srgb = text.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] === undefined ? 1 : Number(srgb[4])];
  const rgb = text.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\)/);
  if (!rgb) return null;
  const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number(rgb[4]);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
}

// What colour it shows as where it is: its own background over everything see-through under it, down to the first that
// isn't — so a glass card taken out of its column still looks as it did in it.
function backgroundAsSeen(el: Element): string {
  const layers: Array<[number, number, number, number]> = [];
  for (let at: Element | null = el; at; at = at.parentElement) {
    const color = parseColor(getComputedStyle(at).backgroundColor);
    if (!color || color[3] <= 0) continue;
    layers.push(color);
    if (color[3] >= 1) break;
  }
  let [r, g, b] = [255, 255, 255];
  for (const [lr, lg, lb, la] of layers.reverse()) {
    r = lr * la + r * (1 - la);
    g = lg * la + g * (1 - la);
    b = lb * la + b * (1 - la);
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

// Every custom property the app's styles use (--…), read once: a copy out of its place carries their values from where it
// was, as its colours and sizes come from some of them (a column's own, a theme's).
let customPropertyNames: string[] | null = null;
function allCustomPropertyNames(): string[] {
  if (customPropertyNames) return customPropertyNames;
  const names = new Set<string>();
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        for (let index = 0; index < rule.style.length; index += 1) {
          const name = rule.style[index];
          if (name.startsWith("--")) names.add(name);
        }
      }
      const inner = (rule as CSSGroupingRule).cssRules;
      if (inner) walk(inner);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // (Another site's sheet: not readable.)
    }
  }
  customPropertyNames = Array.from(names);
  return customPropertyNames;
}

// A copy of it to lift: a row in a table of its own (each cell as wide as it is there), anything else as it is.
function liftCopy(el: HTMLElement, rect: DOMRect): HTMLElement {
  let copy: HTMLElement;
  if (el.tagName === "TR") {
    const table = document.createElement("table");
    table.className = el.closest("table")?.className ?? "";
    Object.assign(table.style, { borderCollapse: "collapse", tableLayout: "fixed", width: `${rect.width}px`, margin: "0" });
    const body = document.createElement("tbody");
    const row = el.cloneNode(true) as HTMLElement;
    const cells = Array.from(el.children) as HTMLElement[];
    Array.from(row.children).forEach((cell, index) => {
      const width = cells[index]?.getBoundingClientRect().width;
      if (width) (cell as HTMLElement).style.width = `${width}px`;
      cell.removeAttribute("rowspan");
    });
    row.style.height = `${rect.height}px`;
    row.style.backgroundColor = backgroundAsSeen(el);
    body.appendChild(row);
    table.appendChild(body);
    copy = table;
  } else {
    copy = el.cloneNode(true) as HTMLElement;
    Object.assign(copy.style, {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      // (Its own positioning kept — what's placed inside it stays inside it — but not out of the flow.)
      position: getComputedStyle(el).position === "static" ? "static" : "relative",
      transform: "none",
      translate: "none",
      scale: "none",
      backgroundColor: backgroundAsSeen(el),
    });
  }
  copy.removeAttribute("id");
  copy.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  // (What it would have had from round it: the custom properties its styles use, and its text's look.)
  const style = getComputedStyle(el);
  for (const name of allCustomPropertyNames()) {
    const value = style.getPropertyValue(name);
    if (value) copy.style.setProperty(name, value);
  }
  // (Its line height as a proportion of its text's size, as it's handed down to what's in it — a fixed one made every line
  // in a card taller, spilling out of it.)
  const fontPx = Number.parseFloat(style.fontSize) || 16;
  const linePx = Number.parseFloat(style.lineHeight);
  Object.assign(copy.style, {
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    letterSpacing: style.letterSpacing,
    textTransform: style.textTransform,
    textAlign: style.textAlign,
    whiteSpace: style.whiteSpace,
    wordBreak: style.wordBreak,
    overflowWrap: style.overflowWrap,
    lineHeight: Number.isFinite(linePx) ? String(Math.round((linePx / fontPx) * 1000) / 1000) : "normal",
  });
  return copy;
}

export function ContextLift() {
  useEffect(() => {
    let lifted: { sheet: HTMLDivElement; holder: HTMLDivElement; raised: Array<{ el: HTMLElement; z: string }> } | null = null;
    // A menu of ours open from a right-click (lifted or not — a drawing's), watched till it's gone; and the click after a
    // press off it, kept from what's under it (clicked off: the menu just closes).
    let menuWatch = 0;
    let swallowClickUntil = 0;
    const menusNow = () => Array.from(document.querySelectorAll(MENU_SELECTOR));

    const release = () => {
      if (!lifted) return;
      const { sheet, holder, raised } = lifted;
      lifted = null;
      for (const item of raised) item.el.style.zIndex = item.z;
      sheet.setAttribute("data-leaving", "true");
      holder.setAttribute("data-leaving", "true");
      // (Once it's slid back down into its place — globals.css.)
      window.setTimeout(() => {
        sheet.remove();
        holder.remove();
      }, 260);
    };

    const lift = (el: HTMLElement, menus: Element[]) => {
      release();
      const rect = el.getBoundingClientRect();
      const seen = visibleBox(el, rect);
      if (!seen.width || !seen.height) return;
      // Magnified round the middle of what can be seen of it (only that part of it comes up).
      const zoom = MAGNIFY;
      const width = seen.width * zoom;
      const height = seen.height * zoom;
      const radiusPx = el.tagName === "TR" ? 0 : Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const sheet = document.createElement("div");
      sheet.setAttribute("aria-hidden", "true");
      sheet.className = "context-lift-sheet";
      sheet.style.zIndex = String(SHEET_Z);
      const holder = document.createElement("div");
      holder.setAttribute("aria-hidden", "true");
      holder.className = "context-lift-copy";
      const copy = liftCopy(el, rect);
      // (Zoomed, so its margins are too: these put the part that can be seen at the holder's corner.)
      Object.assign(copy.style, {
        zoom: String(zoom),
        marginLeft: `${rect.left - seen.left}px`,
        marginTop: `${rect.top - seen.top}px`,
      });
      holder.appendChild(copy);
      Object.assign(holder.style, {
        left: `${seen.left - (width - seen.width) / 2}px`,
        top: `${seen.top - (height - seen.height) / 2}px`,
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: `${radiusPx * zoom}px`,
        zIndex: String(SHEET_Z + 1),
      });
      // (It grows out of its own size, and slides back down to it — globals.css. A custom property: setProperty, as a key
      // on the style it's dropped.)
      holder.style.setProperty("--lift-from", String(1 / zoom));
      document.body.appendChild(sheet);
      document.body.appendChild(holder);
      // (Each menu's top layer — the portal it's in, on the body — over both, if it isn't already.)
      const raised: Array<{ el: HTMLElement; z: string }> = [];
      for (const menu of menus) {
        let top = menu as HTMLElement;
        while (top.parentElement && top.parentElement !== document.body) top = top.parentElement;
        const z = Number.parseInt(getComputedStyle(top).zIndex, 10);
        if (!(z > SHEET_Z + 1)) {
          raised.push({ el: top, z: top.style.zIndex });
          top.style.zIndex = String(SHEET_Z + 2);
        }
      }
      lifted = { sheet, holder, raised };
    };
    const watchMenu = () => {
      if (menuWatch) return;
      menuWatch = window.setInterval(() => {
        if (menusNow().length) return;
        window.clearInterval(menuWatch);
        menuWatch = 0;
        release();
      }, POLL_MS);
    };

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(MENU_SELECTOR)) return;
      const before = new Set(menusNow());
      const startedAt = Date.now();
      const check = () => {
        // (The browser's own menu: nothing of ours opened.)
        if (!event.defaultPrevented) return;
        const menus = menusNow();
        const appeared = menus.filter((menu) => !before.has(menu));
        // (A menu already open moved to this right-click — the same menu, somewhere else — counts too.)
        const opened = appeared.length ? appeared : lifted ? menus : [];
        if (opened.length) {
          watchMenu();
          const el = target.closest<HTMLElement>(LIFT_SELECTOR);
          if (el && !el.closest(MENU_SELECTOR)) lift(el, opened);
          else release();
          return;
        }
        if (Date.now() - startedAt < WAIT_FOR_MENU_MS) window.setTimeout(check, 30);
      };
      window.setTimeout(check, 0);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") release();
    };
    // (Clicked off — anywhere but its menu: back down straight away, as the menu goes, and the click itself kept from what
    // it landed on. Another right-click just moves the menu.)
    const onPointerDown = (event: PointerEvent) => {
      if (!menuWatch || event.button === 2) return;
      if (event.target instanceof Element && event.target.closest(MENU_SELECTOR)) return;
      swallowClickUntil = Date.now() + 800;
      release();
    };
    const onClick = (event: MouseEvent) => {
      if (Date.now() > swallowClickUntil) return;
      swallowClickUntil = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(MENU_SELECTOR)) return;
      release();
    };
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", release);
    return () => {
      release();
      window.clearInterval(menuWatch);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", release);
    };
  }, []);
  return null;
}
