import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
  TargetIcon,
  UsersIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ModeToggle } from '@/components/mode-toggle';
import { cn } from '@/lib/utils';
import { BowShooter } from './bow-shooter';
import { GachaReveal, type RevealedVote } from './gacha-reveal';
import { PickBurst } from './pick-burst';
import { roomLink } from './index';
import { formatNumber, isNumeric, numericScale, tryParsePoints, voteStats } from './points';
import { usePlanRoom, type Member, type RoomConfig } from './use-plan-room';
import './plan.css';

const NAME_KEY = 'plan.name';
const MODE_KEY = 'plan.pickMode';

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
  const { selfId, me, peers, room, revealCount, joinError, updateRoom, setVote, setName, becomeHost } = usePlanRoom(
    roomId,
    name,
    initialConfig,
  );
  const [renaming, setRenaming] = useState(false);
  const [showReveal, setShowReveal] = useState(false);
  const [mode, setMode] = useState(() => (readStored(MODE_KEY) === 'bow' ? 'bow' : 'cards'));

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
  const setPickMode = (m: string) => {
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
            <ul className="flex flex-wrap justify-center gap-x-4 gap-y-5 py-2">
              {seats.map((s) => {
                const v = voteOf(s);
                return (
                  <li key={s.id} className="flex w-28 flex-col items-center gap-1.5">
                    <div
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
            <Tabs value={mode} onValueChange={setPickMode}>
              <TabsList>
                <TabsTrigger value="cards">
                  <SpadeIcon /> Cards
                </TabsTrigger>
                <TabsTrigger value="bow">
                  <TargetIcon /> Bow
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="grid gap-3">
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
            {room.config && mode === 'bow' && (
              <>
                {scale.length ? (
                  <BowShooter scale={scale} selected={myVote} disabled={locked} round={room.round} onPick={(v) => setVote(v)} />
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
