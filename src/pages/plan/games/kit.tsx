import { useEffect, useRef } from 'react';

/** Props every pick mini-game takes. */
export interface GameProps {
  /** Numeric values, ascending. */
  scale: string[];
  selected: string | null;
  disabled?: boolean;
  /** Changes when a new round starts so games can clear leftovers. */
  round: number;
  onPick: (value: string) => void;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function palette() {
  const dark = document.documentElement.classList.contains('dark');
  return dark
    ? {
        dark,
        skyTop: '#0b1222',
        skyBottom: '#1b2a45',
        hill: '#16233a',
        ground: '#1d2b22',
        tileA: '#24402f',
        tileB: '#2c4c38',
        label: '#9fb0c8',
        text: '#e8ebf0',
        wood: '#b98552',
        woodDark: '#8a5f37',
        line: '#e8ebf0',
      }
    : {
        dark,
        skyTop: '#bfe0ff',
        skyBottom: '#eef7ff',
        hill: '#cfe6d6',
        ground: '#7cb36b',
        tileA: '#8cc47a',
        tileB: '#a2d38f',
        label: '#475467',
        text: '#1c2430',
        wood: '#e2b47c',
        woodDark: '#c48d52',
        line: '#2b2f38',
      };
}
export type Palette = ReturnType<typeof palette>;

export interface Pointer {
  x: number;
  y: number;
  t: number;
}

export interface Game {
  frame(now: number, dt: number): void;
  down?(p: Pointer): boolean | void;
  move?(p: Pointer): void;
  up?(p: Pointer): void;
  cancel?(): void;
}

export interface Stage {
  ctx: CanvasRenderingContext2D;
  /** CSS pixels; updated on resize. */
  width: number;
  height: number;
}

/**
 * Canvas + rAF loop + pointer plumbing shared by the mini-games. `create` runs once; read
 * changing React props through refs. Return `true` from `down` to capture the pointer.
 */
export function useGameCanvas(height: number, create: (stage: Stage) => Game) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const createRef = useRef(create);
  createRef.current = create;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const stage: Stage = { ctx, width: wrap.clientWidth, height };
    const resize = () => {
      stage.width = wrap.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(stage.width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${stage.width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const game = createRef.current(stage);

    const point = (e: PointerEvent): Pointer => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
    };
    let active = false;
    const onDown = (e: PointerEvent) => {
      if (game.down?.(point(e))) {
        active = true;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    };
    const onMove = (e: PointerEvent) => active && game.move?.(point(e));
    const onUp = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      game.up?.(point(e));
    };
    const onCancel = () => {
      active = false;
      game.cancel?.();
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);

    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      game.frame(now, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
    };
  }, [height]);

  return { wrapRef, canvasRef };
}

export function GameFrame({
  wrapRef,
  canvasRef,
  disabled,
  label,
}: {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div ref={wrapRef} className="w-full overflow-hidden rounded-lg border">
      <canvas
        ref={canvasRef}
        className={disabled ? 'block cursor-not-allowed opacity-60' : 'block cursor-pointer touch-none select-none'}
        aria-label={label}
        role="img"
      />
    </div>
  );
}

/** Keep the latest props readable from inside the game loop. */
export function usePropsRef(props: GameProps) {
  const ref = useRef(props);
  ref.current = props;
  return ref;
}

/** Run `fn` whenever the round changes (after mount). */
export function useOnRound(round: number, fn: () => void) {
  const first = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    fnRef.current();
  }, [round]);
}

// ---------- shared drawing ----------

export function drawSky(ctx: CanvasRenderingContext2D, c: Palette, w: number, h: number, horizon: number, hills = true) {
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, c.skyTop);
  sky.addColorStop(1, c.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  if (!hills) return;
  ctx.fillStyle = c.hill;
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  for (let x = 0; x <= w; x += 20) ctx.lineTo(x, horizon - 26 - Math.sin(x / 90) * 14 - Math.sin(x / 37) * 5);
  ctx.lineTo(w, horizon);
  ctx.fill();
}

/** Value slots laid out from x0 to x1 at y, with labels below. Returns the slot width. */
export function drawSlots(
  ctx: CanvasRenderingContext2D,
  c: Palette,
  values: string[],
  selected: string | null,
  x0: number,
  x1: number,
  y: number,
  opts: { thickness?: number; labelGap?: number; colors?: [string, string] } = {},
) {
  const { thickness = 10, labelGap = 16, colors = [c.tileA, c.tileB] } = opts;
  const slotW = (x1 - x0) / Math.max(1, values.length);
  const every = Math.max(1, Math.ceil(30 / slotW));
  const selIdx = selected === null ? -1 : values.indexOf(selected);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  values.forEach((v, i) => {
    const x = x0 + i * slotW;
    const isSel = i === selIdx;
    ctx.fillStyle = isSel ? '#ffd36b' : colors[i % 2];
    ctx.fillRect(x, y, Math.max(1, slotW - (slotW > 4 ? 1 : 0)), thickness);
    if (isSel || (i % every === 0 && (selIdx < 0 || Math.abs(i - selIdx) >= every))) {
      ctx.fillStyle = isSel ? c.text : c.label;
      ctx.font = isSel ? '800 12px system-ui, sans-serif' : '600 11px system-ui, sans-serif';
      ctx.fillText(v, x + slotW / 2, y + labelGap);
    }
  });
  return slotW;
}

/** Index of the slot under x (clamped), and a note when x is outside the field. */
export function slotAt(x: number, x0: number, x1: number, count: number) {
  const slotW = (x1 - x0) / Math.max(1, count);
  const i = clamp(Math.floor((x - x0) / slotW), 0, count - 1);
  const note = x < x0 ? 'too gentle!' : x > x1 ? 'off the charts!' : '';
  return { i, note };
}

export function hint(ctx: CanvasRenderingContext2D, c: Palette, w: number, text: string, y = 30) {
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = c.label;
  ctx.fillText(text, w / 2, y);
}

export function strengthWords(power: number) {
  return power < 0.3 ? 'easy peasy' : power < 0.6 ? 'hmm…' : power < 0.85 ? 'tough one' : 'SO HARD!!';
}

/** Dust, sparks, confetti: simple gravity particles. */
export class Particles {
  items: { x: number; y: number; vx: number; vy: number; r: number; life: number; color: string; decay: number }[] = [];
  burst(
    x: number,
    y: number,
    { count = 16, speed = 160, up = true, colors = ['#9fb0c8'], size = 3, decay = 1.4 }: {
      count?: number;
      speed?: number;
      up?: boolean;
      colors?: string[];
      size?: number;
      decay?: number;
    } = {},
  ) {
    for (let k = 0; k < count; k++) {
      const a = up ? Math.PI + Math.random() * Math.PI : Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.items.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: size * (0.5 + Math.random()),
        life: 1,
        color: colors[k % colors.length],
        decay,
      });
    }
  }
  draw(ctx: CanvasRenderingContext2D, dt: number, gravity = 500, floor = Infinity) {
    for (const d of this.items) {
      d.vy += gravity * dt;
      d.x += d.vx * dt;
      d.y = Math.min(floor, d.y + d.vy * dt);
      d.life -= dt * d.decay;
      ctx.globalAlpha = Math.max(0, d.life);
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.items = this.items.filter((d) => d.life > 0);
  }
  clear() {
    this.items = [];
  }
}

/** Screen shake that decays over `ms`. Call `apply` inside ctx.save()/restore(). */
export class Quake {
  at = 0;
  strength = 0;
  constructor(private ms = 350) {}
  hit(strength: number) {
    this.at = performance.now();
    this.strength = strength;
  }
  apply(ctx: CanvasRenderingContext2D, now: number) {
    const t = (now - this.at) / this.ms;
    if (t >= 1) return;
    const amp = this.strength * (1 - t);
    ctx.translate((Math.random() - 0.5) * amp * 2, (Math.random() - 0.5) * amp * 2);
  }
}

/** The big floating number after a pick. */
export class Callout {
  item: { value: string; note: string; x: number; y: number; at: number } | null = null;
  show(value: string, x: number, y: number, note = '') {
    this.item = { value, note, x, y, at: performance.now() };
  }
  draw(ctx: CanvasRenderingContext2D, c: Palette, now: number, w: number) {
    const it = this.item;
    if (!it) return;
    const t = (now - it.at) / 1000;
    if (t > 1.6) {
      this.item = null;
      return;
    }
    const x = clamp(it.x, 40, w - 40);
    ctx.globalAlpha = clamp(1.6 - t, 0, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `900 ${22 + Math.max(0, 0.15 - t) * 60}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffb703';
    ctx.fillText(it.value, x, it.y - t * 30);
    if (it.note) {
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillStyle = c.text;
      ctx.fillText(it.note, x, it.y - 26 - t * 30);
    }
    ctx.globalAlpha = 1;
  }
}

/** Power gauge (for hold/timing games). */
export function drawMeter(ctx: CanvasRenderingContext2D, c: Palette, x: number, y: number, w: number, h: number, value: number, label: string) {
  ctx.fillStyle = c.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
  ctx.fillRect(x, y, w, h);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#4cc38a');
  g.addColorStop(0.6, '#ffd36b');
  g.addColorStop(1, '#e5484d');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w * clamp(value, 0, 1), h);
  ctx.strokeStyle = c.label;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.font = '700 10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = c.text;
  ctx.fillText(label, x, y - 3);
}
