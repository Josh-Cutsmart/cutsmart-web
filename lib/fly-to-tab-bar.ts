"use client";

// A project opened from a list: a copy of what was clicked lifts off, slides up turning into its tab — a copy of the real
// tab, so it ends looking exactly as the tab does — and bounces onto the tab bar, where the real one takes over. Its page
// opens straight away, underneath. So drawn straight on the page's body, not by React, to carry on through the move to
// that page; and all transform and opacity, so that page's loading can't make it stutter.

// How long it takes to reach the bar, and to bounce there.
const RISE_MS = 280;
const BOUNCE_MS = 280;

let stopFlying: (() => void) | null = null;

const place = (el: HTMLElement, style: Partial<CSSStyleDeclaration>) => Object.assign(el.style, style);

// Sends it off, for the tab `groupKey` — which is to go on the bar right after this is called (kept hidden till it lands).
// `onOff`: once it's on its way (straight away if it isn't being flown, with reduced motion).
export function flyToTabBar(source: HTMLElement, groupKey: string, onOff: () => void): void {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    onOff();
    return;
  }
  stopFlying?.();
  const from = source.getBoundingClientRect();
  const tabSelector = `[data-app-tab-group="${CSS.escape(groupKey)}"]`;

  // (Hidden, not faded: a fade on a tab leaves stray pixels round it — see globals.css.)
  const hideTab = document.createElement("style");
  hideTab.textContent = `${tabSelector} { visibility: hidden !important; }`;
  document.head.append(hideTab);

  // Across and up on their own, so it curves up to the bar.
  const across = document.createElement("div");
  const up = document.createElement("div");
  across.setAttribute("aria-hidden", "true");
  place(across, { position: "fixed", left: "0", top: "0", width: "0", height: "0", zIndex: "3000", pointerEvents: "none", willChange: "transform" });
  place(up, { position: "absolute", left: "0", top: "0", width: "0", height: "0", willChange: "transform" });

  // What was clicked, where it is, for now.
  const card = source.cloneNode(true) as HTMLElement;
  card.removeAttribute("id");
  card.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  place(card, {
    position: "absolute",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: "0",
    transform: "none",
    animation: "none",
    transition: "none",
    opacity: "1",
    willChange: "transform, opacity",
  });
  up.append(card);
  across.append(up);
  document.body.append(across);

  let finishTimer = 0;
  const stop = () => {
    window.clearTimeout(finishTimer);
    hideTab.remove();
    across.remove();
    if (stopFlying === stop) stopFlying = null;
  };
  stopFlying = stop;

  // The tab's on the bar by the next frame or two — it's where this is headed, and what it turns into.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (stopFlying !== stop) {
        onOff();
        return;
      }
      const tab = document.querySelector<HTMLElement>(tabSelector);
      const to = tab?.getBoundingClientRect();
      if (!tab || !to?.width) {
        stop();
        onOff();
        return;
      }

      // The tab, as it is when it's open (the open one's colours, as this one's only opening yet).
      const open = document.querySelector<HTMLElement>('[data-app-top-tab][data-active="true"]');
      const openLabel = open?.querySelector<HTMLElement>("button");
      const copy = tab.cloneNode(true) as HTMLElement;
      copy.removeAttribute("data-app-tab-group");
      copy.removeAttribute("draggable");
      copy.setAttribute("data-active", "true");
      place(copy, {
        position: "absolute",
        left: "0",
        top: "0",
        width: `${to.width}px`,
        height: `${to.height}px`,
        minWidth: "0",
        maxWidth: "none",
        margin: "0",
        transform: "none",
        transition: "none",
        visibility: "visible",
      });
      if (open) {
        const openStyle = getComputedStyle(open);
        place(copy, { backgroundColor: openStyle.backgroundColor, boxShadow: openStyle.boxShadow });
      }
      const copyLabel = copy.querySelector<HTMLElement>("button");
      if (openLabel && copyLabel) copyLabel.style.color = getComputedStyle(openLabel).color;

      // A solid backing and a shadow under it while it's in the air (the tab's see-through), gone as it lands.
      const shadow = document.createElement("div");
      place(shadow, { position: "absolute", inset: "0", borderRadius: "18px", backgroundColor: "var(--panel-bg)", boxShadow: "0 12px 28px rgba(15, 23, 42, 0.3)", willChange: "opacity" });

      // From the card's middle, at the card's size, to the tab's size.
      const fromX = from.left + from.width / 2;
      const fromY = from.top + from.height / 2;
      const moveX = to.left + to.width / 2 - fromX;
      const moveY = to.top + to.height / 2 - fromY;
      const scaleX = from.width / to.width;
      const scaleY = from.height / to.height;
      const pill = document.createElement("div");
      place(pill, {
        position: "absolute",
        left: `${fromX - to.width / 2}px`,
        top: `${fromY - to.height / 2}px`,
        width: `${to.width}px`,
        height: `${to.height}px`,
        willChange: "transform, opacity",
      });
      pill.append(shadow, copy);
      up.append(pill);

      const total = RISE_MS + BOUNCE_MS;
      const landed = RISE_MS / total;
      const bouncing = BOUNCE_MS / total;
      const off = "cubic-bezier(0.3, 0.2, 0.2, 1)";
      across.animate([{ transform: "translateX(0)" }, { transform: `translateX(${moveX}px)` }], { duration: RISE_MS, easing: "cubic-bezier(0.4, 0, 0.3, 1)", fill: "forwards" });
      // Past the bar, back down against it, and settling.
      const flight = up.animate(
        [
          { offset: 0, transform: "translateY(0)", easing: off },
          { offset: landed, transform: `translateY(${moveY - 6}px)`, easing: "ease-in" },
          { offset: landed + bouncing * 0.32, transform: `translateY(${moveY + 2}px)`, easing: "ease-out" },
          { offset: landed + bouncing * 0.6, transform: `translateY(${moveY - 2}px)`, easing: "ease-in-out" },
          { offset: 1, transform: `translateY(${moveY}px)` },
        ],
        { duration: total, fill: "forwards" },
      );
      pill.animate(
        [
          { offset: 0, transform: `scale(${scaleX}, ${scaleY})`, easing: off },
          { offset: landed, transform: "scale(1)", easing: "ease-in" },
          { offset: landed + bouncing * 0.32, transform: "scale(1.07, 0.88)", easing: "ease-out" },
          { offset: landed + bouncing * 0.6, transform: "scale(0.98, 1.04)", easing: "ease-in-out" },
          { offset: 1, transform: "scale(1)" },
        ],
        { duration: total, fill: "forwards" },
      );
      card.animate([{ transform: "scale(1)" }, { transform: `scale(${1 / scaleX}, ${1 / scaleY})` }], { duration: RISE_MS, easing: off, fill: "forwards" });
      card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: RISE_MS * 0.35, delay: RISE_MS * 0.2, easing: "ease-out", fill: "both" });
      pill.animate([{ opacity: 0 }, { opacity: 1 }], { duration: RISE_MS * 0.35, delay: RISE_MS * 0.05, easing: "ease-out", fill: "both" });
      shadow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: BOUNCE_MS * 0.5, delay: RISE_MS, easing: "ease-out", fill: "both" });

      // Landed and settled: it looks just as the real tab does, which takes over from it.
      flight.onfinish = stop;
      // (In case the browser holds its end back, e.g. a tab in the background.)
      finishTimer = window.setTimeout(stop, total + 500);

      onOff();
    });
  });
}
