import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  CrownIcon,
  EyeIcon,
  EyeOffIcon,
  LinkIcon,
  Loader2Icon,
  PencilIcon,
  RotateCcwIcon,
  SparklesIcon,
  SpadeIcon,
  UsersIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ModeToggle } from '@/components/mode-toggle';
import { cn } from '@/lib/utils';
import { BowShooter } from './bow-shooter';
import { Bowling } from './games/bowling';
import { Cannon } from './games/cannon';
import { Golf } from './games/golf';
import { Rocket } from './games/rocket';
import type { GameProps } from './games/kit';
import { GachaReveal, type RevealedVote } from './gacha-reveal';
import { PickBurst } from './pick-burst';
import { PokeAlert } from './poke-alert';
import { SplatBlob, TomatoLayer, TomatoScreen } from './tomato';
import { roomLink } from './index';
import { formatNumber, isNumeric, numericScale, tryParsePoints, voteStats } from './points';
import { REACTIONS, usePlanRoom, type Member, type ReactionKey, type RoomConfig, type SeatReaction, type Throw } from './use-plan-room';
import './plan.css';

const NAME_KEY = 'plan.name';
const MODE_KEY = 'plan.pickMode';

const PICK_MODES = [
  { key: 'cards', emoji: '🃏', label: 'Cards' },
  { key: 'bow', emoji: '🏹', label: 'Bow' },
  { key: 'cannon', emoji: '💣', label: 'Cannon' },
  { key: 'bowling', emoji: '🎳', label: 'Bowling' },
  { key: 'golf', emoji: '⛳', label: 'Golf' },
  { key: 'rocket', emoji: '🚀', label: 'Rocket' },
] as const;
type PickMode = (typeof PICK_MODES)[number]['key'];

const GAMES: Record<Exclude<PickMode, 'cards'>, (props: GameProps) => React.ReactNode> = {
  bow: BowShooter,
  cannon: Cannon,
  bowling: Bowling,
  golf: Golf,
  rocket: Rocket,
};

function readStored(key: string) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function PlanRoomPage() {
  const { roomId = '' } = useParams();
  const [params] = useSearchParams();
  const [name, setName] = useState('');

  const initialConfig = useMemo<RoomConfig | null>(() => {
    const n = params.get('n');
    const p = params.get('p');
    return n && p && !tryParsePoints(p).error ? { name: n, points: p } : null;
    // Only the link someone arrived with matters.
  }, []);

  if (!name) {
    return (
      <main className="min-h-svh bg-background">
        <NameDialog
          open
          title={initialConfig ? `Join “${initialConfig.name}”` : 'Join the room'}
          initial={readStored(NAME_KEY)}
          onSubmit={(n) => {
            store(NAME_KEY, n);
            setName(n);
          }}
        />
      </main>
    );
  }
  return <Room roomId={roomId} name={name} initialConfig={initialConfig} />;
}

function NameDialog({
  open,
  title,
  initial,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  initial: string;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) onSubmit(value.trim().slice(0, 30));
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel?.()}>
      <DialogContent
        showCloseButton={!!onCancel}
        onInteractOutside={(e) => !onCancel && e.preventDefault()}
        onEscapeKeyDown={(e) => !onCancel && e.preventDefault()}
        className="sm:max-w-sm"
      >
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>What should the team call you?</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="plan-name">Your name</Label>
            <Input id="plan-name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={30} autoFocus required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!value.trim()}>
              {onCancel ? 'Save' : 'Enter room'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Seat = Member & {
  id: string;
  self: boolean;
};

function Room({ roomId, name, initialConfig }: { roomId: string; name: string; initialConfig: RoomConfig | null }) {
  const {
    selfId,
    me,
    peers,
    room,
    revealCount,
    joinError,
    reactions,
    poked,
    incomingPoke,
    throws,
    updateRoom,
    setVote,
    setName,
    becomeHost,
    poke,
    react,
    dismissPoke,
    throwTomato,
    landThrow,
  } = usePlanRoom(
    roomId,
    name,
    initialConfig,
  );
  const [renaming, setRenaming] = useState(false);
  const [showReveal, setShowReveal] = useState(false);
  const [mode, setMode] = useState<PickMode>(() => {
    const stored = readStored(MODE_KEY);
    return PICK_MODES.find((m) => m.key === stored)?.key ?? 'cards';
  });
  // Light client-side throttles so nobody can spam pokes or reactions.
  const lastPoke = useRef<Record<string, number>>({});
  const [reactCooldown, setReactCooldown] = useState(false);
  const pokeSeat = (id: string, name: string) => {
    const now = Date.now();
    if (now - (lastPoke.current[id] ?? 0) < 3000) {
      toast(`You just poked ${name} — give them a sec.`);
      return;
    }
    lastPoke.current[id] = now;
    poke(id);
  };
  const lastThrow = useRef(0);
  const tomatoSeat = (id: string) => {
    const now = Date.now();
    if (now - lastThrow.current < 1500) return;
    lastThrow.current = now;
    throwTomato(id);
  };
  // Splats stuck on seats (seat id -> splat id), and the big one when I'm the target.
  const [splats, setSplats] = useState<Record<string, number>>({});
  const [hitMe, setHitMe] = useState<{ fromName: string; n: number } | null>(null);
  const onTomatoLand = (t: Throw) => {
    landThrow(t.n);
    if (!document.querySelector(`[data-seat="${CSS.escape(t.to)}"]`)) return;
    setSplats((x) => ({ ...x, [t.to]: t.n }));
    setTimeout(() => setSplats((x) => (x[t.to] === t.n ? (({ [t.to]: _gone, ...rest }) => rest)(x) : x)), 4600);
    if (t.to === selfId) setHitMe({ fromName: t.fromName, n: t.n });
  };
  const sendReaction = (key: ReactionKey) => {
    if (reactCooldown) return;
    react(key);
    setReactCooldown(true);
    setTimeout(() => setReactCooldown(false), 1200);
  };

  const points = useMemo(() => (room.config ? tryParsePoints(room.config.points).points : []), [room.config]);
  const scale = useMemo(() => numericScale(points), [points]);
  const extras = useMemo(() => points.filter((p) => !isNumeric(p)), [points]);

  const seats = useMemo<Seat[]>(
    () =>
      [{ ...me, id: selfId, self: true }, ...Object.entries(peers).map(([id, m]) => ({ ...m, id, self: false }))].sort(
        (a, b) => a.joinedAt - b.joinedAt,
      ),
    [me, peers, selfId],
  );
  const voteOf = (s: Seat) => (s.round === room.round ? s.vote : null);
  const voted = seats.filter((s) => voteOf(s) !== null);
  const revealed: RevealedVote[] = voted.map((s) => ({ id: s.id, name: s.name, vote: voteOf(s)! }));
  const hostPresent = seats.some((s) => s.host);
  const myVote = voteOf({ ...me, id: selfId, self: true });

  useEffect(() => {
    if (revealCount > 0) setShowReveal(true);
  }, [revealCount]);

  useEffect(() => {
    if (joinError) toast.error(joinError);
  }, [joinError]);

  // Keep the tab title useful when the room is in a background tab.
  useEffect(() => {
    const prev = document.title;
    document.title = room.config ? `${room.config.name} · Planning poker` : 'Planning poker';
    return () => void (document.title = prev);
  }, [room.config]);

  const shareUrl = window.location.origin + (room.config ? roomLink(roomId, room.config.name, room.config.points) : `/plan/${roomId}`);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Room link copied');
    } catch {
      toast.error('Couldn’t copy — copy it from the address bar instead.');
    }
  };

  // Bumped on every pick so the impact animation replays even on the same card.
  const [impact, setImpact] = useState(0);
  const pick = (v: string) => {
    if (myVote !== v) setImpact((n) => n + 1);
    setVote(myVote === v ? null : v);
  };
  /** 0–1: how hard a value hits. Higher numbers land harder; "?" and friends sit in the middle. */
  const intensity = (v: string) => {
    const i = scale.indexOf(v);
    return i < 0 ? 0.4 : scale.length > 1 ? i / (scale.length - 1) : 0.5;
  };
  const setPickMode = (m: PickMode) => {
    setMode(m);
    store(MODE_KEY, m);
  };

  // A late arriver sees the room already revealed; votes stay locked until the next round.
  const locked = room.revealed || !room.config;
  const peerCount = Object.keys(peers).length;

  return (
    <main className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <Button variant="ghost" size="icon" asChild aria-label="All rooms">
            <Link to="/plan">
              <ArrowLeftIcon />
            </Link>
          </Button>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SpadeIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold leading-tight">{room.config?.name ?? 'Planning poker'}</h1>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <UsersIcon className="size-3" /> {seats.length} in room · code {roomId}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={copyLink}>
            <LinkIcon /> <span className="hidden sm:inline">Copy link</span>
          </Button>
          <ModeToggle />
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-4 px-4 py-4">
        {peerCount === 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 shrink-0 animate-spin" />
            {room.config
              ? 'Looking for teammates… share the room link so others can join.'
              : 'Connecting to the room… the host’s settings will appear once someone is found.'}
          </div>
        )}

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {room.revealed ? 'Cards are up' : `${voted.length} of ${seats.length} voted`}
              <span className="ml-2 text-xs font-normal text-muted-foreground">Round {room.round + 1}</span>
            </CardTitle>
            {me.host ? (
              <div className="flex flex-wrap gap-2">
                {room.revealed ? (
                  <Button variant="outline" size="sm" onClick={() => updateRoom({ revealed: false })}>
                    <EyeOffIcon /> Hide points
                  </Button>
                ) : (
                  <Button size="sm" disabled={!voted.length || !room.config} onClick={() => updateRoom({ revealed: true })}>
                    <EyeIcon /> Show points
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled={!room.config} onClick={() => updateRoom({ revealed: false, round: room.round + 1 })}>
                  <RotateCcwIcon /> New round
                </Button>
              </div>
            ) : (
              !hostPresent && (
                <Button variant="outline" size="sm" onClick={becomeHost}>
                  <CrownIcon /> Become host
                </Button>
              )
            )}
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap justify-center gap-x-4 gap-y-5 pt-9 pb-2">
              {seats.map((s) => {
                const v = voteOf(s);
                return (
                  <li key={s.id} data-seat={s.id} className="relative flex w-28 flex-col items-center gap-1.5">
                    {reactions[s.id] && <ReactionBubble reaction={reactions[s.id]} />}
                    <SeatActions
                      name={s.name}
                      poked={poked[s.id]}
                      splat={splats[s.id]}
                      onPoke={s.self ? undefined : () => pokeSeat(s.id, s.name)}
                      onTomato={s.self ? undefined : () => tomatoSeat(s.id)}
                    >
                    <div
                      data-seat-card
                      key={v === null ? 'empty' : room.revealed ? 'up' : `down-${s.picks ?? 0}`}
                      className={cn(
                        'relative flex h-24 w-16 items-center justify-center rounded-lg border-2 text-xl font-bold transition-all',
                        v !== null && !room.revealed && 'seat-drop',
                        v === null && 'border-dashed text-muted-foreground',
                        v !== null && !room.revealed && 'poker-card-back border-primary shadow-sm',
                        v !== null && room.revealed && 'border-primary bg-card text-foreground shadow-md',
                      )}
                      aria-label={v === null ? `${s.name} hasn’t voted` : room.revealed ? `${s.name} voted ${v}` : `${s.name} voted`}
                    >
                      {v === null ? '·' : room.revealed ? v : ''}
                      {/* Fixed intensity: the burst must not hint at the hidden value. */}
                      {v !== null && !room.revealed && (s.picks ?? 0) > 0 && <PickBurst intensity={0.5} />}
                    </div>
                    </SeatActions>
                    <div className="flex w-full items-start justify-center gap-1 text-xs leading-snug">
                      {s.host && <CrownIcon className="mt-0.5 size-3 shrink-0 text-amber-500" aria-label="Host" />}
                      <span className={cn('min-w-0 text-center break-words', s.self && 'font-semibold')} title={s.name}>
                        {s.name}
                      </span>
                      {s.self && (
                        <button type="button" onClick={() => setRenaming(true)} className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground" aria-label="Change your name">
                          <PencilIcon className="size-3" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              {REACTIONS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  disabled={reactCooldown}
                  onClick={() => sendReaction(r.key)}
                  className="flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-bold tracking-wide transition-all enabled:hover:-translate-y-0.5 enabled:hover:border-primary enabled:active:scale-95 disabled:opacity-50"
                >
                  <span className="text-sm leading-none">{r.emoji}</span> {r.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">Tap someone’s card to poke them or throw a 🍅.</p>
            {room.revealed && revealed.length > 0 && (
              <RevealSummary votes={revealed} points={points} onReplay={() => setShowReveal(true)} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              Your pick{myVote !== null && <span className="ml-2 text-primary">{myVote}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="How to pick">
              {PICK_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={mode === m.key}
                  onClick={() => setPickMode(m.key)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent',
                    mode === m.key && 'border-primary bg-primary text-primary-foreground hover:bg-primary',
                  )}
                >
                  <span aria-hidden>{m.emoji}</span> {m.label}
                </button>
              ))}
            </div>
            {locked && room.config && (
              <p className="text-sm text-muted-foreground">Points are showing — picks are locked until the host starts a new round.</p>
            )}
            {!room.config && <p className="text-sm text-muted-foreground">Waiting for the room’s point values…</p>}
            {room.config && mode === 'cards' && (
              <div className="flex flex-wrap gap-2 pt-2">
                {points.map((p) => (
                  <button
                    key={myVote === p ? `${p}-${impact}` : p}
                    type="button"
                    disabled={locked}
                    onClick={() => pick(p)}
                    aria-pressed={myVote === p}
                    className={cn(
                      'flex items-center justify-center rounded-lg border-2 bg-card font-bold transition-all enabled:hover:-translate-y-1 enabled:hover:border-primary disabled:opacity-50',
                      points.length > 40 ? 'h-11 min-w-11 px-1.5 text-sm' : 'h-20 min-w-14 px-2 text-lg',
                      myVote === p && 'relative z-[1] -translate-y-1.5 border-primary bg-primary text-primary-foreground shadow-lg',
                      myVote === p && impact > 0 && (intensity(p) > 0.75 ? 'pick-impact-hard' : 'pick-impact'),
                    )}
                  >
                    {p}
                    {myVote === p && impact > 0 && <PickBurst intensity={intensity(p)} />}
                  </button>
                ))}
              </div>
            )}
            {room.config && mode !== 'cards' && (
              <>
                {scale.length ? (
                  (() => {
                    const Game = GAMES[mode];
                    return <Game key={mode} scale={scale} selected={myVote} disabled={locked} round={room.round} onPick={(v) => setVote(v)} />;
                  })()
                ) : (
                  <p className="text-sm text-muted-foreground">This room has no numeric points to aim at — use the cards.</p>
                )}
                {extras.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    Or just:
                    {extras.map((p) => (
                      <Button key={p} size="sm" variant={myVote === p ? 'default' : 'outline'} disabled={locked} onClick={() => pick(p)}>
                        {p}
                      </Button>
                    ))}
                  </div>
                )}
                {myVote !== null && !locked && (
                  <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setVote(null)}>
                    Clear my pick
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <NameDialog
        open={renaming}
        title="Change your name"
        initial={me.name}
        onCancel={() => setRenaming(false)}
        onSubmit={(n) => {
          store(NAME_KEY, n);
          setName(n);
          setRenaming(false);
        }}
      />

      <TomatoLayer throws={throws} onLand={onTomatoLand} />
      {hitMe && <TomatoScreen key={hitMe.n} fromName={hitMe.fromName} n={hitMe.n} onDone={() => setHitMe(null)} />}
      {incomingPoke && <PokeAlert key={incomingPoke.n} fromName={incomingPoke.fromName} onClose={dismissPoke} />}

      {showReveal && room.revealed && revealed.length > 0 && (
        <GachaReveal votes={revealed} points={points} onClose={() => setShowReveal(false)} />
      )}
    </main>
  );
}

function RevealSummary({ votes, points, onReplay }: { votes: RevealedVote[]; points: string[]; onReplay: () => void }) {
  const stats = voteStats(
    votes.map((v) => v.vote),
    points,
  );
  const top = Math.max(...stats.distribution.map((d) => d.count));
  return (
    <div className="mt-4 grid gap-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>
          <span className="text-muted-foreground">Average</span> <strong>{formatNumber(stats.average)}</strong>
        </span>
        <span>
          <span className="text-muted-foreground">Median</span> <strong>{formatNumber(stats.median)}</strong>
        </span>
        <span>
          <span className="text-muted-foreground">Most picked</span> <strong>{stats.mode.join(', ')}</strong>
        </span>
        {stats.consensus && <span className="font-semibold text-amber-600 dark:text-amber-400">Consensus!</span>}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onReplay}>
          <SparklesIcon /> Replay reveal
        </Button>
      </div>
      <div className="grid gap-1.5">
        {stats.distribution.map((d) => (
          <div key={d.value} className="flex items-center gap-2 text-sm">
            <span className="w-10 text-right font-semibold tabular-nums">{d.value}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(d.count / top) * 100}%` }} />
            </div>
            <span className="w-6 text-xs tabular-nums text-muted-foreground">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Wraps a seat card. Other people's seats open a menu (poke / tomato). Every view shows the
 * poke jab when `poked` changes, the splat when `splat` changes, and wobbles the card for both.
 */
function SeatActions({
  name,
  poked,
  splat,
  onPoke,
  onTomato,
  children,
}: {
  name: string;
  poked?: number;
  splat?: number;
  onPoke?: () => void;
  onTomato?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const firstPoke = useRef(poked);
  const hitKey = `${poked ?? ''}:${splat ?? ''}`;
  const firstHit = useRef(hitKey);
  useEffect(() => {
    if (hitKey === firstHit.current) return;
    ref.current?.animate(
      [
        { transform: 'translateX(0) rotate(0)' },
        { transform: 'translateX(6px) rotate(4deg)' },
        { transform: 'translateX(-5px) rotate(-3deg)' },
        { transform: 'translateX(4px) rotate(2deg)' },
        { transform: 'translateX(0) rotate(0)' },
      ],
      { duration: 450, delay: 120, easing: 'ease-out' },
    );
  }, [hitKey]);
  const extras = (
    <>
      {poked !== undefined && poked !== firstPoke.current && (
        <span key={`p${poked}`} className="seat-poke-finger" aria-hidden>
          👉
        </span>
      )}
      {splat !== undefined && (
        <span key={`s${splat}`} className="seat-splat" aria-hidden>
          <SplatBlob seed={splat} className="size-full" />
        </span>
      )}
    </>
  );
  if (!onPoke || !onTomato) {
    return (
      <div ref={ref} className="relative">
        {children}
        {extras}
      </div>
    );
  }
  return (
    <div ref={ref} className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`Poke or throw a tomato at ${name}`} className="group relative block rounded-lg">
            {children}
            <span className="pointer-events-none absolute inset-x-0 -bottom-2 mx-auto w-max rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              👉 / 🍅
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-40">
          <DropdownMenuLabel className="max-w-48 truncate">{name}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onPoke}>
            <span aria-hidden>👉</span> Poke
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onTomato}>
            <span aria-hidden>🍅</span> Throw a tomato
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {extras}
    </div>
  );
}

function ReactionBubble({ reaction }: { reaction: SeatReaction }) {
  const r = REACTIONS.find((x) => x.key === reaction.key);
  if (!r) return null;
  return (
    <span key={reaction.n} className="pointer-events-none absolute inset-x-0 top-0 h-24" aria-live="polite">
      <span className="seat-bubble">
        {r.emoji} {r.label}
      </span>
      {[-22, 4, 26].map((fx, i) => (
        <span key={i} className="seat-float" style={{ '--fx': `${fx}px`, animationDelay: `${i * 120}ms` } as CSSProperties} aria-hidden>
          {r.emoji}
        </span>
      ))}
    </span>
  );
}
