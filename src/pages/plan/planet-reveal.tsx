import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FastForwardIcon } from 'lucide-react';
import { PickBurst } from './pick-burst';
import { formatNumber, voteStats } from './points';
import { planetTexture, type PlanetKind } from './planet-texture';
import type { RevealedVote } from './gacha-reveal';

interface Props {
  votes: RevealedVote[];
  points: string[];
  onClose: () => void;
  /** Turn on "always skip" for this viewer; the reveal closes straight to the results. */
  onAlwaysSkip?: () => void;
}

const WARP_MS = 900;
const ARRIVE_STAGGER_MS = 560;
const ARRIVE_MS = 1000;
/** When an arriving planet hits its spot (the 72% mark of planet-arrive); it ignites then. */
const LAND_MS = 720;
/** Consensus: once everyone has arrived, their planets collide into one. */
const GATHER_MS = 600;

/** Planet skins, as [light side, dark side]. The outlier always gets the red one. */
const SKINS: [string, string][] = [
  ['#8fd3ff', '#1d4d8f'],
  ['#ffd36b', '#a5520f'],
  ['#9ff0c4', '#16715a'],
  ['#d7a8ff', '#55248f'],
  ['#ffb38a', '#8f3a1d'],
  ['#f5f1e6', '#5d6077'],
];
const OUTLIER_SKIN: [string, string] = ['#ff8c8c', '#7a1730'];

type Planet = {
  value: string;
  names: string[];
  /** 0–1 position on the point scale: decides orbit and size. */
  pos: number;
  size: number;
  orbit: number;
  angle: number;
  skin: [string, string];
  outlier: boolean;
  /** Gas giants get a ring. */
  ringed: boolean;
  kind: PlanetKind;
};

/** Index on the scale the team leans towards: the single most common card, else the median card. */
function centreIndex(votes: string[], points: string[]) {
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const leaders = [...counts].filter(([, c]) => c === top).map(([v]) => v);
  if (leaders.length === 1 && points.includes(leaders[0])) return points.indexOf(leaders[0]);
  const idx = votes.map((v) => points.indexOf(v)).filter((n) => n >= 0).sort((a, b) => a - b);
  if (!idx.length) return -1;
  return idx.length % 2 ? idx[(idx.length - 1) / 2] : (idx[idx.length / 2 - 1] + idx[idx.length / 2]) / 2;
}

/** One planet per distinct vote; a lone vote far from everyone else is the outlier that drifts off. */
function buildPlanets(votes: RevealedVote[], points: string[]): Planet[] {
  const groups = new Map<string, string[]>();
  for (const v of votes) groups.set(v.vote, [...(groups.get(v.vote) ?? []), v.name]);
  const ordered = [...groups].sort(([a], [b]) => points.indexOf(a) - points.indexOf(b));
  const centre = centreIndex(
    votes.map((v) => v.vote),
    points,
  );
  const far = Math.max(2, Math.round(points.length * 0.2));
  const distance = (value: string) => (centre < 0 || points.indexOf(value) < 0 ? 0 : Math.abs(points.indexOf(value) - centre));
  const maxDistance = Math.max(...ordered.map(([value]) => distance(value)));
  const n = ordered.length;
  return ordered.map(([value, names], i) => {
    const pi = points.indexOf(value);
    const pos = pi < 0 ? 0.3 : points.length > 1 ? pi / (points.length - 1) : 0.5;
    const outlier = votes.length >= 3 && n >= 2 && names.length === 1 && distance(value) === maxDistance && maxDistance >= far;
    return {
      value,
      names,
      pos,
      size: 9 + pos * 13,
      orbit: n === 1 ? 0 : 15 + (i / Math.max(1, n - 1)) * 22,
      // Golden angle keeps neighbouring orbits from lining their planets up.
      angle: (i * 137.5 + 20) % 360,
      skin: outlier ? OUTLIER_SKIN : SKINS[i % SKINS.length],
      outlier,
      ringed: pos > 0.6,
      // Small values are cratered moons, big ones gas giants; the outlier is a world on fire.
      kind: outlier ? 'lava' : pos > 0.6 ? 'gas' : pos < 0.25 ? 'rocky' : 'terran',
    };
  });
}

function namesLabel(names: string[]) {
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Votes drop out of hyperspace as planets: matching votes share an orbit, outliers drift away. */
export function PlanetReveal({ votes, points, onClose, onAlwaysSkip }: Props) {
  const planets = useMemo(() => buildPlanets(votes, points), []);
  const stats = useMemo(
    () =>
      voteStats(
        votes.map((v) => v.vote),
        points,
      ),
    [],
  );
  const consensus = votes.length >= 2 && planets.length === 1;
  const outliers = planets.filter((p) => p.outlier);
  const [phase, setPhase] = useState<'warp' | 'arrive' | 'settle' | 'summary'>(() => (prefersReducedMotion() ? 'summary' : 'warp'));
  const skipped = phase === 'summary';
  const stageRef = useRef<HTMLDivElement>(null);
  /** Rattle the whole scene; `power` 0-1+ scales how hard. */
  const shake = (power: number) => {
    const a = 3 + power * 14;
    stageRef.current?.animate(
      [
        { transform: 'translate(0, 0)' },
        { transform: `translate(${a}px, ${-a * 0.6}px) rotate(${power * 0.6}deg)` },
        { transform: `translate(${-a * 0.8}px, ${a * 0.5}px) rotate(${-power * 0.5}deg)` },
        { transform: `translate(${a * 0.5}px, ${a * 0.3}px)` },
        { transform: `translate(${-a * 0.25}px, ${-a * 0.2}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 320 + power * 260, easing: 'ease-out' },
    );
  };
  const arriveMs = consensus
    ? votes.length * ARRIVE_STAGGER_MS + ARRIVE_MS + GATHER_MS
    : planets.length * ARRIVE_STAGGER_MS + ARRIVE_MS;

  // Each landing rattles the scene (bigger planets harder); the consensus merge hits hardest.
  useEffect(() => {
    if (phase === 'arrive') {
      const hits = consensus ? votes.map(() => 0.25) : planets.map((p) => 0.25 + p.pos * 0.75);
      const timers = hits.map((power, i) => setTimeout(() => shake(power), i * ARRIVE_STAGGER_MS + LAND_MS));
      return () => timers.forEach(clearTimeout);
    }
    if (phase === 'settle' && consensus) shake(1.4);
    if (phase === 'settle' && outliers.length) {
      const t = setTimeout(() => shake(0.5), 200);
      return () => clearTimeout(t);
    }
  }, [phase]);

  useEffect(() => {
    const next = { warp: 'arrive', arrive: 'settle', settle: 'summary' } as const;
    if (phase === 'summary') return;
    const ms = {
      warp: WARP_MS,
      arrive: arriveMs,
      settle: consensus ? 2600 : outliers.length ? 3000 : 1600,
    }[phase];
    const t = setTimeout(() => setPhase(next[phase]), ms);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stars = useMemo(
    () =>
      Array.from({ length: 120 }, () => ({
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        width: Math.random() < 0.9 ? 1.5 : 3,
        height: Math.random() < 0.9 ? 1.5 : 3,
        opacity: 0.3 + Math.random() * 0.7,
      })),
    [],
  );
  const streaks = useMemo(
    () =>
      Array.from({ length: 140 }, () => ({
        '--a': `${Math.random() * 360}deg`,
        '--len': `${20 + Math.random() * 30}vmax`,
        animationDelay: `${Math.random() * 300}ms`,
      })) as CSSProperties[],
    [],
  );

  const title = consensus
    ? 'Perfect consensus!'
    : outliers.length
      ? 'Houston, we have a problem'
      : planets.length === 2
        ? 'Two worlds'
        : planets.length === 1
          ? 'A lonely planet'
          : 'A scattered system';

  return (
    <div
      className={`gacha planets ${skipped ? 'planets-skip' : ''}`}
      onClick={() => (skipped ? onClose() : setPhase('summary'))}
      role="dialog"
      aria-modal="true"
      aria-label="Revealed points"
    >
      {!skipped && (
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {onAlwaysSkip && (
            <button
              type="button"
              onClick={onAlwaysSkip}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              Always skip
            </button>
          )}
          <button
            type="button"
            onClick={() => setPhase('summary')}
            autoFocus
            className="flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/20"
          >
            Skip <FastForwardIcon className="size-4" />
          </button>
        </div>
      )}

      <div className="gacha-stars" aria-hidden>
        {stars.map((s, i) => (
          <span key={i} className="gacha-star" style={s} />
        ))}
      </div>

      {phase === 'warp' && (
        <div className="absolute inset-0" aria-hidden>
          {streaks.map((s, i) => (
            <span key={i} className="planet-streak" style={s} />
          ))}
        </div>
      )}

      {phase !== 'warp' && !skipped && <div className="planet-warp-flash" aria-hidden />}
      {phase === 'settle' && consensus && <div className="planet-gold-flash" aria-hidden />}
      {phase === 'settle' && outliers.length > 0 && <div className="planet-alert" aria-hidden />}

      {phase !== 'warp' && (
        <div ref={stageRef} className="flex h-full items-center justify-center px-4 pb-36">
          <div
            className="planet-camera relative size-(--sys) shrink-0 [--sys:min(88vmin,calc(100vh_-_230px),860px)]"
            style={{ animationDuration: `${arriveMs}ms` }}
          >
            {consensus ? (
              <ConsensusSystem value={planets[0].value} votes={votes} merged={phase !== 'arrive'} animate={!skipped} />
            ) : (
              <>
                <div className="planet-sun" aria-hidden />
                {planets.map((p, i) => (
                  <Orbit
                    key={p.value}
                    planet={p}
                    delay={skipped ? 0 : i * ARRIVE_STAGGER_MS}
                    drifting={phase !== 'arrive'}
                    animate={!skipped}
                  />
                ))}
              </>
            )}
          </div>

          {phase !== 'arrive' && (
            <div className="planet-caption absolute inset-x-0 bottom-8 z-[1] flex flex-col items-center gap-3 px-4 text-center">
              <h2
                className={`planet-title text-3xl font-black tracking-wide sm:text-5xl ${consensus ? 'text-[#ffd36b]' : outliers.length ? 'text-[#ff8c8c]' : ''}`}
              >
                {title}
              </h2>
              {outliers.length > 0 && (
                <p className="text-base text-white/80 sm:text-lg">{outliers.flatMap((p) => p.names).join(' and ')} drifted off into space</p>
              )}
              {phase === 'summary' && (
                <>
                  <div className="flex flex-wrap justify-center gap-6">
                    <Stat label="Average" value={formatNumber(stats.average)} />
                    <Stat label="Median" value={formatNumber(stats.median)} />
                    <Stat label="Most picked" value={stats.mode.join(', ') || '—'} />
                  </div>
                  <p className="text-xs text-white/50">Click anywhere to continue</p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A dashed orbit around the sun with one planet on it, slowly circling. */
function Orbit({ planet: p, delay, drifting, animate }: { planet: Planet; delay: number; drifting: boolean; animate: boolean }) {
  const spin = `${70 + p.orbit * 3}s`;
  const rad = (p.angle * Math.PI) / 180;
  return (
    <div
      className="planet-orbit"
      style={{ width: `${p.orbit * 2}%`, height: `${p.orbit * 2}%`, '--start': `${p.angle}deg`, animationDuration: spin } as CSSProperties}
    >
      {/* Sits on top of the ring; the ring's spin carries it round, the counter-spin keeps it upright. */}
      <div className="absolute left-1/2 top-0">
        <div className="planet-counter" style={{ '--start': `${p.angle}deg`, animationDuration: spin } as CSSProperties}>
          <div
            className={p.outlier && drifting ? 'planet-drift' : undefined}
            style={{ '--dx': `calc(var(--sys) * ${Math.sin(rad) * 0.26})`, '--dy': `calc(var(--sys) * ${-Math.cos(rad) * 0.26})` } as CSSProperties}
          >
            <PlanetBody planet={p} delay={delay} from={{ x: Math.sin(rad), y: -Math.cos(rad) }} animate={animate} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A planet that streaks in as a blank comet, then ignites on landing: flash, shockwave,
 * debris, and only then the number.
 */
function PlanetBody({
  planet: p,
  delay,
  from,
  animate,
  power,
}: {
  planet: Pick<Planet, 'value' | 'names' | 'size' | 'skin' | 'ringed' | 'outlier' | 'kind'>;
  delay: number;
  /** Unit direction it flies in from; {0, 0} pops in place. */
  from: { x: number; y: number };
  animate: boolean;
  /** 0-1 debris strength; defaults from the planet's size. */
  power?: number;
}) {
  const flies = from.x !== 0 || from.y !== 0;
  const land = delay + (flies ? LAND_MS : 120);
  const trailAngle = (Math.atan2(from.y, from.x) * 180) / Math.PI;
  const texture = useMemo(() => planetTexture(p.kind, p.skin[0], p.skin[1], `${p.value}|${p.names.join()}`), [p.kind, p.value]);
  return (
    <div
      className="planet-arrive -translate-x-1/2 -translate-y-1/2"
      style={{ '--fx': `${from.x * 75}vmin`, '--fy': `${from.y * 75}vmin`, animationDelay: `${delay}ms` } as CSSProperties}
    >
      <div
        className="planet-body"
        data-ringed={p.ringed || undefined}
        style={
          {
            '--pd': `calc(var(--sys) * ${p.size / 100})`,
            width: 'var(--pd)',
            height: 'var(--pd)',
            '--tex': texture ? `url(${texture})` : 'none',
            // Bigger planets turn slower.
            '--turn': `${18 + p.size}s`,
            '--light': p.skin[0],
            '--dark': p.skin[1],
            fontSize: `max(14px, calc(var(--sys) * ${(p.size * 0.4) / 100}))`,
          } as CSSProperties
        }
      >
        {flies && <span className="planet-trail" style={{ '--ta': `${trailAngle}deg`, animationDelay: `${delay}ms` } as CSSProperties} aria-hidden />}
        <span className="planet-ignite" style={{ animationDelay: `${land}ms` }} aria-hidden />
        <span className="planet-number relative z-[1]" style={{ animationDelay: `${land}ms` }}>
          {p.value}
        </span>
        <span className="planet-shock" style={{ animationDelay: `${land}ms` }} aria-hidden />
        {animate && <PickBurst intensity={power ?? Math.min(1, 0.35 + p.size / 30)} delay={land} />}
      </div>
      <div className="planet-names" data-outlier={p.outlier || undefined} style={{ animationDelay: `${land + 150}ms` }}>
        {namesLabel(p.names)}
      </div>
    </div>
  );
}

/** Everyone picked the same card: one planet per voter flies in, then they collide into one. */
function ConsensusSystem({ value, votes, merged, animate }: { value: string; votes: RevealedVote[]; merged: boolean; animate: boolean }) {
  const skin: [string, string] = ['#ffe9a8', '#b8741a'];
  if (merged) {
    return (
      <>
        <div className="planet-nova" aria-hidden />
        <div className="planet-nova planet-nova-late" aria-hidden />
        <div className="planet-nova planet-nova-last" aria-hidden />
        <div className="absolute left-1/2 top-1/2">
          <div className="planet-merged">
            <PlanetBody
              planet={{ value, names: votes.map((v) => v.name), size: 30, skin, ringed: true, outlier: false, kind: 'gas' }}
              delay={0}
              from={{ x: 0, y: 0 }}
              animate={animate}
              power={1}
            />
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {votes.map((v, i) => {
        const a = (i / votes.length) * Math.PI * 2;
        return (
          <div
            key={v.id}
            className="absolute"
            style={{ left: `${50 + Math.sin(a) * 30}%`, top: `${50 - Math.cos(a) * 30}%` }}
          >
            <div
              className="planet-gather"
              style={{ animationDelay: `${(votes.length - 1) * ARRIVE_STAGGER_MS + ARRIVE_MS}ms`, '--gx': `calc(var(--sys) * ${-Math.sin(a) * 0.3})`, '--gy': `calc(var(--sys) * ${Math.cos(a) * 0.3})` } as CSSProperties}>
              <PlanetBody
                planet={{ value, names: [v.name], size: 13, skin, ringed: false, outlier: false, kind: 'terran' }}
                delay={i * ARRIVE_STAGGER_MS}
                from={{ x: Math.sin(a), y: -Math.cos(a) }}
                animate={animate}
              />
            </div>
          </div>
        );
      })}
    </>
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
