import { useMemo, type CSSProperties } from 'react';

const COLORS = ['var(--primary)', '#ffd36b', '#ff8a5b', '#7ee0c3'];

/**
 * Shockwave ring + sparks around a card the moment it's picked. `intensity` (0–1) scales the
 * hit: bigger numbers burst wider with more sparks. Remount (via `key`) to replay.
 */
export function PickBurst({ intensity }: { intensity: number }) {
  const sparks = useMemo(() => {
    const count = Math.round(6 + intensity * 12);
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 26 + intensity * 46 + Math.random() * 14;
      const size = 4 + Math.random() * (4 + intensity * 5);
      return {
        '--dx': `${Math.cos(angle) * dist}px`,
        '--dy': `${Math.sin(angle) * dist}px`,
        width: size,
        height: size,
        color: COLORS[i % COLORS.length],
        background: 'currentColor',
        animationDelay: `${Math.random() * 60}ms`,
      } as CSSProperties;
    });
  }, [intensity]);

  return (
    <span className="pointer-events-none absolute inset-0 rounded-[inherit]" aria-hidden>
      <span className="pick-ring" style={{ '--ring-scale': 1.3 + intensity * 0.9 } as CSSProperties} />
      {intensity > 0.6 && <span className="pick-ring pick-ring-late" style={{ '--ring-scale': 1.8 + intensity } as CSSProperties} />}
      {sparks.map((s, i) => (
        <span key={i} className="pick-spark" style={s} />
      ))}
    </span>
  );
}
