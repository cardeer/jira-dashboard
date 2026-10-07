import { useRef } from 'react';
import {
  Callout,
  clamp,
  drawMeter,
  GameFrame,
  hint,
  palette,
  Particles,
  Quake,
  strengthWords,
  useGameCanvas,
  useOnRound,
  usePropsRef,
  type GameProps,
} from './kit';

const HEIGHT = 380;
const GRAVITY = 500;
/** Holding longer than this burns the tank dry. */
const MAX_BURN = 1.6;

/** Hold to burn fuel, release to cut the engine; the rocket coasts and its peak altitude is your pick. */
export function Rocket(props: GameProps) {
  const p = usePropsRef(props);
  const reset = useRef(() => {});

  const { wrapRef, canvasRef } = useGameCanvas(HEIGHT, (stage) => {
    const { ctx } = stage;
    const groundY = HEIGHT - 26;
    const top = 26; // altitude of the highest value
    const fx = new Particles();
    const smoke = new Particles();
    const quake = new Quake(500);
    const callout = new Callout();
    const stars = Array.from({ length: 50 }, () => ({ x: Math.random(), y: Math.random() * 0.8, r: Math.random() * 1.3 + 0.3 }));
    let burnStart: number | null = null;
    // Flight is computed from wall-clock time (not integrated per frame) so the result depends only
    // on how long you held, never on frame rate.
    let rocket: { launchAt: number; cutAt: number | null; y: number; burning: boolean } | null = null;
    let peak: { y: number; at: number } | null = null;

    const geo = () => {
      const rx = clamp(stage.width * 0.32, 70, 260);
      const padTop = groundY - 28; // nose height at rest
      const rulerX = stage.width - 64;
      // Thrust so a full tank peaks a bit above the top value:
      // apex(t) = ½·(T−g)·T·t²/g  →  (T−g)·T = K
      const H = (padTop - top) * 1.08;
      const K = (2 * H * GRAVITY) / (MAX_BURN * MAX_BURN);
      const thrust = (GRAVITY + Math.sqrt(GRAVITY * GRAVITY + 4 * K)) / 2;
      return { rx, padTop, rulerX, thrust };
    };
    reset.current = () => {
      rocket = null;
      peak = null;
      fx.clear();
      smoke.clear();
    };

    const fuelLeft = (now: number) => (burnStart === null ? 1 : clamp(1 - (now - burnStart) / 1000 / MAX_BURN, 0, 1));
    const yToValue = (y: number) => {
      const g = geo();
      const values = p.current.scale;
      const t = (g.padTop - y) / (g.padTop - top);
      const i = clamp(Math.floor(t * values.length), 0, values.length - 1);
      return { i, note: t > 1 ? 'to the moon!' : t < 0.02 ? 'barely left the pad' : '' };
    };
    const valueY = (i: number, n: number) => {
      const g = geo();
      return g.padTop - ((i + 0.5) / n) * (g.padTop - top);
    };

    const cut = () => {
      if (rocket && rocket.cutAt === null) rocket.cutAt = Math.min(performance.now(), rocket.launchAt + MAX_BURN * 1000);
      if (rocket) rocket.burning = false;
      burnStart = null;
    };
    const ignite = () => {
      const g = geo();
      rocket = { launchAt: performance.now(), cutAt: null, y: g.padTop, burning: true };
      quake.hit(3);
    };

    return {
      down() {
        if (p.current.disabled || rocket || !p.current.scale.length) return false;
        burnStart = performance.now();
        peak = null;
        ignite();
        return true;
      },
      up() {
        cut();
      },
      cancel() {
        cut();
      },
      frame(now, dt) {
        const c = palette();
        const g = geo();
        const W = stage.width;
        const { scale: values, selected, disabled } = p.current;
        ctx.save();
        quake.apply(ctx, now);

        // Sky fading into space
        const sky = ctx.createLinearGradient(0, 0, 0, groundY);
        sky.addColorStop(0, c.dark ? '#03050c' : '#1b2a55');
        sky.addColorStop(0.55, c.dark ? '#0b1222' : '#4f7fd1');
        sky.addColorStop(1, c.skyBottom);
        ctx.fillStyle = sky;
        ctx.fillRect(-10, -10, W + 20, HEIGHT + 20);
        ctx.fillStyle = '#ffffff';
        for (const s of stars) {
          ctx.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(now / 900 + s.x * 40));
          ctx.beginPath();
          ctx.arc(s.x * W, s.y * groundY * 0.6, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = c.ground;
        ctx.fillRect(-10, groundY, W + 20, HEIGHT - groundY + 10);
        // Launch pad
        ctx.fillStyle = c.label;
        ctx.fillRect(g.rx - 22, groundY - 4, 44, 4);

        // Altitude ruler on the right
        const n = values.length;
        const bandH = (g.padTop - top) / Math.max(1, n);
        const every = Math.max(1, Math.ceil(16 / bandH));
        const selIdx = selected === null ? -1 : values.indexOf(selected);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        values.forEach((v, i) => {
          const y = g.padTop - (i + 1) * bandH;
          const isSel = i === selIdx;
          ctx.fillStyle = isSel ? '#ffd36b' : i % 2 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.18)';
          ctx.fillRect(g.rulerX, y, 8, Math.max(1, bandH - (bandH > 4 ? 1 : 0)));
          if (isSel || (i % every === 0 && (selIdx < 0 || Math.abs(i - selIdx) >= every))) {
            ctx.font = isSel ? '800 12px system-ui, sans-serif' : '600 11px system-ui, sans-serif';
            ctx.fillStyle = isSel ? '#ffd36b' : 'rgba(255,255,255,0.75)';
            ctx.fillText(v, g.rulerX - 6, y + bandH / 2);
          }
        });
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(g.rulerX + 14, top, 2, g.padTop - top);

        // Flight
        if (rocket) {
          if (rocket.burning && fuelLeft(now) <= 0) {
            rocket.cutAt = rocket.launchAt + MAX_BURN * 1000;
            rocket.burning = false;
          }
          const accel = g.thrust - GRAVITY;
          const t = (now - rocket.launchAt) / 1000;
          const tb = rocket.cutAt === null ? t : (rocket.cutAt - rocket.launchAt) / 1000;
          const vb = accel * tb;
          const hb = 0.5 * accel * tb * tb;
          const tau = Math.max(0, t - tb);
          const apexReached = rocket.cutAt !== null && tau >= vb / GRAVITY;
          const tc = apexReached ? vb / GRAVITY : tau;
          rocket.y = g.padTop - (hb + vb * tc - 0.5 * GRAVITY * tc * tc);
          if (rocket.burning) {
            smoke.burst(g.rx, rocket.y + 34, { count: 3, speed: 60, up: false, colors: ['rgba(200,200,210,0.7)', 'rgba(255,170,90,0.8)'], size: 4, decay: 1.2 });
          }
          if (apexReached) {
            const { i, note } = yToValue(rocket.y);
            const strength = n > 1 ? i / (n - 1) : 0.5;
            const shownY = Math.max(rocket.y, 18);
            fx.burst(g.rx, shownY, {
              count: Math.round(24 + strength * 40),
              speed: 120 + strength * 220,
              up: false,
              colors: ['#ffd36b', '#ff8a5b', '#7ee0c3', '#c58bff', '#6cb6ff'],
              size: 2.5,
              decay: 0.9,
            });
            quake.hit(2 + strength * 6);
            peak = { y: valueY(i, n), at: now };
            callout.show(values[i], g.rx + 46, shownY + 10, note);
            rocket = null;
            p.current.onPick(values[i]);
          }
        }

        smoke.draw(ctx, dt, -40);
        // Rocket body
        // After a launch, a fresh rocket rolls back onto the pad once the fireworks settle.
        const ry = rocket ? rocket.y : peak && now - peak.at < 1600 ? null : g.padTop;
        if (ry !== null && (!disabled || rocket)) {
          const shake = rocket?.burning ? (Math.random() - 0.5) * 2 : 0;
          const drawY = Math.max(ry, 14);
          ctx.save();
          ctx.translate(g.rx + shake, drawY);
          if (rocket?.burning) {
            const f = 18 + Math.random() * 14;
            const flame = ctx.createLinearGradient(0, 30, 0, 30 + f);
            flame.addColorStop(0, '#fff3b0');
            flame.addColorStop(0.5, '#ffb703');
            flame.addColorStop(1, 'rgba(229,72,77,0)');
            ctx.fillStyle = flame;
            ctx.beginPath();
            ctx.moveTo(-7, 30);
            ctx.lineTo(0, 30 + f);
            ctx.lineTo(7, 30);
            ctx.fill();
          }
          ctx.fillStyle = '#e5484d';
          ctx.beginPath();
          ctx.moveTo(-9, 22);
          ctx.lineTo(-16, 32);
          ctx.lineTo(-9, 30);
          ctx.moveTo(9, 22);
          ctx.lineTo(16, 32);
          ctx.lineTo(9, 30);
          ctx.fill();
          ctx.fillStyle = '#f5f7fb';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(11, 10, 9, 30);
          ctx.lineTo(-9, 30);
          ctx.quadraticCurveTo(-11, 10, 0, 0);
          ctx.fill();
          ctx.fillStyle = '#6cb6ff';
          ctx.beginPath();
          ctx.arc(0, 14, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          if (ry < 14) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '700 10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`▲ ${Math.round(14 - ry)}`, g.rx, 0);
          }
        }
        // Little flag where the last rocket peaked
        if (peak) {
          ctx.strokeStyle = '#ffd36b';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(g.rx + 20, peak.y);
          ctx.lineTo(g.rulerX - 4, peak.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        fx.draw(ctx, dt, 120);
        callout.draw(ctx, c, now, W - 70);

        if (rocket?.burning || (rocket && burnStart !== null)) {
          const fuel = fuelLeft(now);
          drawMeter(ctx, c, 14, 24, Math.min(160, W * 0.35), 10, 1 - fuel, fuel <= 0 ? 'TANK EMPTY!' : strengthWords(1 - fuel).toUpperCase());
        } else if (!rocket && !peak && !disabled) {
          hint(ctx, { ...c, label: 'rgba(255,255,255,0.8)' }, W - 70, W < 520 ? 'Hold to burn fuel, let go to coast' : 'Hold to burn fuel — the harder the task, the longer the burn', 22);
        }
        ctx.restore();
      },
    };
  });

  useOnRound(props.round, () => reset.current());

  return <GameFrame wrapRef={wrapRef} canvasRef={canvasRef} disabled={props.disabled} label="Rocket: hold to burn fuel, release to coast; the peak altitude picks a value" />;
}
