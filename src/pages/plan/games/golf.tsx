import { useRef } from 'react';
import {
  Callout,
  drawMeter,
  drawSky,
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

const HEIGHT = 280;
const GRAVITY = 900;
const ANGLE = (36 * Math.PI) / 180;
const BOUNCE = 0.38;
const ROLL_FRICTION = 260;
/** One full swing of the power meter (0 → 1 → 0). */
const METER_PERIOD = 1.5;

/** Simulated rest distance for a launch speed, so a full swing lands just past the field. */
function restDistance(v: number) {
  let x = 0;
  let y = 0;
  let vx = v * Math.cos(ANGLE);
  let vy = -v * Math.sin(ANGLE);
  const dt = 1 / 240;
  for (let k = 0; k < 240 * 12; k++) {
    if (y < 0 || vy < 0) {
      vy += GRAVITY * dt;
      x += vx * dt;
      y += vy * dt;
      if (y >= 0 && vy > 0) {
        y = 0;
        vy = -vy * BOUNCE;
        vx *= 0.72;
        if (Math.abs(vy) < 60) vy = 0;
      }
    } else {
      vx = Math.max(0, vx - ROLL_FRICTION * dt);
      x += vx * dt;
      if (vx === 0) break;
    }
  }
  return x;
}
const REF_SPEED = 600;
const REF_DISTANCE = restDistance(REF_SPEED);

/** Side view: hold to wind up a swinging power meter, release to hit. Carry + bounce + roll decide the pick. */
export function Golf(props: GameProps) {
  const p = usePropsRef(props);
  const reset = useRef(() => {});

  const { wrapRef, canvasRef } = useGameCanvas(HEIGHT, (stage) => {
    const { ctx } = stage;
    const groundY = HEIGHT - 50;
    const fx = new Particles();
    const quake = new Quake();
    const callout = new Callout();
    let holdAt: number | null = null;
    let swingAt = 0; // follow-through animation start
    let ball: { x: number; y: number; vx: number; vy: number; rolling: boolean; trail: { x: number; y: number }[] } | null = null;
    let rest: number | null = null;

    const geo = () => {
      const teeX = 52;
      const fieldStart = teeX + 60;
      const fieldEnd = stage.width - 16;
      // Distance scales ~ v², so scale the reference shot to the field.
      const vmax = REF_SPEED * Math.sqrt(((fieldEnd - teeX) * 1.06) / REF_DISTANCE);
      return { teeX, fieldStart, fieldEnd, vmax };
    };
    reset.current = () => {
      rest = null;
      ball = null;
      fx.clear();
    };

    const meter = (now: number) => (holdAt === null ? 0 : (1 - Math.cos((((now - holdAt) / 1000) * 2 * Math.PI) / METER_PERIOD)) / 2);

    const stop = (x: number) => {
      const g = geo();
      const { scale: values } = p.current;
      const { i, note } = slotAt(x, g.fieldStart, g.fieldEnd, values.length);
      rest = Math.min(x, stage.width - 6);
      callout.show(values[i], x, groundY - 26, note);
      p.current.onPick(values[i]);
    };

    return {
      down() {
        if (p.current.disabled || ball || !p.current.scale.length) return false;
        holdAt = performance.now();
        rest = null;
        return true;
      },
      up() {
        if (holdAt === null) return;
        const pw = meter(performance.now());
        holdAt = null;
        swingAt = performance.now();
        if (pw < 0.03) return;
        const g = geo();
        const v = g.vmax * pw;
        ball = { x: g.teeX + 10, y: groundY - 3, vx: v * Math.cos(ANGLE), vy: -v * Math.sin(ANGLE), rolling: false, trail: [] };
        fx.burst(g.teeX + 10, groundY, { count: 8 + Math.round(pw * 14), speed: 80 + pw * 160, colors: ['#7cb36b', '#a2d38f', '#9fb0c8'], size: 2 });
        quake.hit(1 + pw * 4);
      },
      cancel() {
        holdAt = null;
      },
      frame(now, dt) {
        const c = palette();
        const g = geo();
        const { scale: values, selected, disabled } = p.current;
        const W = stage.width;
        ctx.save();
        quake.apply(ctx, now);
        drawSky(ctx, c, W, HEIGHT, groundY);

        // Fairway with mowing stripes
        ctx.fillStyle = c.ground;
        ctx.fillRect(-10, groundY, W + 20, HEIGHT - groundY + 10);
        drawSlots(ctx, c, values, selected, g.fieldStart, g.fieldEnd, groundY, { thickness: 8, labelGap: 14 });
        // Flag at the end
        ctx.strokeStyle = c.label;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(g.fieldEnd - 4, groundY);
        ctx.lineTo(g.fieldEnd - 4, groundY - 46);
        ctx.stroke();
        ctx.fillStyle = '#e5484d';
        ctx.beginPath();
        ctx.moveTo(g.fieldEnd - 4, groundY - 46);
        ctx.lineTo(g.fieldEnd - 24, groundY - 39);
        ctx.lineTo(g.fieldEnd - 4, groundY - 32);
        ctx.fill();

        // Golfer: a stick figure with a club that winds up with the meter and swings through on release
        const m = meter(now);
        const follow = Math.min(1, (now - swingAt) / 180);
        const clubAngle = holdAt !== null ? 0.3 + m * 2.4 : swingAt ? -1.9 + (1 - follow) * 2.2 : 0.3;
        const gx = g.teeX - 14;
        ctx.strokeStyle = c.text;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(gx, groundY - 52, 7, 0, Math.PI * 2);
        ctx.moveTo(gx, groundY - 44);
        ctx.lineTo(gx, groundY - 20);
        ctx.lineTo(gx - 7, groundY);
        ctx.moveTo(gx, groundY - 20);
        ctx.lineTo(gx + 7, groundY);
        ctx.stroke();
        // arms + club from the shoulders
        const sx = gx;
        const sy = groundY - 38;
        const hx = sx + Math.sin(clubAngle) * -14;
        const hy = sy + Math.cos(clubAngle) * 14;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.strokeStyle = c.label;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        const cx = hx + Math.sin(clubAngle) * -28;
        const cy = hy + Math.cos(clubAngle) * 28;
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.fillStyle = c.label;
        ctx.fillRect(cx - 4, cy - 2, 8, 4);

        // Tee
        ctx.fillStyle = c.wood;
        ctx.fillRect(g.teeX + 8, groundY - 4, 4, 4);

        // Ball flight
        if (ball) {
          if (!ball.rolling) {
            ball.vy += GRAVITY * dt;
            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;
            ball.trail.push({ x: ball.x, y: ball.y });
            if (ball.trail.length > 22) ball.trail.shift();
            if (ball.y >= groundY - 3 && ball.vy > 0) {
              ball.y = groundY - 3;
              fx.burst(ball.x, groundY, { count: Math.round(4 + Math.abs(ball.vy) / 40), speed: 40 + Math.abs(ball.vy) * 0.3, colors: ['#7cb36b', '#5a8f4c'], size: 2 });
              ball.vy = -ball.vy * BOUNCE;
              ball.vx *= 0.72;
              if (Math.abs(ball.vy) < 60) {
                ball.vy = 0;
                ball.rolling = true;
              }
            }
          } else {
            ball.vx = Math.max(0, ball.vx - ROLL_FRICTION * dt);
            ball.x += ball.vx * dt;
            if (ball.vx === 0) {
              const x = ball.x;
              ball = null;
              stop(x);
            }
          }
        }
        const drawBall = (x: number, y: number) => {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = 'rgba(0,0,0,0.3)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        };
        if (ball) {
          ball.trail.forEach((pt, i) => {
            ctx.fillStyle = `rgba(255,255,255,${(i / ball!.trail.length) * 0.5})`;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2);
            ctx.fill();
          });
          if (ball.y < 0) {
            ctx.fillStyle = c.text;
            ctx.font = '700 10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('▲', Math.min(ball.x, W - 10), 4);
          } else drawBall(ball.x, ball.y);
        } else if (rest !== null) drawBall(rest, groundY - 3);
        else if (!disabled) drawBall(g.teeX + 10, groundY - 7);

        fx.draw(ctx, dt, 500, groundY);
        callout.draw(ctx, c, now, W);

        if (holdAt !== null) {
          drawMeter(ctx, c, 14, 22, Math.min(180, W * 0.4), 10, m, strengthWords(m).toUpperCase());
        } else if (!ball && rest === null && !disabled) {
          hint(ctx, c, W, W < 520 ? 'Hold, watch the meter, release to swing' : 'Press and hold to wind up — release when the power feels right', 24);
        }
        ctx.restore();
      },
    };
  });

  useOnRound(props.round, () => reset.current());

  return <GameFrame wrapRef={wrapRef} canvasRef={canvasRef} disabled={props.disabled} label="Golf: hold to wind up, release to swing and pick a value" />;
}
