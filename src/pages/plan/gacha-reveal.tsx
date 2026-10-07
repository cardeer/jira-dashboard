import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { StarIcon } from 'lucide-react';
import { cardRarity, formatNumber, RARITY_COLOR, roundRarity, voteStats, type Rarity } from './points';

export interface RevealedVote {
  id: string;
  name: string;
  vote: string;
}

interface Props {
  votes: RevealedVote[];
  points: string[];
  onClose: () => void;
}

const METEOR_MS = 1250;
const CARD_STAGGER_MS = 260;

const RARITY_TITLE: Record<Rarity, string> = {
  5: 'Perfect consensus!',
  4: 'Close call',
  3: 'The team is split',
};

/** A sky full of stars, generated once per reveal. */
function useStars(count: number) {
  return useMemo(
    () =>
      Array.from({ length: count }, () => {
        const size = Math.random() < 0.9 ? 1 + Math.random() * 1.5 : 2.5 + Math.random() * 1.5;
        return {
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          width: size,
          height: size,
          opacity: 0.3 + Math.random() * 0.7,
        };
      }),
    [count],
  );
}

export function GachaReveal({ votes, points, onClose }: Props) {
  
  const values = useMemo(() => votes.map((v) => v.vote), [votes]);
  const stats = useMemo(() => voteStats(values, points), [values, points]);
  const rarity = roundRarity(values, points);
  const stars = useStars(110);
  // meteor -> cards (staggered) -> summary. A click skips ahead; a click on the summary closes.
  const [phase, setPhase] = useState<'meteor' | 'cards' | 'summary'>('meteor');

  useEffect(() => {
    if (phase === 'meteor') {
      const t = setTimeout(() => setPhase('cards'), METEOR_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'cards') {
      const t = setTimeout(() => setPhase('summary'), 700 + votes.length * CARD_STAGGER_MS);
      return () => clearTimeout(t);
    }
  }, [phase, votes.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const advance = () => {
    if (phase === 'summary') onClose();
    else setPhase('summary');
  };

  const skipped = phase === 'summary';
  const color = RARITY_COLOR[rarity];

  return (
    <div
      className="gacha"
      style={{ '--rarity': color } as CSSProperties}
      onClick={advance}
      role="dialog"
      aria-modal="true"
      aria-label="Revealed points"
    >
      <div className="gacha-stars" aria-hidden>
        {stars.map((s, i) => (
          <span key={i} className="gacha-star" style={s} />
        ))}
      </div>

      {phase === 'meteor' && <div className="gacha-meteor" aria-hidden />}
      {phase !== 'meteor' && (
        <>
          <div className="gacha-flash" aria-hidden />
          <div className="gacha-ring" aria-hidden />
        </>
      )}

      {phase !== 'meteor' && (
        <div className="relative flex h-full flex-col items-center justify-center gap-8 overflow-y-auto px-4 py-10">
          <div className="gacha-title text-center">
            <div className="flex justify-center gap-1">
              {Array.from({ length: rarity }, (_, i) => (
                <StarIcon key={i} className="gacha-star-icon size-5 fill-current" style={{ animationDelay: `${300 + i * 90}ms` }} />
              ))}
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-wide sm:text-3xl">{RARITY_TITLE[rarity]}</h2>
          </div>

          <div className="flex max-w-5xl flex-wrap justify-center gap-4">
            {votes.map((v, i) => {
              const r = cardRarity(v.vote, values, points);
              const delay = skipped ? 0 : 200 + i * CARD_STAGGER_MS;
              return (
                <div key={v.id} className="gacha-card-wrap" style={{ animationDelay: `${delay}ms` }}>
                  <div
                    className="gacha-card flex h-40 w-28 flex-col items-center justify-between px-2 py-3 sm:h-44 sm:w-32"
                    data-rarity={r}
                    style={{ '--rarity': RARITY_COLOR[r], animationDelay: `${delay}ms` } as CSSProperties}
                  >
                    <div className="flex gap-0.5">
                      {Array.from({ length: r }, (_, k) => (
                        <StarIcon
                          key={k}
                          className="gacha-star-icon size-3 fill-current"
                          style={{ animationDelay: `${delay + 350 + k * 70}ms` }}
                        />
                      ))}
                    </div>
                    <div className="gacha-value text-4xl font-black sm:text-5xl">{v.vote}</div>
                    <div className="w-full truncate text-center text-xs font-medium text-white/80" title={v.name}>
                      {v.name}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {phase === 'summary' && (
            <div className="gacha-summary flex flex-col items-center gap-3">
              <div className="flex flex-wrap justify-center gap-6 text-center">
                <Stat label="Average" value={formatNumber(stats.average)} />
                <Stat label="Median" value={formatNumber(stats.median)} />
                <Stat label="Most picked" value={stats.mode.join(', ') || '—'} />
              </div>
              <p className="text-xs text-white/50">Click anywhere to continue</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-white/50">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
