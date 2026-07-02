"use client";

import { useEffect, useRef } from "react";

/**
 * Interactive emerald tile grid for the auth brand panel.
 * Adapted from the "cyber-matrix" concept to this app's pharmacy niche:
 * the falling ASCII is replaced with pharmaceutical glyphs (℞, ⚕, dosage units)
 * and recoloured emerald. Tiles brighten toward the pointer; click glitches one.
 * Fills its positioned parent (`absolute inset-0`).
 */

const TOKENS = [
  "℞", "⚕", "✚", "＋", "µ", "mg", "ml", "Rx", "∆", "≡",
  "◇", "○", "●", "⊕", "⊗", "mcg", "IV", "PO", "2", "5",
  "0", "1", "×", "÷", "cap", "tab",
];

export default function PharmaMatrix({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    const panel = grid?.parentElement;
    if (!grid || !panel) return;

    const rand = () => TOKENS[Math.floor(Math.random() * TOKENS.length)];

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains("pm-tile")) return;
      target.textContent = rand();
      target.classList.add("pm-glitch");
      setTimeout(() => target.classList.remove("pm-glitch"), 220);
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const RADIUS = 240;

    // Cached, panel-relative tile centers so the per-frame loop never forces layout.
    let tiles: HTMLElement[] = [];
    let centers: { x: number; y: number }[] = [];
    let pw = 0;
    let ph = 0;

    const build = () => {
      const w = panel.clientWidth;
      const h = panel.clientHeight;
      if (!w || !h) return;
      pw = w;
      ph = h;
      const size = 58;
      const cols = Math.max(1, Math.floor(w / size));
      const rows = Math.max(1, Math.floor(h / size));
      grid.style.setProperty("--cols", String(cols));
      grid.style.setProperty("--rows", String(rows));
      grid.innerHTML = "";
      const frag = document.createDocumentFragment();
      const cellW = w / cols;
      const cellH = h / rows;
      centers = [];
      for (let i = 0; i < cols * rows; i++) {
        const tile = document.createElement("div");
        tile.className = "pm-tile";
        tile.textContent = rand();
        frag.appendChild(tile);
        const col = i % cols;
        const row = Math.floor(i / cols);
        centers.push({ x: (col + 0.5) * cellW, y: (row + 0.5) * cellH });
      }
      grid.appendChild(frag);
      tiles = Array.from(grid.children) as HTMLElement[];
    };

    // Apply glow around a panel-relative point.
    const applyPoint = (px: number, py: number) => {
      for (let i = 0; i < tiles.length; i++) {
        const c = centers[i];
        const dist = Math.hypot(px - c.x, py - c.y);
        const intensity = Math.max(0, 1 - dist / RADIUS);
        tiles[i].style.setProperty("--i", intensity.toFixed(3));
      }
    };

    // Real pointer takes over briefly, then the auto-drift resumes.
    let pointerX = 0;
    let pointerY = 0;
    let pointerUntil = 0;

    const onMove = (e: PointerEvent) => {
      const rect = panel.getBoundingClientRect();
      pointerX = e.clientX - rect.left;
      pointerY = e.clientY - rect.top;
      pointerUntil = performance.now() + 1800;
    };

    build();
    const ro = new ResizeObserver(build);
    ro.observe(panel);
    panel.addEventListener("pointermove", onMove);
    grid.addEventListener("click", onClick);

    let raf = 0;
    const tick = (ts: number) => {
      if (ts < pointerUntil) {
        applyPoint(pointerX, pointerY);
      } else {
        // Drifting Lissajous spotlight across the panel.
        const ax = pw * (0.5 + 0.4 * Math.sin(ts * 0.00034));
        const ay = ph * (0.5 + 0.42 * Math.sin(ts * 0.00027 + 1.3));
        applyPoint(ax, ay);
      }
      raf = requestAnimationFrame(tick);
    };

    if (reduceMotion) {
      // No auto motion; pointer still lights the grid on demand.
      const onLeave = () => tiles.forEach((t) => t.style.setProperty("--i", "0"));
      panel.addEventListener("pointerleave", onLeave);
      return () => {
        ro.disconnect();
        panel.removeEventListener("pointermove", onMove);
        panel.removeEventListener("pointerleave", onLeave);
        grid.removeEventListener("click", onClick);
      };
    }

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      panel.removeEventListener("pointermove", onMove);
      grid.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <>
      <div ref={gridRef} className={`pm-grid pm-${variant}`} aria-hidden="true" />
      <style>{`
        .pm-grid {
          --i: 0;
          position: absolute;
          inset: 0;
          display: grid;
          grid-template-columns: repeat(var(--cols), 1fr);
          grid-template-rows: repeat(var(--rows), 1fr);
        }
        .pm-tile {
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-family: 'Courier New', Courier, monospace;
          font-size: 1rem;
          user-select: none;
          transition: color 0.25s ease, text-shadow 0.25s ease, transform 0.25s ease, opacity 0.25s ease;
        }

        /* Dark variant — bright emerald glyphs on the dark left panel */
        .pm-dark .pm-tile {
          opacity: calc(0.06 + var(--i) * 0.9);
          color: hsl(158, 100%, calc(45% + var(--i) * 35%));
          text-shadow: 0 0 calc(var(--i) * 14px) hsl(152, 90%, 50%);
          transform: scale(calc(1 + var(--i) * 0.18));
        }
        .pm-dark .pm-tile.pm-glitch { animation: pm-glitch-dark 0.22s ease; }
        @keyframes pm-glitch-dark {
          0%   { transform: scale(1); color: #34d399; }
          50%  { transform: scale(1.25); color: #ffffff; text-shadow: 0 0 12px #6ee7b7; }
          100% { transform: scale(1); color: #34d399; }
        }

        /* Light variant — near-invisible on white, deep emerald toward the pointer */
        .pm-light .pm-tile {
          opacity: calc(0.035 + var(--i) * 0.82);
          color: hsl(162, 84%, calc(28% - var(--i) * 7%));
          text-shadow: 0 0 calc(var(--i) * 10px) hsla(160, 84%, 32%, 0.5);
          transform: scale(calc(1 + var(--i) * 0.16));
        }
        .pm-light .pm-tile.pm-glitch { animation: pm-glitch-light 0.22s ease; }
        @keyframes pm-glitch-light {
          0%   { transform: scale(1); color: #065f46; }
          50%  { transform: scale(1.22); color: #047857; text-shadow: 0 0 8px rgba(16,185,129,0.55); }
          100% { transform: scale(1); color: #065f46; }
        }

        @media (prefers-reduced-motion: reduce) {
          .pm-tile { transition: none; }
          .pm-tile.pm-glitch { animation: none; }
        }
      `}</style>
    </>
  );
}
