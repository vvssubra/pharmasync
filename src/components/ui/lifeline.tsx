import { useEffect, useRef } from "react";

/**
 * ECG lifeline traces for the login canvas.
 *
 * A faint emerald monitor grid with a few heartbeat traces swept left to
 * right like a patient monitor: a bright write-head draws the PQRST waveform
 * and the trace fades out behind it. Fills its positioned parent
 * (`absolute inset-0`) and is purely decorative — `aria-hidden`, no pointer
 * events, and frozen to a static frame under prefers-reduced-motion.
 *
 * Canvas rather than SVG/DOM: three polylines redrawn per frame is one cheap
 * composited layer.
 */

const CELL = 36; // grid pitch, px
const TRAIL = 560; // visible trace behind the head, px
const SAMPLE = 2; // px between waveform samples

type Lane = {
  y: number; // baseline as a fraction of height
  amp: number; // R-peak height, px
  beat: number; // px per heartbeat (horizontal spacing of complexes)
  speed: number; // sweep speed, px/s
  glow: number; // 0..1 brightness
  offset: number; // waveform phase shift so lanes don't beat in sync
  x: number; // current head position, px
};

const LANES: Omit<Lane, "x">[] = [
  { y: 0.3, amp: 46, beat: 300, speed: 150, glow: 1, offset: 0 },
  { y: 0.62, amp: 30, beat: 240, speed: 115, glow: 0.6, offset: 90 },
  { y: 0.88, amp: 22, beat: 340, speed: 95, glow: 0.45, offset: 200 },
];

// One PQRST complex as a sum of gaussians over phase t ∈ [0, 1).
const WAVES = [
  { at: 0.18, h: 0.12, w: 0.025 }, // P
  { at: 0.36, h: -0.12, w: 0.008 }, // Q
  { at: 0.39, h: 1, w: 0.01 }, // R
  { at: 0.42, h: -0.25, w: 0.01 }, // S
  { at: 0.62, h: 0.24, w: 0.045 }, // T
];

function ecg(t: number) {
  let v = 0;
  for (const { at, h, w } of WAVES) v += h * Math.exp(-(((t - at) / w) ** 2));
  return v;
}

function traceY(lane: Lane, x: number, h: number) {
  const t = ((((x + lane.offset) % lane.beat) + lane.beat) % lane.beat) / lane.beat;
  return lane.y * h - lane.amp * ecg(t);
}

export default function Lifeline({ className }: { className?: string }) {
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
    let lanes: Lane[] = [];

    const resize = () => {
      w = parent.clientWidth;
      h = parent.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Stagger heads across the width so traces are already drawn at t=0.
      lanes = LANES.map((l, i) => ({ ...l, x: TRAIL + ((i * 0.37 + 0.2) % 1) * w }));
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
    };

    const drawLane = (lane: Lane) => {
      const head = lane.x;
      const start = head - TRAIL;
      const path = new Path2D();
      path.moveTo(start, traceY(lane, start, h));
      for (let x = start + SAMPLE; x < head; x += SAMPLE) path.lineTo(x, traceY(lane, x, h));
      const hy = traceY(lane, head, h);
      path.lineTo(head, hy);

      // Trace is monotone in x, so a horizontal gradient fades the tail.
      const fade = (a: number) => {
        const g = ctx.createLinearGradient(start, 0, head, 0);
        g.addColorStop(0, "rgba(52, 211, 153, 0)");
        g.addColorStop(0.7, `rgba(52, 211, 153, ${(a * 0.6).toFixed(3)})`);
        g.addColorStop(1, `rgba(110, 231, 183, ${a.toFixed(3)})`);
        return g;
      };
      // Soft halo underneath, then the crisp trace on top.
      ctx.lineWidth = 6;
      ctx.strokeStyle = fade(0.12 * lane.glow);
      ctx.stroke(path);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = fade(0.9 * lane.glow);
      ctx.stroke(path);

      // Write-head: bright core with a soft bloom.
      const bloom = ctx.createRadialGradient(head, hy, 0, head, hy, 16);
      bloom.addColorStop(0, `rgba(167, 243, 208, ${(0.6 * lane.glow).toFixed(3)})`);
      bloom.addColorStop(1, "rgba(52, 211, 153, 0)");
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(head, hy, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(236, 253, 245, ${(0.95 * lane.glow).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(head, hy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    };

    const frame = () => {
      drawGrid();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const l of lanes) drawLane(l);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      frame();
    });
    ro.observe(parent);

    if (reduceMotion) {
      frame();
      return () => ro.disconnect();
    }

    let raf = 0;
    let last = performance.now();
    const tick = (ts: number) => {
      // Clamp dt so a backgrounded tab doesn't jump the sweep on return.
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;
      for (const l of lanes) {
        l.x += l.speed * dt;
        // Wrap once the whole trail has left the right edge.
        if (l.x - TRAIL > w) l.x = 0;
      }
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
