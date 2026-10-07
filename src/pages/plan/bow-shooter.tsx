import { useEffect, useRef } from 'react';

interface Props {
  /** Numeric values, ascending, laid out left to right along the ground. */
  scale: string[];
  selected: string | null;
  disabled?: boolean;
  /** Changes when a new round starts so the stuck arrows get cleared. */
  round: number;
  onPick: (value: string) => void;
}

interface Arrow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: { x: number; y: number }[];
}

interface Stuck {
  x: number;
  angle: number;
  value: string;
  at: number;
}

const HEIGHT = 300;
const GRAVITY = 1100;
const MAX_PULL = 150;
const MIN_ANGLE = (-5 * Math.PI) / 180;
const MAX_ANGLE = (85 * Math.PI) / 180;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function palette() {
  const dark = document.documentElement.classList.contains('dark');
  return dark
    ? {
        skyTop: '#0b1222',
        skyBottom: '#1b2a45',
        hill: '#16233a',
        ground: '#1d2b22',
        tileA: '#24402f',
        tileB: '#2c4c38',
        label: '#9fb0c8',
        bow: '#d9a35b',
        string: '#e8ebf0',
        arrow: '#e8ebf0',
        text: '#e8ebf0',
      }
    : {
        skyTop: '#bfe0ff',
        skyBottom: '#eef7ff',
        hill: '#cfe6d6',
        ground: '#7cb36b',
        tileA: '#8cc47a',
        tileB: '#a2d38f',
        label: '#475467',
        bow: '#8a5a2b',
        string: '#3b4252',
        arrow: '#2b2f38',
        text: '#1c2430',
      };
}

export function BowShooter({ scale, selected, disabled, round, onPick }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ scale, selected, disabled, onPick });
  props.current = { scale, selected, disabled, onPick };
  const stuckRef = useRef<Stuck[]>([]);

  useEffect(() => {
    stuckRef.current = [];
  }, [round]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let width = wrap.clientWidth;
    let raf = 0;
    let last = performance.now();

    // Aim / flight state lives outside React: it changes every frame.
    let aim: { ox: number; oy: number; px: number; py: number } | null = null;
    let arrow: Arrow | null = null;
    let landedFlash: { value: string; x: number; at: number; note: string } | null = null;
    // Landing impact: dust kicked up + a short screen shake, both stronger further along the field.
    let dust: { x: number; y: number; vx: number; vy: number; r: number; life: number }[] = [];
    let quake = { at: 0, strength: 0 };

    const geo = () => {
      const groundY = HEIGHT - 46;
      const ax = Math.max(44, Math.min(70, width * 0.09));
      const ay = groundY - 40;
      const fieldStart = ax + 56;
      const fieldEnd = width - 14;
      const n = Math.max(1, props.current.scale.length);
      const slotW = (fieldEnd - fieldStart) / n;
      // Full draw at 45° reaches a bit past the end of the field.
      const vmax = Math.sqrt((fieldEnd - ax) * 1.12 * GRAVITY);
      return { groundY, ax, ay, fieldStart, fieldEnd, n, slotW, vmax };
    };

    const resize = () => {
      width = wrap.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${HEIGHT}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const aimState = () => {
      if (!aim) return null;
      const dx = aim.ox - aim.px;
      const dy = aim.oy - aim.py;
      const power = clamp(Math.hypot(dx, dy) / MAX_PULL, 0, 1);
      const angle = clamp(Math.atan2(-dy, Math.max(dx, 0.0001)), MIN_ANGLE, MAX_ANGLE);
      return { power, angle };
    };

    const point = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      if (props.current.disabled || arrow || !props.current.scale.length) return;
      const p = point(e);
      aim = { ox: p.x, oy: p.y, px: p.x, py: p.y };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (!aim) return;
      const p = point(e);
      aim.px = p.x;
      aim.py = p.y;
    };
    const onUp = () => {
      const s = aimState();
      aim = null;
      if (!s || s.power < 0.06) return;
      const g = geo();
      const v = g.vmax * s.power;
      arrow = { x: g.ax, y: g.ay, vx: v * Math.cos(s.angle), vy: -v * Math.sin(s.angle), trail: [] };
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', () => (aim = null));

    const land = (x: number, angle: number) => {
      const g = geo();
      const { scale: values } = props.current;
      const i = clamp(Math.floor((x - g.fieldStart) / g.slotW), 0, values.length - 1);
      const value = values[i];
      const note = x < g.fieldStart ? 'too gentle!' : x > g.fieldEnd ? 'off the charts!' : '';
      const stuckX = clamp(x, g.fieldStart + 4, width - 8);
      stuckRef.current = [...stuckRef.current.slice(-5), { x: stuckX, angle, value, at: performance.now() }];
      landedFlash = { value, x: stuckX, at: performance.now(), note };
      const strength = values.length > 1 ? i / (values.length - 1) : 0.5;
      const count = Math.round(10 + strength * 22);
      for (let k = 0; k < count; k++) {
        const a = Math.PI + Math.random() * Math.PI; // upward half
        const sp = 60 + Math.random() * (90 + strength * 200);
        dust.push({ x: stuckX, y: g.groundY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 1.5 + Math.random() * (2 + strength * 3), life: 1 });
      }
      quake = { at: performance.now(), strength: 2 + strength * 7 };
      props.current.onPick(value);
    };

    const drawArrow = (x: number, y: number, angle: number, len = 34, color: string) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(-5, -4);
      ctx.lineTo(-5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e5484d';
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(-len - 6, -5);
      ctx.lineTo(-len + 4, 0);
      ctx.lineTo(-len - 6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const frame = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const c = palette();
      const g = geo();
      const { scale: values, selected: sel, disabled: off } = props.current;

      const st = (now - quake.at) / 1000;
      const amp = st < 0.35 ? quake.strength * (1 - st / 0.35) : 0;
      ctx.save();
      if (amp) ctx.translate((Math.random() - 0.5) * amp * 2, (Math.random() - 0.5) * amp * 2);

      // Sky and hills
      const sky = ctx.createLinearGradient(0, 0, 0, g.groundY);
      sky.addColorStop(0, c.skyTop);
      sky.addColorStop(1, c.skyBottom);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, HEIGHT);
      ctx.fillStyle = c.hill;
      ctx.beginPath();
      ctx.moveTo(0, g.groundY);
      for (let x = 0; x <= width; x += 20) ctx.lineTo(x, g.groundY - 26 - Math.sin(x / 90) * 14 - Math.sin(x / 37) * 5);
      ctx.lineTo(width, g.groundY);
      ctx.fill();

      // Ground + target field
      ctx.fillStyle = c.ground;
      ctx.fillRect(0, g.groundY, width, HEIGHT - g.groundY);
      const labelEvery = Math.max(1, Math.ceil(30 / g.slotW));
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const selIdx = sel === null ? -1 : values.indexOf(sel);
      values.forEach((v, i) => {
        const x = g.fieldStart + i * g.slotW;
        const isSel = v === sel;
        ctx.fillStyle = isSel ? '#ffd36b' : i % 2 ? c.tileA : c.tileB;
        ctx.fillRect(x, g.groundY, Math.max(1, g.slotW - (g.slotW > 4 ? 1 : 0)), 10);
        // The picked value always gets a label; neighbours that would collide with it give way.
        if (isSel || (i % labelEvery === 0 && (selIdx < 0 || Math.abs(i - selIdx) >= labelEvery))) {
          ctx.fillStyle = isSel ? c.text : c.label;
          ctx.font = isSel ? '800 12px system-ui, sans-serif' : '600 11px system-ui, sans-serif';
          ctx.fillText(v, x + g.slotW / 2, g.groundY + 16);
        }
      });

      // Stuck arrows from earlier shots this round
      for (const s of stuckRef.current) {
        const age = (now - s.at) / 1000;
        ctx.globalAlpha = s === stuckRef.current.at(-1) ? 1 : 0.35;
        const wobble = Math.sin(age * 30) * Math.exp(-age * 6) * 0.15;
        drawArrow(s.x, g.groundY + 3, s.angle + wobble, 34, c.arrow);
      }
      ctx.globalAlpha = 1;

      // Archer: a bow that rotates with the aim and bends with the pull
      const s = aimState();
      const angle = s ? s.angle : 0.6;
      const power = s?.power ?? 0;
      const shake = power > 0.75 ? (Math.random() - 0.5) * (power - 0.75) * 10 : 0;
      ctx.save();
      ctx.translate(g.ax + shake, g.ay + shake);
      // body
      ctx.strokeStyle = c.text;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-14, 6);
      ctx.lineTo(-14, 30);
      ctx.moveTo(-14, 30);
      ctx.lineTo(-22, 40);
      ctx.moveTo(-14, 30);
      ctx.lineTo(-6, 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-14, -2, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.rotate(-angle);
      const pull = power * 26;
      const bend = 14 + power * 6;
      ctx.strokeStyle = c.bow;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-4, -22);
      ctx.quadraticCurveTo(bend, 0, -4, 22);
      ctx.stroke();
      const tension = Math.round(power * 255);
      ctx.strokeStyle = power > 0.05 ? `rgb(${Math.max(tension, 120)}, ${255 - tension}, ${255 - tension})` : c.string;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-4, -22);
      ctx.lineTo(-4 - pull, 0);
      ctx.lineTo(-4, 22);
      ctx.stroke();
      ctx.restore();
      if (!arrow && !off) {
        const nock = 26 * power;
        drawArrow(g.ax + shake + Math.cos(angle) * (20 - nock), g.ay + shake - Math.sin(angle) * (20 - nock), -angle, 34, c.arrow);
      }

      if (s && s.power > 0.06) {
        const words = s.power < 0.3 ? 'easy peasy' : s.power < 0.6 ? 'hmm…' : s.power < 0.85 ? 'tough one' : 'SO HARD!!';
        ctx.font = `800 ${12 + s.power * 8}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = s.power > 0.85 ? '#e5484d' : c.text;
        ctx.fillText(words, g.ax - 30, g.ay - 34);
      }

      // Flight
      if (arrow) {
        arrow.vy += GRAVITY * dt;
        arrow.x += arrow.vx * dt;
        arrow.y += arrow.vy * dt;
        arrow.trail.push({ x: arrow.x, y: arrow.y });
        if (arrow.trail.length > 18) arrow.trail.shift();
        arrow.trail.forEach((p, i) => {
          ctx.fillStyle = `rgba(255, 211, 107, ${(i / arrow!.trail.length) * 0.6})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.5 + i / 10, 0, Math.PI * 2);
          ctx.fill();
        });
        const a = Math.atan2(arrow.vy, arrow.vx);
        if (arrow.y < 0) {
          // Above the frame: show where it is horizontally
          ctx.fillStyle = c.text;
          ctx.font = '700 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(`▲ ${Math.round(-arrow.y)}`, clamp(arrow.x, 20, width - 20), 4);
        } else {
          drawArrow(arrow.x, arrow.y, a, 34, c.arrow);
        }
        if (arrow.y >= g.groundY) {
          const hit = arrow;
          arrow = null;
          land(hit.x, a);
        }
      }

      // Landing callout
      if (landedFlash) {
        const t = (now - landedFlash.at) / 1000;
        if (t > 1.6) landedFlash = null;
        else {
          ctx.globalAlpha = clamp(1.6 - t, 0, 1);
          ctx.font = '900 22px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = '#ffb703';
          const lx = clamp(landedFlash.x, 40, width - 40);
          ctx.fillText(landedFlash.value, lx, g.groundY - 30 - t * 30);
          if (landedFlash.note) {
            ctx.font = '700 12px system-ui, sans-serif';
            ctx.fillStyle = c.text;
            ctx.fillText(landedFlash.note, lx, g.groundY - 56 - t * 30);
          }
          ctx.globalAlpha = 1;
        }
      }

      if (!s && !arrow && !off && !stuckRef.current.length) {
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = c.label;
        ctx.fillText(width < 520 ? 'Drag back & let go — harder task, harder pull' : 'Drag back anywhere and let go — the harder the task, the harder you pull', width / 2, 34);
      }

      // Dust from the last landing
      if (dust.length) {
        for (const d of dust) {
          d.vy += 500 * dt;
          d.x += d.vx * dt;
          d.y = Math.min(g.groundY, d.y + d.vy * dt);
          d.life -= dt * 1.4;
          ctx.globalAlpha = Math.max(0, d.life);
          ctx.fillStyle = c.label;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        dust = dust.filter((d) => d.life > 0);
      }
      // Shockwave on the ground
      if (landedFlash && now - landedFlash.at < 450) {
        const t = (now - landedFlash.at) / 450;
        ctx.strokeStyle = `rgba(255, 211, 107, ${1 - t})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(landedFlash.x, g.groundY + 2, 6 + t * (20 + quake.strength * 6), 3 + t * 6, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <div ref={wrapRef} className="w-full overflow-hidden rounded-lg border">
      <canvas
        ref={canvasRef}
        className={disabled ? 'block cursor-not-allowed opacity-60' : 'block cursor-crosshair touch-none'}
        aria-label="Bow and arrow: drag back and release to pick a point value"
        role="img"
      />
    </div>
  );
}
