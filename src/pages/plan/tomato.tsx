import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Throw, ThrowItem } from './use-plan-room';

export const THROWABLES: Record<ThrowItem, { emoji: string; label: string; verb: string; fill: string; edge: string; shine: string }> = {
  tomato: { emoji: '🍅', label: 'Throw a tomato', verb: 'threw a tomato at you!', fill: '#d62828', edge: '#a4161a', shine: '#ef476f' },
  poop: { emoji: '💩', label: 'Throw poop', verb: 'threw poop at you!', fill: '#94622f', edge: '#5c3a17', shine: '#c08a52' },
};

const FLIGHT_MS = 750;

const seatEl = (id: string) => document.querySelector<HTMLElement>(`[data-seat="${CSS.escape(id)}"] [data-seat-card]`);

function center(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Tomatoes in flight, drawn above the page. Each one calls `onLand` when it hits (or can't find its seats). */
export function TomatoLayer({ throws, onLand }: { throws: Throw[]; onLand: (t: Throw) => void }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[65]" aria-hidden>
      {throws.map((t) => (
        <FlyingTomato key={t.n} t={t} onLand={onLand} />
      ))}
    </div>
  );
}

function FlyingTomato({ t, onLand }: { t: Throw; onLand: (t: Throw) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const onLandRef = useRef(onLand);
  onLandRef.current = onLand;

  useLayoutEffect(() => {
    const el = ref.current!;
    const target = seatEl(t.to);
    if (!target) {
      onLandRef.current(t);
      return;
    }
    const to = center(target);
    // From the thrower's seat, or from the edge of the screen if it isn't visible.
    const source = seatEl(t.from);
    const from = source ? center(source) : { x: to.x < window.innerWidth / 2 ? window.innerWidth + 40 : -40, y: to.y + 120 };
    const arc = Math.min(220, 60 + Math.hypot(to.x - from.x, to.y - from.y) * 0.45);
    const frames: Keyframe[] = [];
    for (let k = 0; k <= 16; k++) {
      const s = k / 16;
      const x = from.x + (to.x - from.x) * s;
      const y = from.y + (to.y - from.y) * s - arc * 4 * s * (1 - s);
      const scale = 0.8 + Math.sin(s * Math.PI) * 0.7;
      frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${s * 540}deg) scale(${scale})` });
    }
    const anim = el.animate(frames, { duration: FLIGHT_MS, easing: 'cubic-bezier(0.35, 0, 0.65, 1)', fill: 'forwards' });
    anim.onfinish = () => onLandRef.current(t);
    return () => anim.cancel();
  }, [t]);

  return (
    <span ref={ref} data-flying className="absolute left-0 top-0 text-3xl leading-none drop-shadow-md" style={{ transform: 'translate(-200px, -200px)' }}>
      {THROWABLES[t.item].emoji}
    </span>
  );
}

/** Irregular splat blob; `seed` keeps each splat's shape stable. */
export function SplatBlob({ seed, item = 'tomato', className }: { seed: number; item?: ThrowItem; className?: string }) {
  const look = THROWABLES[item];
  const { path, drops } = useMemo(() => {
    let r = seed * 9301 + 49297;
    const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    // Lumpy outline: random radii joined with smooth curves through the midpoints.
    const n = 11;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const rad = 28 + rand() * 12;
      return [50 + Math.cos(a) * rad, 50 + Math.sin(a) * rad];
    });
    const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = mid(pts[n - 1], pts[0]);
    let d = `M${start[0].toFixed(1)},${start[1].toFixed(1)}`;
    pts.forEach((pt, i) => {
      const m = mid(pt, pts[(i + 1) % n]);
      d += ` Q${pt[0].toFixed(1)},${pt[1].toFixed(1)} ${m[0].toFixed(1)},${m[1].toFixed(1)}`;
    });
    // Little flecks thrown around the blob
    const drops = Array.from({ length: 6 }, () => {
      const a = rand() * Math.PI * 2;
      const dist = 40 + rand() * 8;
      return { cx: 50 + Math.cos(a) * dist, cy: 50 + Math.sin(a) * dist, r: 2 + rand() * 3.5 };
    });
    return { path: d, drops };
  }, [seed]);
  return (
    <svg viewBox="0 0 100 100" overflow="visible" className={className} aria-hidden>
      <path d={path} fill={look.fill} stroke={look.edge} strokeWidth="2" strokeLinejoin="round" />
      {drops.map((dr, i) => (
        <circle key={`d${i}`} cx={dr.cx} cy={dr.cy} r={dr.r} fill={look.fill} />
      ))}
      <circle cx="42" cy="44" r="9" fill={look.shine} opacity="0.6" />
      {item === 'tomato' &&
        [
          [36, 58],
          [58, 40],
          [60, 60],
          [48, 30],
        ].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="2.4" ry="1.4" fill="#ffd166" />)}
      {item === 'poop' && <Stink />}
    </svg>
  );
}

/** Wavy green stink lines rising off a poop splat. */
function Stink() {
  return (
    <g fill="none" stroke="#7bc96f" strokeWidth="3" strokeLinecap="round" opacity="0.85">
      {[34, 50, 66].map((x, i) => (
        <path
          key={x}
          className="stink-line"
          style={{ animationDelay: `${i * 0.25}s` }}
          d={`M${x},20 q-6,-7 0,-14 q6,-7 0,-14`}
        />
      ))}
    </g>
  );
}

/** Shown to whoever got hit: a big splat on their screen that slides away. */
export function TomatoScreen({ fromName, item, n, onDone }: { fromName: string; item: ThrowItem; n: number; onDone: () => void }) {
  useEffect(() => {
    navigator.vibrate?.(120);
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);
  const pos = useMemo(() => ({ left: `${15 + ((n * 37) % 50)}%`, top: `${15 + ((n * 53) % 40)}%` }), [n]);
  return (
    <div className="pointer-events-none fixed inset-0 z-[66] overflow-hidden" role="status" aria-live="assertive">
      <div className="screen-splat absolute" style={pos}>
        <SplatBlob seed={n} item={item} className="size-[min(70vw,420px)]" />
      </div>
      <p className="screen-splat-text absolute inset-x-0 bottom-16 text-center text-2xl font-black text-white [text-shadow:0_2px_12px_rgb(0_0_0/0.6)]">
        {THROWABLES[item].emoji} {fromName} {THROWABLES[item].verb}
      </p>
    </div>
  );
}
