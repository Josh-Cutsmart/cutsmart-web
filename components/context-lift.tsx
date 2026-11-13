"use client";

import { useEffect } from "react";

// Right-clicked, anywhere in the app — or a row's or card's ⋯ pressed (a phone's too): when one of the app's own menus opens
// from it, what it came from — its row, or its card (a Dashboard card, not the column it's in) — is magnified, lifted off
// the page, and the rest of the app darkens round it; the menu stays clear, over the dark, and comes off the lifted one
// rather than over it: under it (lined up with where it was right-clicked, or with the ⋯'s right), above it when there's
// no room under it, or beside it when neither fits — and placed again if it changes size (a sub-panel sliding in). A
// normal dropdown is left as it is. Back as the menu goes (or with Escape, a scroll or a resize).
// Clicked off while one of those menus is open: the menu just closes — the click doesn't go on to what it landed on.
// - The menus: role="menu" or data-hold-menu, there within a moment of a right-click the app took (the browser's own
//   menu kept away — defaultPrevented), or of a ⋯ (a button with lucide's ellipsis icon, or marked data-more-menu).
// - What lifts: the nearest data-context-lift, project card or row (data-project-actions), contact row, table row or
//   Dashboard column round what was right-clicked — nothing (no darkening either) if none, as in a drawing.
// - The lifted one is a copy of it over the dark sheet, bigger by CSS zoom (laid out bigger, so its text stays sharp — a
//   scaled one blurred), a table row's in a table of its own with the same column widths and the row's background, so the
//   whole row comes up with it. The page itself isn't touched. The menu's own layer is put over both.
// Mounted once (app/layout.tsx).

const MENU_SELECTOR = '[role="menu"], [data-hold-menu="true"]';
// A ⋯ button: lucide's Ellipsis / MoreHorizontal (or its upright one) in it, or one marked as such.
const MORE_BUTTON_ICON_SELECTOR = "svg.lucide-ellipsis, svg.lucide-ellipsis-vertical";
// Room kept round a menu put off the lifted one: from it, and from the screen's edges.
const MENU_GAP_PX = 6;
const SCREEN_EDGE_PX = 8;
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

// Where a menu came from: the pointer (a right-click), or a ⋯ — lined up with its right (alignEnd).
type MenuAnchor = { x: number; y: number; alignEnd?: boolean };
type LiftBox = { left: number; top: number; right: number; bottom: number };

function moreButtonOf(target: Element | null): HTMLElement | null {
  const button = target?.closest<HTMLElement>("button, [role='button']");
  if (!button) return null;
  return button.matches("[data-more-menu]") || button.querySelector(MORE_BUTTON_ICON_SELECTOR) ? button : null;
}

// The least height a menu's shrunk to, to fit under or above the lifted one (it scrolls).
const MIN_SHRUNK_MENU_PX = 140;

// Where a menu goes off the lifted one (box), its full height h: under it, else above it, else beside it (right, then left).
// None of those (a tall menu on a phone): in the bigger gap, under or above it, shrunk to fit and scrolling (`room`) —
// one that can scroll; one that can't, where it covers the least of it.
// (`side`: which side of it the menu's on — it opens out of its edge on that side.)
type MenuSide = "under" | "above" | "right" | "left";
function menuPlacementOff(
  box: LiftBox,
  anchor: MenuAnchor,
  w: number,
  h: number,
  scrollable: boolean,
): { left: number; top: number; side: MenuSide; room?: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(SCREEN_EDGE_PX, Math.min(x, vw - w - SCREEN_EDGE_PX));
  const clampY = (y: number) => Math.max(SCREEN_EDGE_PX, Math.min(y, vh - h - SCREEN_EDGE_PX));
  const alongX = clampX(anchor.alignEnd ? anchor.x - w : anchor.x);
  const underTop = box.bottom + MENU_GAP_PX;
  const roomUnder = vh - SCREEN_EDGE_PX - underTop;
  const roomAbove = box.top - MENU_GAP_PX - SCREEN_EDGE_PX;
  if (h <= roomUnder) return { left: alongX, top: underTop, side: "under" };
  if (h <= roomAbove) return { left: alongX, top: box.top - MENU_GAP_PX - h, side: "above" };
  if (box.right + MENU_GAP_PX + w <= vw - SCREEN_EDGE_PX) return { left: box.right + MENU_GAP_PX, top: clampY(anchor.y - 12), side: "right" };
  if (box.left - MENU_GAP_PX - w >= SCREEN_EDGE_PX) return { left: box.left - MENU_GAP_PX - w, top: clampY(anchor.y - 12), side: "left" };
  const under = roomUnder >= roomAbove;
  const room = Math.floor(Math.max(roomUnder, roomAbove));
  if (scrollable && room >= MIN_SHRUNK_MENU_PX) {
    return { left: alongX, top: under ? underTop : box.top - MENU_GAP_PX - room, side: under ? "under" : "above", room };
  }
  const topUnder = Math.min(underTop, vh - SCREEN_EDGE_PX - h);
  const topAbove = Math.max(SCREEN_EDGE_PX, box.top - MENU_GAP_PX - h);
  const overUnder = underTop - topUnder;
  const overAbove = topAbove + h - (box.top - MENU_GAP_PX);
  return overUnder <= overAbove ? { left: alongX, top: topUnder, side: "under" } : { left: alongX, top: topAbove, side: "above" };
}

export function ContextLift() {
  useEffect(() => {
    let lifted: {
      sheet: HTMLDivElement;
      holder: HTMLDivElement;
      raised: Array<{ el: HTMLElement; z: string }>;
      box: LiftBox;
      // (Each menu put off it, watched: put back if its own placing moves it, placed again if it changes size.)
      watchers: Array<MutationObserver | ResizeObserver>;
    } | null = null;
    // A menu of ours open from a right-click (lifted or not — a drawing's), watched till it's gone; and the click after a
    // press off it, kept from what's under it (clicked off: the menu just closes).
    let menuWatch = 0;
    let swallowClickUntil = 0;
    const menusNow = () => Array.from(document.querySelectorAll(MENU_SELECTOR));

    const release = () => {
      if (!lifted) return;
      const { sheet, holder, raised, watchers } = lifted;
      lifted = null;
      for (const watcher of watchers) watcher.disconnect();
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
      const holderLeft = seen.left - (width - seen.width) / 2;
      const holderTop = seen.top - (height - seen.height) / 2;
      lifted = { sheet, holder, raised, box: { left: holderLeft, top: holderTop, right: holderLeft + width, bottom: holderTop + height }, watchers: [] };
    };
    // Each menu (not one inside another — a sub-menu goes beside its own) put off the lifted one, where it fits.
    const placeMenusOff = (menus: Element[], anchor: MenuAnchor) => {
      const current = lifted;
      if (!current) return;
      for (const menu of menus) {
        if (!(menu instanceof HTMLElement) || menu.parentElement?.closest(MENU_SELECTOR)) continue;
        const position = getComputedStyle(menu).position;
        if (position !== "fixed" && position !== "absolute") continue;
        let applied = { left: Number.NaN, top: Number.NaN, maxHeight: "" };
        const scrollable = /(auto|scroll)/.test(getComputedStyle(menu).overflowY);
        const place = () => {
          if (lifted !== current || !menu.isConnected) return;
          // (Its full height — its content's, however much it's been shrunk.)
          const fullHeight = Math.max(menu.offsetHeight, menu.scrollHeight);
          const spot = menuPlacementOff(current.box, anchor, menu.offsetWidth, fullHeight, scrollable);
          // (In its own box's terms, when it's placed in one rather than on the screen.)
          const parent = position === "absolute" ? menu.offsetParent?.getBoundingClientRect() : null;
          const left = Math.round(spot.left - (parent?.left ?? 0));
          const top = Math.round(spot.top - (parent?.top ?? 0));
          // (Shrunk to the room it's given — told to a menu that sizes itself, data-lift-room, so it keeps to it.)
          const maxHeight = spot.room ? `${spot.room}px` : applied.maxHeight && !spot.room ? "" : menu.style.maxHeight;
          if (spot.room) menu.dataset.liftRoom = String(spot.room);
          else delete menu.dataset.liftRoom;
          applied = { left, top, maxHeight: spot.room ? `${spot.room}px` : "" };
          if (menu.style.left !== `${left}px`) menu.style.left = `${left}px`;
          if (menu.style.top !== `${top}px`) menu.style.top = `${top}px`;
          if (spot.room && menu.style.maxHeight !== maxHeight) menu.style.maxHeight = maxHeight;
          if (menu.style.right) menu.style.right = "auto";
          if (menu.style.bottom) menu.style.bottom = "auto";
          // (It opens out of its edge nearest the lifted one — its top under it, its bottom above it, its side beside it —
          // across from where it came from: .glass-menu-squeeze's transform-origin.)
          const across = Math.round(Math.min(menu.offsetWidth, Math.max(0, anchor.x - spot.left)));
          const down = Math.round(Math.min(menu.offsetHeight, Math.max(0, anchor.y - spot.top)));
          const origin =
            spot.side === "under" ? `${across}px 0%` : spot.side === "above" ? `${across}px 100%` : spot.side === "right" ? `0% ${down}px` : `100% ${down}px`;
          if (menu.style.transformOrigin !== origin) menu.style.transformOrigin = origin;
        };
        place();
        const moved = new MutationObserver(() => {
          if (
            menu.style.left !== `${applied.left}px` ||
            menu.style.top !== `${applied.top}px` ||
            (applied.maxHeight && menu.style.maxHeight !== applied.maxHeight)
          ) {
            place();
          }
        });
        moved.observe(menu, { attributes: true, attributeFilter: ["style"] });
        current.watchers.push(moved);
        if (typeof ResizeObserver !== "undefined") {
          const resized = new ResizeObserver(() => place());
          resized.observe(menu);
          current.watchers.push(resized);
        }
      }
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

    // A menu opening from `target` (a right-click, or a ⋯): watched for as the page changes, so it's lifted and put in place
    // before it's ever drawn where it opened — for a moment, then given up (nothing of ours opened).
    const awaitMenuFrom = (target: Element, anchor: MenuAnchor, ours: () => boolean) => {
      const before = new Set(menusNow());
      let done = false;
      let observer: MutationObserver | null = null;
      const finish = () => {
        done = true;
        observer?.disconnect();
      };
      const check = () => {
        if (done) return;
        if (!ours()) {
          finish();
          return;
        }
        const menus = menusNow();
        const appeared = menus.filter((menu) => !before.has(menu));
        // (A menu already open moved to this right-click — the same menu, somewhere else — counts too.)
        const opened = appeared.length ? appeared : lifted ? menus : [];
        if (!opened.length) return;
        finish();
        watchMenu();
        const el = target.closest<HTMLElement>(LIFT_SELECTOR);
        if (el && !el.closest(MENU_SELECTOR)) {
          lift(el, opened);
          placeMenusOff(opened, anchor);
        } else release();
      };
      observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true });
      window.setTimeout(check, 0);
      window.setTimeout(() => {
        check();
        finish();
      }, WAIT_FOR_MENU_MS);
    };
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(MENU_SELECTOR)) return;
      // (The keyboard's menu key has no pointer: from the start of what it's on.)
      const fromKeyboard = event.clientX === 0 && event.clientY === 0;
      const box = target.getBoundingClientRect();
      // (The browser's own menu: nothing of ours opened.)
      awaitMenuFrom(target, fromKeyboard ? { x: box.left, y: box.bottom } : { x: event.clientX, y: event.clientY }, () => event.defaultPrevented);
    };
    // A row's or card's ⋯ pressed (a computer's or a phone's): its menu off the lifted row or card, as a right-click's.
    const onMoreClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(MENU_SELECTOR)) return;
      const button = moreButtonOf(target);
      if (!button || !button.closest(LIFT_SELECTOR)) return;
      const box = button.getBoundingClientRect();
      awaitMenuFrom(button, { x: box.right, y: box.bottom, alignEnd: true }, () => true);
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
    // (Heard on the way in — a ⋯ keeps its press from going further up the page — and after onClick, so a press that just
    // closed a menu, swallowed there, doesn't open one.)
    window.addEventListener("click", onMoreClick, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", release);
    return () => {
      release();
      window.clearInterval(menuWatch);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("click", onMoreClick, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", release);
    };
  }, []);
  return null;
}
