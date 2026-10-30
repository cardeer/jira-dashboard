import { useEffect, useMemo, type CSSProperties } from 'react';

const COLORS = ['#ffd36b', '#ff8a5b', '#7ee0c3', '#8fb3ff', '#f78fd0', 'var(--primary)'];
const DURATION = 3600;

/**
 * Everyone picked the same card: confetti rains over the page and a big banner slams in.
 * Doesn't block the page; calls `onDone` once it has played out.
 */
export function ConsensusCelebration({ value, onDone }: { value: string; onDone: () => void }) {
  const confetti = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => {
        const fromLeft = i % 2 === 0;
        return {
          left: fromLeft ? '-2%' : '102%',
          '--cx': `${(fromLeft ? 1 : -1) * (20 + Math.random() * 60)}vw`,
          '--cy': `${-10 - Math.random() * 45}vh`,
          '--cr': `${(Math.random() - 0.5) * 1440}deg`,
          width: 6 + Math.random() * 6,
          height: 10 + Math.random() * 8,
          background: COLORS[i % COLORS.length],
          borderRadius: Math.random() < 0.3 ? '9999px' : 2,
          animationDelay: `${Math.random() * 250}ms`,
          animationDuration: `${2200 + Math.random() * 1200}ms`,
        } as CSSProperties;
      }),
    [],
  );

  useEffect(() => {
    const t = setTimeout(onDone, DURATION);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-live="polite">
      <div className="consensus-flash" aria-hidden />
      {confetti.map((s, i) => (
        <span key={i} className="consensus-confetti" style={s} aria-hidden />
      ))}
      <div className="absolute inset-x-0 top-1/3 flex justify-center px-4">
        <div className="consensus-banner rounded-2xl border-2 border-amber-400 bg-background/95 px-8 py-4 text-center shadow-2xl">
          <div className="text-3xl font-black tracking-tight text-amber-500 sm:text-4xl">Consensus!</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Everyone picked <strong className="text-lg text-foreground">{value}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
