"use client";

import { useEffect, useRef } from "react";

// The login screen's background: a grid of faint dots that move out of the way of the mouse (or a
// finger) and spring back. Only animates while something is moving; still dots for reduced motion.
const GAP = 22;
const RADIUS = 130;
const PUSH = 32;

type Dot = { hx: number; hy: number; x: number; y: number; vx: number; vy: number };

export function DotField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let dots: Dot[] = [];
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    let rest = "rgba(15,23,42,0.13)";
    let active = [0, 122, 255];

    const readColors = () => {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      rest = dark ? "rgba(226,232,240,0.12)" : "rgba(15,23,42,0.13)";
      active = dark ? [62, 166, 255] : [0, 122, 255];
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const dot of dots) {
        const moved = Math.min(1, Math.hypot(dot.x - dot.hx, dot.y - dot.hy) / PUSH);
        ctx.fillStyle = moved > 0.02 ? `rgba(${active[0]},${active[1]},${active[2]},${0.14 + 0.36 * moved})` : rest;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 1.2 + 0.8 * moved, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dots = [];
      for (let y = GAP / 2; y < height; y += GAP) {
        for (let x = GAP / 2; x < width; x += GAP) dots.push({ hx: x, hy: y, x, y, vx: 0, vy: 0 });
      }
      readColors();
      draw();
    };

    const tick = () => {
      let moving = false;
      for (const dot of dots) {
        let tx = dot.hx;
        let ty = dot.hy;
        if (pointer) {
          const dx = dot.hx - pointer.x;
          const dy = dot.hy - pointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance < RADIUS && distance > 0.01) {
            const push = Math.pow(1 - distance / RADIUS, 2) * PUSH;
            tx += (dx / distance) * push;
            ty += (dy / distance) * push;
          }
        }
        dot.vx = (dot.vx + (tx - dot.x) * 0.12) * 0.78;
        dot.vy = (dot.vy + (ty - dot.y) * 0.12) * 0.78;
        dot.x += dot.vx;
        dot.y += dot.vy;
        if (Math.abs(dot.vx) + Math.abs(dot.vy) > 0.02 || Math.abs(tx - dot.x) + Math.abs(ty - dot.y) > 0.05) moving = true;
      }
      draw();
      frame = moving ? window.requestAnimationFrame(tick) : 0;
    };

    const wake = () => {
      if (!frame && !reduceMotion) frame = window.requestAnimationFrame(tick);
    };
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      wake();
    };
    const onLeave = () => {
      pointer = null;
      wake();
    };

    build();
    const resize = new ResizeObserver(build);
    resize.observe(canvas);
    const theme = new MutationObserver(() => {
      readColors();
      draw();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    // A finger lifting is like the mouse leaving.
    const onUp = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") onLeave();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      resize.disconnect();
      theme.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
