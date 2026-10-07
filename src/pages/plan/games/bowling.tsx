import { useRef } from 'react';
import {
  Callout,
  clamp,
  drawSlots,
  GameFrame,
  hint,
  palette,
  Particles,
  Quake,
  slotAt,
  strengthWords,
  useGameCanvas,
  useOnRound,
  usePropsRef,
  type GameProps,
} from './kit';

const HEIGHT = 230;
const MAX_PULL = 160;
const FRICTION = 420; // px/s² of slowdown
const BALL_R = 13;

interface Pin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  down: boolean;
}

/** Top-down lane: pull the ball back and let go. It slides, slows down, and where it stops is your pick. */
export function Bowling(props: GameProps) {
  const p = usePropsRef(props);
  const reset = useRef(() => {});

  const { wrapRef, canvasRef } = useGameCanvas(HEIGHT, (stage) => {
    const { ctx } = stage;
    const laneTop = 54;
    const laneBottom = 144;
    const laneMid = (laneTop + laneBottom) / 2;
    const fx = new Particles();
    const quake = new Quake(450);
    const callout = new Callout();
    let aim: { ox: number; px: number } | null = null;
    let ball: { x: number; v: number; roll: number; y: number } | null = null;
    let rest: { x: number; at: number } | null = null;
    let pins: Pin[] = [];

    const geo = () => {
      const homeX = 30;
      const fieldStart = homeX + 50;
      const pinsX = stage.width - 46;
      const fieldEnd = pinsX - 30;
      const vmax = Math.sqrt(2 * FRICTION * (fieldEnd - homeX) * 1.07);
      return { homeX, fieldStart, fieldEnd, pinsX, vmax };
    };

    const setPins = () => {
      const g = geo();
      pins = [];
      // Top-down triangle, pointing at the bowler
      for (let row = 0; row < 4; row++)
        for (let k = 0; k <= row; k++)
          pins.push({ x: g.pinsX + row * 11, y: laneMid + (k - row / 2) * 16, vx: 0, vy: 0, spin: 0, angle: 0, down: false });
    };
    setPins();
    reset.current = () => {
      setPins();
      rest = null;
      ball = null;
      fx.clear();
    };

    const power = () => (aim ? clamp((aim.ox - aim.px) / MAX_PULL, 0, 1) : 0);

    const finish = (x: number, strike: boolean) => {
      const g = geo();
      const { scale: values } = p.current;
      const { i, note } = slotAt(strike ? Infinity : x, g.fieldStart, g.fieldEnd, values.length);
      const value = values[i];
      rest = { x: clamp(x, BALL_R, stage.width - BALL_R), at: performance.now() };
      callout.show(value, strike ? g.fieldEnd : x, laneTop - 4, strike ? 'STRIKE!' : note);
      const strength = values.length > 1 ? i / (values.length - 1) : 0.5;
      quake.hit(2 + strength * 5);
      p.current.onPick(value);
    };

    return {
      down(pt) {
        if (p.current.disabled || ball || !p.current.scale.length) return false;
        aim = { ox: pt.x, px: pt.x };
        rest = null;
        if (pins.some((q) => q.down)) setPins();
        return true;
      },
      move(pt) {
        if (aim) aim.px = pt.x;
      },
      up() {
        const pw = power();
        aim = null;
        if (pw < 0.05) return;
        const g = geo();
        ball = { x: g.homeX, v: g.vmax * pw, roll: 0, y: laneMid };
        quake.hit(1.5);
      },
      cancel() {
        aim = null;
      },
      frame(now, dt) {
        const c = palette();
        const g = geo();
        const { scale: values, selected, disabled } = p.current;
        const W = stage.width;
        ctx.save();
        quake.apply(ctx, now);

        // Floor
        ctx.fillStyle = c.dark ? '#141a26' : '#e9edf3';
        ctx.fillRect(-10, -10, W + 20, HEIGHT + 20);
        // Gutters + lane
        ctx.fillStyle = c.dark ? '#0d121c' : '#cfd6e0';
        ctx.fillRect(0, laneTop - 10, W, laneBottom - laneTop + 20);
        const lane = ctx.createLinearGradient(0, laneTop, 0, laneBottom);
        lane.addColorStop(0, c.wood);
        lane.addColorStop(0.5, c.woodDark);
        lane.addColorStop(1, c.wood);
        ctx.fillStyle = lane;
        ctx.fillRect(0, laneTop, W, laneBottom - laneTop);
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 1;
        for (let y = laneTop + 9; y < laneBottom; y += 9) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }
        // Arrows on the lane (decoration)
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        for (let k = 0; k < 5; k++) {
          const ax = g.homeX + 70 + k * 12;
          const ay = laneTop + 15 + k * 15;
          ctx.beginPath();
          ctx.moveTo(ax + 7, ay);
          ctx.lineTo(ax, ay - 4);
          ctx.lineTo(ax, ay + 4);
          ctx.fill();
        }

        // Value bands across the lane, labels below
        drawSlots(ctx, c, values, selected, g.fieldStart, g.fieldEnd, laneBottom + 12, { thickness: 6, labelGap: 12 });
        // faint stripes on the lane for each labelled band edge
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        const slotW = (g.fieldEnd - g.fieldStart) / Math.max(1, values.length);
        values.forEach((_, i) => i % 2 && ctx.fillRect(g.fieldStart + i * slotW, laneTop, slotW, laneBottom - laneTop));
        if (selected !== null && values.includes(selected)) {
          ctx.fillStyle = 'rgba(255, 211, 107, 0.35)';
          ctx.fillRect(g.fieldStart + values.indexOf(selected) * slotW, laneTop, Math.max(2, slotW), laneBottom - laneTop);
        }
        // Foul line
        ctx.fillStyle = '#e5484d';
        ctx.fillRect(g.fieldStart - 2, laneTop, 2, laneBottom - laneTop);

        // Pins
        for (const q of pins) {
          if (q.down) {
            q.x += q.vx * dt;
            q.y += q.vy * dt;
            q.vx *= 0.985;
            q.vy *= 0.985;
            q.angle += q.spin * dt;
          }
          ctx.save();
          ctx.translate(q.x, q.y);
          ctx.rotate(q.angle);
          ctx.fillStyle = '#fbfbf8';
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath();
          q.down ? ctx.ellipse(0, 0, 9, 4.5, 0, 0, Math.PI * 2) : ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#e5484d';
          q.down ? ctx.fillRect(-2, -4.5, 2, 9) : ctx.fillRect(-5, -1, 10, 2);
          ctx.restore();
        }

        // Ball physics
        if (ball) {
          ball.v = Math.max(0, ball.v - FRICTION * dt);
          ball.x += ball.v * dt;
          ball.roll += (ball.v * dt) / BALL_R;
          if (ball.x > g.pinsX - 10 && !pins.some((q) => q.down)) {
            // STRIKE: scatter the pins
            for (const q of pins) {
              q.down = true;
              const a = Math.atan2(q.y - laneMid, q.x - ball.x) + (Math.random() - 0.5) * 0.9;
              const sp = 120 + Math.random() * 260 + ball.v * 0.3;
              q.vx = Math.cos(a) * sp;
              q.vy = Math.sin(a) * sp;
              q.spin = (Math.random() - 0.5) * 30;
            }
            fx.burst(g.pinsX, laneMid, { count: 30, speed: 320, up: false, colors: ['#fbfbf8', '#e5484d', '#ffd36b'], size: 3 });
            quake.hit(9);
            const x = ball.x;
            ball = null;
            finish(x, true);
          } else if (ball.v <= 0) {
            const x = ball.x;
            ball = null;
            fx.burst(x, laneMid, { count: 10, speed: 70, up: false, colors: ['rgba(255,255,255,0.6)'], size: 2, decay: 2 });
            finish(x, false);
          }
        }

        // Ball (aiming / rolling / resting)
        const pw = power();
        const shake = pw > 0.75 ? (Math.random() - 0.5) * (pw - 0.75) * 10 : 0;
        const bx = ball ? ball.x : rest ? rest.x : g.homeX + 6 - pw * 18 + shake;
        const roll = ball ? ball.roll : 0;
        if (!disabled || rest || ball) {
          ctx.save();
          ctx.translate(bx, laneMid + shake);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath();
          ctx.ellipse(2, 4, BALL_R, BALL_R * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.rotate(roll);
          const grad = ctx.createRadialGradient(-4, -4, 2, 0, 0, BALL_R);
          grad.addColorStop(0, '#7aa2ff');
          grad.addColorStop(1, '#1d3fa8');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#0b1530';
          [[-3, -4], [3, -4], [0, 3]].forEach(([hx, hy]) => {
            ctx.beginPath();
            ctx.arc(hx, hy, 1.8, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.restore();
        }

        fx.draw(ctx, dt, 0);
        callout.draw(ctx, c, now, W);

        if (aim && pw > 0.05) {
          ctx.font = `800 ${12 + pw * 8}px system-ui, sans-serif`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = pw > 0.85 ? '#e5484d' : c.text;
          ctx.fillText(strengthWords(pw), 12, laneTop - 14);
        } else if (!ball && !rest && !disabled) {
          hint(ctx, c, W, W < 520 ? 'Drag left & let go — harder task, harder push' : 'Drag left anywhere and let go — the harder the task, the harder you push', 22);
        }
        ctx.restore();
      },
    };
  });

  useOnRound(props.round, () => reset.current());

  return <GameFrame wrapRef={wrapRef} canvasRef={canvasRef} disabled={props.disabled} label="Bowling: drag back and release to roll the ball and pick a value" />;
}
