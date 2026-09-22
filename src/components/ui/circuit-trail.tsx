import { useEffect, useRef } from "react";

/**
 * Circuit-board light trails for the login canvas.
 *
 * A faint emerald grid with a handful of light pulses that travel along the
 * grid lines, turning 90° at nodes like signal on a PCB trace. Each pulse
 * leaves a fading tail behind its bright head. Fills its positioned parent
 * (`absolute inset-0`) and is purely decorative — `aria-hidden`, no pointer
 * events, and frozen to a static frame under prefers-reduced-motion.
 *
 * Canvas rather than DOM: a dozen moving polylines redrawn per frame is far
 * cheaper than animating hundreds of tiles, and the whole thing is one
 * composited layer.
 */

const CELL = 36; // grid pitch, px — matches the Stitch micro-pattern
const PULSES = 14; // concurrent light pulses
const TRAIL = 260; // tail length, px
const SPEED_MIN = 90; // px/s
const SPEED_MAX = 170;
const TURN_CHANCE = 0.38; // probability of a 90° turn at each node

type Pulse = {
  // Polyline from oldest corner to current head; head is the last point.
  points: { x: number; y: number }[];
  dx: number;
  dy: number;
  speed: number;
  // Distance travelled since the last node — used to detect node crossings.
  sinceNode: number;
  // 0..1 brightness; a few pulses run brighter so the field has depth.
  glow: number;
};

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function spawn(w: number, h: number): Pulse {
  const cols = Math.floor(w / CELL);
  const rows = Math.floor(h / CELL);
  const x = Math.floor(Math.random() * (cols + 1)) * CELL;
  const y = Math.floor(Math.random() * (rows + 1)) * CELL;
  const [dx, dy] = DIRS[Math.floor(Math.random() * DIRS.length)];
  return {
    points: [{ x, y }, { x, y }],
    dx,
    dy,
    speed: SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN),
    sinceNode: 0,
    glow: Math.random() < 0.25 ? 1 : 0.55 + Math.random() * 0.25,
  };
}

export default function CircuitTrail({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let pulses: Pulse[] = [];

    const resize = () => {
      w = parent.clientWidth;
      h = parent.clientHeight;
      if (!w || !h) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pulses = Array.from({ length: PULSES }, () => spawn(w, h));
      // Stagger: pre-run each pulse a random distance so they don't all
      // start as bare dots at t=0.
      for (const p of pulses) step(p, Math.random() * 3);
    };

    const step = (p: Pulse, dt: number) => {
      let remaining = p.speed * dt;
      while (remaining > 0) {
        const toNode = CELL - p.sinceNode;
        const move = Math.min(remaining, toNode);
        const head = p.points[p.points.length - 1];
        head.x += p.dx * move;
        head.y += p.dy * move;
        p.sinceNode += move;
        remaining -= move;

        if (p.sinceNode >= CELL - 1e-6) {
          // Snap to the node exactly so turns stay on-grid.
          head.x = Math.round(head.x / CELL) * CELL;
          head.y = Math.round(head.y / CELL) * CELL;
          p.sinceNode = 0;

          if (Math.random() < TURN_CHANCE) {
            // Turn left or right, never reverse.
            const turnRight = Math.random() < 0.5;
            const ndx = turnRight ? -p.dy : p.dy;
            const ndy = turnRight ? p.dx : -p.dx;
            p.dx = ndx;
            p.dy = ndy;
            // The old head becomes a fixed corner; start a new head segment.
            p.points.push({ x: head.x, y: head.y });
          }
        }
      }

      // Trim the tail to TRAIL px of path length.
      let len = 0;
      for (let i = p.points.length - 1; i > 0; i--) {
        const a = p.points[i];
        const b = p.points[i - 1];
        const seg = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (len + seg > TRAIL) {
          // Clip this segment so the tail fades out mid-line, not at a corner.
          const keep = TRAIL - len;
          const ux = Math.sign(b.x - a.x);
          const uy = Math.sign(b.y - a.y);
          b.x = a.x + ux * keep;
          b.y = a.y + uy * keep;
          p.points.splice(0, i - 1);
          break;
        }
        len += seg;
      }

      // Off-canvas (with the whole tail gone) → respawn.
      const head = p.points[p.points.length - 1];
      const margin = TRAIL + CELL;
      if (head.x < -margin || head.x > w + margin || head.y < -margin || head.y > h + margin) {
        Object.assign(p, spawn(w, h));
      }
    };

    const drawGrid = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(52, 211, 153, 0.045)";
      ctx.beginPath();
      for (let x = 0; x <= w; x += CELL) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
      }
      for (let y = 0; y <= h; y += CELL) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();
      // Node dots on every other intersection — the "solder pad" texture.
      ctx.fillStyle = "rgba(52, 211, 153, 0.09)";
      for (let x = 0; x <= w; x += CELL * 2) {
        for (let y = 0; y <= h; y += CELL * 2) {
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }
    };

    const drawPulse = (p: Pulse) => {
      const pts = p.points;
      const head = pts[pts.length - 1];

      // Tail: walk back from the head, alpha falls with path distance.
      let dist = 0;
      for (let i = pts.length - 1; i > 0; i--) {
        const a = pts[i];
        const b = pts[i - 1];
        const seg = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        const a0 = 1 - dist / TRAIL;
        const a1 = 1 - (dist + seg) / TRAIL;
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, `rgba(110, 231, 183, ${(0.85 * a0 * p.glow).toFixed(3)})`);
        grad.addColorStop(1, `rgba(52, 211, 153, ${Math.max(0, 0.85 * a1 * p.glow).toFixed(3)})`);
        // Soft halo underneath, then the crisp trace on top.
        ctx.lineWidth = 5;
        ctx.strokeStyle = `rgba(52, 211, 153, ${(0.10 * a0 * p.glow).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        dist += seg;
      }

      // Head: bright core with a soft bloom.
      const bloom = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 14);
      bloom.addColorStop(0, `rgba(167, 243, 208, ${(0.55 * p.glow).toFixed(3)})`);
      bloom.addColorStop(1, "rgba(52, 211, 153, 0)");
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(236, 253, 245, ${(0.95 * p.glow).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    };

    const frame = () => {
      drawGrid();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const p of pulses) drawPulse(p);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      frame();
    });
    ro.observe(parent);

    if (reduceMotion) {
      // One static frame: the grid plus a few trails frozen in place.
      frame();
      return () => ro.disconnect();
    }

    let raf = 0;
    let last = performance.now();
    const tick = (ts: number) => {
      // Clamp dt so a backgrounded tab doesn't teleport every pulse on return.
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;
      for (const p of pulses) step(p, dt);
      frame();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Pause when the tab is hidden — no point burning a core for nobody.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className ?? ""}`}
    />
  );
}
