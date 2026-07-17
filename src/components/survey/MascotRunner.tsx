import { useEffect, useRef, useState } from "react";

/**
 * Header mascot: a small "spark" character auto-runs along a ground line and
 * hops over pill-shaped obstacles, Mario-style. Click / tap / Space jumps
 * early. Collisions just reset the run — this is a header, not a game to win.
 *
 * No animation libraries (none installed) — plain canvas + requestAnimationFrame.
 * Respects prefers-reduced-motion: renders one static posed frame, no loop.
 */

const WIDTH = 640;
const HEIGHT = 140;
const GROUND_Y = 104;
const GRAVITY = 0.0028; // px / ms^2
const JUMP_VELOCITY = -0.62; // px / ms
const RUN_SPEED = 0.22; // px / ms
const SPARK_X = 72;
const SPARK_SIZE = 34;
const OBSTACLE_SIZE = 22;

const INK = "#141413";
const CLAY = "#CC785C";
const PAPER = "#F0EEE6";
const BORDER = "#DAD6C8";

interface Obstacle {
  x: number;
  cleared: boolean;
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  sparkY: number,
  legPhase: number,
  obstacles: Obstacle[],
) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // Ground line
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + SPARK_SIZE / 2);
  ctx.lineTo(WIDTH, GROUND_Y + SPARK_SIZE / 2);
  ctx.stroke();

  // Obstacles — little capsule/pill shapes
  for (const obs of obstacles) {
    const y = GROUND_Y + SPARK_SIZE / 2 - OBSTACLE_SIZE / 2;
    ctx.save();
    ctx.translate(obs.x, y);
    ctx.fillStyle = obs.cleared ? BORDER : CLAY;
    const w = OBSTACLE_SIZE * 1.15;
    const h = OBSTACLE_SIZE * 0.62;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // Spark mascot: rounded body + two little legs mid-stride + a spark/star mark
  ctx.save();
  ctx.translate(SPARK_X, GROUND_Y - sparkY);

  // legs (simple alternating stride, only visible near ground)
  const stride = Math.sin(legPhase) * 6;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-6, SPARK_SIZE / 2 - 2);
  ctx.lineTo(-6 + stride, SPARK_SIZE / 2 + 8);
  ctx.moveTo(6, SPARK_SIZE / 2 - 2);
  ctx.lineTo(6 - stride, SPARK_SIZE / 2 + 8);
  ctx.stroke();

  // body
  ctx.fillStyle = CLAY;
  ctx.beginPath();
  ctx.roundRect(-SPARK_SIZE / 2, -SPARK_SIZE / 2, SPARK_SIZE, SPARK_SIZE, 10);
  ctx.fill();

  // face mark (four-point spark / asterisk, echoes an "AI spark")
  ctx.fillStyle = PAPER;
  ctx.save();
  ctx.translate(0, -1);
  ctx.beginPath();
  const r1 = 7;
  const r2 = 2.6;
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i;
    const r = i % 2 === 0 ? r1 : r2;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

function drawStaticFrame(ctx: CanvasRenderingContext2D) {
  drawScene(ctx, 0, 0, [
    { x: SPARK_X + 160, cleared: false },
    { x: SPARK_X + 320, cleared: false },
  ]);
}

export function MascotRunner() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (reducedMotion) {
      drawStaticFrame(ctx);
      return;
    }

    let raf = 0;
    let lastTime: number | null = null;
    let sparkY = 0;
    let velocity = 0;
    let jumping = false;
    let legPhase = 0;
    let distance = 0;
    let nextObstacleAt = 260;
    let obstacles: Obstacle[] = [];

    const jump = () => {
      if (!jumping) {
        jumping = true;
        velocity = JUMP_VELOCITY;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        jump();
      }
    };
    const onPointer = () => jump();

    canvas.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);

    const tick = (time: number) => {
      if (lastTime === null) lastTime = time;
      const dt = Math.min(time - lastTime, 48);
      lastTime = time;

      // physics
      if (jumping) {
        velocity += GRAVITY * dt;
        sparkY -= velocity * dt;
        if (sparkY <= 0) {
          sparkY = 0;
          jumping = false;
          velocity = 0;
        }
      } else {
        legPhase += dt * 0.012;
      }

      // world scroll
      distance += RUN_SPEED * dt;
      for (const obs of obstacles) obs.x -= RUN_SPEED * dt;
      obstacles = obstacles.filter((o) => o.x > -40);

      if (distance >= nextObstacleAt) {
        obstacles.push({ x: WIDTH + 20, cleared: false });
        nextObstacleAt = distance + 220 + Math.random() * 140;
      }

      // auto-jump when close to an obstacle (endless-runner autopilot),
      // still overridable early by the player via jump()
      const upcoming = obstacles.find(
        (o) => !jumping && !o.cleared && o.x - SPARK_X < 70 && o.x - SPARK_X > 10,
      );
      if (upcoming) jump();

      // mark cleared / collision reset
      for (const obs of obstacles) {
        const dx = Math.abs(obs.x - SPARK_X);
        if (dx < 16 && sparkY < OBSTACLE_SIZE * 0.5) {
          // collided — gentle reset, no game-over friction
          obstacles = [];
          distance = 0;
          nextObstacleAt = 260;
          sparkY = 0;
          jumping = false;
          velocity = 0;
          break;
        }
        if (obs.x < SPARK_X) obs.cleared = true;
      }

      drawScene(ctx, sparkY, legPhase, obstacles);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [reducedMotion]);

  return (
    <div className="survey-mascot">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label="PharmaSync spark mascot running and hopping over obstacles"
        tabIndex={0}
        className="survey-mascot-canvas"
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Spacebar") e.preventDefault();
        }}
      />
      {!reducedMotion && (
        <p className="survey-mascot-hint">Click or press Space to jump</p>
      )}
    </div>
  );
}
