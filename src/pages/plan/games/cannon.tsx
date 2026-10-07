import { useRef } from 'react';
import {
  Callout,
  clamp,
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

const HEIGHT = 300;
const GRAVITY = 1000;
/** Seconds of holding to pack a full load of gunpowder. */
const FULL_CHARGE = 1.4;
const MIN_ANGLE = (8 * Math.PI) / 180;
const MAX_ANGLE = (80 * Math.PI) / 180;
const BARREL = 34;

/**
 * Hold to pack gunpowder, move the pointer to aim the barrel, release to fire.
 * The cannonball's landing spot is your pick.
 */
export function Cannon(props: GameProps) {
  const p = usePropsRef(props);
  const reset = useRef(() => {});

  const { wrapRef, canvasRef } = useGameCanvas(HEIGHT, (stage) => {
    const { ctx } = stage;
    const groundY = HEIGHT - 46;
    const fx = new Particles();
    const smoke = new Particles();
    const quake = new Quake(500);
    const callout = new Callout();
    let angle = (40 * Math.PI) / 180;
    let chargeAt: number | null = null;
    let ball: { x: number; y: number; vx: number; vy: number; trail: { x: number; y: number }[] } | null = null;
    let craters: { x: number; r: number }[] = [];
    let recoilAt = 0;
    let flashAt = 0;

    const geo = () => {
      const cx = 46;
      const cy = groundY - 22;
      const fieldStart = cx + 70;
      const fieldEnd = stage.width - 14;
      const vmax = Math.sqrt((fieldEnd - cx) * 1.08 * GRAVITY);
      return { cx, cy, fieldStart, fieldEnd, vmax };
    };
    reset.current = () => {
      craters = [];
      ball = null;
      fx.clear();
    };

    const charge = (now: number) => (chargeAt === null ? 0 : clamp((now - chargeAt) / 1000 / FULL_CHARGE, 0, 1));
    const aimAt = (x: number, y: number) => {
      const g = geo();
      angle = clamp(Math.atan2(g.cy - y, Math.max(1, x - g.cx)), MIN_ANGLE, MAX_ANGLE);
    };

    return {
      down(pt) {
        if (p.current.disabled || ball || !p.current.scale.length) return false;
        chargeAt = performance.now();
        aimAt(pt.x, pt.y);
        return true;
      },
      move(pt) {
        aimAt(pt.x, pt.y);
      },
      up() {
        if (chargeAt === null) return;
        const pw = charge(performance.now());
        chargeAt = null;
        if (pw < 0.05) return;
        const g = geo();
        const v = g.vmax * pw;
        const mx = g.cx + Math.cos(angle) * BARREL;
        const my = g.cy - Math.sin(angle) * BARREL;
        ball = { x: mx, y: my, vx: v * Math.cos(angle), vy: -v * Math.sin(angle), trail: [] };
        recoilAt = flashAt = performance.now();
        smoke.burst(mx, my, { count: 14 + Math.round(pw * 20), speed: 50 + pw * 120, up: false, colors: ['rgba(190,195,205,0.8)', 'rgba(150,155,165,0.7)'], size: 6, decay: 0.8 });
        quake.hit(2 + pw * 6);
      },
      cancel() {
        chargeAt = null;
      },
      frame(now, dt) {
        const c = palette();
        const g = geo();
        const { scale: values, selected, disabled } = p.current;
        const W = stage.width;
        ctx.save();
        quake.apply(ctx, now);
        drawSky(ctx, c, W, HEIGHT, groundY);
        ctx.fillStyle = c.ground;
        ctx.fillRect(-10, groundY, W + 20, HEIGHT - groundY + 10);
        drawSlots(ctx, c, values, selected, g.fieldStart, g.fieldEnd, groundY, { thickness: 10, labelGap: 16 });
        // Craters from this round's shots
        ctx.fillStyle = c.dark ? '#0d1410' : '#4f7a44';
        for (const cr of craters) {
          ctx.beginPath();
          ctx.ellipse(cr.x, groundY + 2, cr.r, cr.r * 0.35, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        // Cannon: wheel + barrel (with recoil) + glowing fuse while charging
        const pw = charge(now);
        const recoil = Math.max(0, 1 - (now - recoilAt) / 220) * 8;
        const tremble = pw > 0.8 ? (Math.random() - 0.5) * (pw - 0.8) * 8 : 0;
        ctx.save();
        ctx.translate(g.cx + tremble, g.cy + tremble);
        ctx.rotate(-angle);
        ctx.translate(-recoil, 0);
        const barrel = ctx.createLinearGradient(0, -9, 0, 9);
        barrel.addColorStop(0, '#5b6474');
        barrel.addColorStop(0.5, '#2f3542');
        barrel.addColorStop(1, '#1b2029');
        ctx.fillStyle = barrel;
        ctx.beginPath();
        ctx.roundRect(-14, -9, BARREL + 14, 18, 6);
        ctx.fill();
        ctx.fillStyle = '#1b2029';
        ctx.fillRect(BARREL - 4, -11, 6, 22);
        ctx.restore();
        // wheel
        ctx.fillStyle = c.woodDark;
        ctx.strokeStyle = c.wood;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(g.cx - 4, groundY - 12, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 4;
          ctx.moveTo(g.cx - 4 - Math.cos(a) * 11, groundY - 12 - Math.sin(a) * 11);
          ctx.lineTo(g.cx - 4 + Math.cos(a) * 11, groundY - 12 + Math.sin(a) * 11);
        }
        ctx.stroke();
        // fuse spark
        if (chargeAt !== null) {
          const fx0 = g.cx - Math.cos(angle) * 12;
          const fy0 = g.cy + Math.sin(angle) * 12 - 10;
          fx.burst(fx0, fy0, { count: 1, speed: 60, colors: ['#ffd36b', '#ff8a5b'], size: 1.5, decay: 3 });
        }
        // muzzle flash
        const flash = 1 - (now - flashAt) / 140;
        if (flash > 0) {
          const mx = g.cx + Math.cos(angle) * (BARREL + 6);
          const my = g.cy - Math.sin(angle) * (BARREL + 6);
          const grad = ctx.createRadialGradient(mx, my, 0, mx, my, 34);
          grad.addColorStop(0, `rgba(255,243,176,${flash})`);
          grad.addColorStop(0.5, `rgba(255,183,3,${flash * 0.7})`);
          grad.addColorStop(1, 'rgba(229,72,77,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(mx, my, 34, 0, Math.PI * 2);
          ctx.fill();
        }

        // Flight
        if (ball) {
          ball.vy += GRAVITY * dt;
          ball.x += ball.vx * dt;
          ball.y += ball.vy * dt;
          ball.trail.push({ x: ball.x, y: ball.y });
          if (ball.trail.length > 14) ball.trail.shift();
          ball.trail.forEach((t, i) => {
            ctx.fillStyle = `rgba(160,165,175,${(i / ball!.trail.length) * 0.35})`;
            ctx.beginPath();
            ctx.arc(t.x, t.y, 3 + i * 0.2, 0, Math.PI * 2);
            ctx.fill();
          });
          if (ball.y < 0) {
            ctx.fillStyle = c.text;
            ctx.font = '700 10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`▲ ${Math.round(-ball.y)}`, clamp(ball.x, 20, W - 20), 4);
          } else {
            ctx.fillStyle = '#1b2029';
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.beginPath();
            ctx.arc(ball.x - 2, ball.y - 2, 2, 0, Math.PI * 2);
            ctx.fill();
          }
          if (ball.y >= groundY) {
            const x = ball.x;
            ball = null;
            const { i, note } = slotAt(x, g.fieldStart, g.fieldEnd, values.length);
            const strength = values.length > 1 ? i / (values.length - 1) : 0.5;
            const hitX = clamp(x, g.fieldStart, W - 10);
            craters = [...craters.slice(-4), { x: hitX, r: 10 + strength * 10 }];
            fx.burst(hitX, groundY, { count: 20 + Math.round(strength * 30), speed: 140 + strength * 260, colors: [c.ground, c.woodDark, '#9fb0c8'], size: 3 });
            fx.burst(hitX, groundY - 6, { count: 10, speed: 120 + strength * 120, colors: ['#ffd36b', '#ff8a5b'], size: 2, decay: 2.5 });
            smoke.burst(hitX, groundY - 4, { count: 10, speed: 60, colors: ['rgba(150,155,165,0.6)'], size: 7, decay: 0.9 });
            quake.hit(4 + strength * 8);
            callout.show(values[i], hitX, groundY - 30, note);
            p.current.onPick(values[i]);
          }
        }

        smoke.draw(ctx, dt, -30);
        fx.draw(ctx, dt, 600, groundY + 2);
        callout.draw(ctx, c, now, W);

        if (chargeAt !== null) {
          drawMeter(ctx, c, 14, 22, Math.min(170, W * 0.38), 10, pw, pw >= 1 ? 'MAXIMUM POWDER!' : strengthWords(pw).toUpperCase());
        } else if (!ball && !craters.length && !disabled) {
          hint(ctx, c, W, W < 520 ? 'Hold to load powder, move to aim, release' : 'Hold to load gunpowder, move to aim the barrel, release to fire', 22);
        }
        ctx.restore();
      },
    };
  });

  useOnRound(props.round, () => reset.current());

  return <GameFrame wrapRef={wrapRef} canvasRef={canvasRef} disabled={props.disabled} label="Cannon: hold to load, aim, release to fire and pick a value" />;
}
