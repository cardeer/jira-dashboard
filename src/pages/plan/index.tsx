import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { DoorOpenIcon, SpadeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ModeToggle } from '@/components/mode-toggle';
import { cn } from '@/lib/utils';
import { POINT_PRESETS, tryParsePoints } from './points';
import { markHost } from './use-plan-room';

function newRoomId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function roomLink(roomId: string, name: string, points: string) {
  const q = new URLSearchParams({ n: name, p: points });
  return `/plan/${roomId}?${q}`;
}

export function PlanLobbyPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [points, setPoints] = useState(POINT_PRESETS[0].value);
  const [code, setCode] = useState('');
  const parsed = tryParsePoints(points);

  function create(e: FormEvent) {
    e.preventDefault();
    if (parsed.error || !name.trim()) return;
    const id = newRoomId();
    markHost(id);
    navigate(roomLink(id, name.trim(), points.trim()));
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const raw = code.trim();
    if (!raw) return;
    // Accept a full link or just the room code.
    const m = /\/plan\/([^/?#\s]+)(\?[^#\s]*)?/.exec(raw);
    navigate(m ? `/plan/${m[1]}${m[2] ?? ''}` : `/plan/${encodeURIComponent(raw)}`);
  }

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SpadeIcon className="size-4" />
          </span>
          Planning poker
        </div>
        <ModeToggle />
      </div>
      <div className="mx-auto grid max-w-3xl gap-4 px-4 pb-10 md:grid-cols-[1.4fr_1fr]">
        <Card>
          <form onSubmit={create} className="contents">
            <CardHeader>
              <CardTitle>Create a room</CardTitle>
              <CardDescription>Everyone connects to each other directly. No sign-in needed.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="room-name">Room name</Label>
                <Input id="room-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 42 refinement" maxLength={60} required autoFocus />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="room-points">Points</Label>
                <Input id="room-points" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="1,2,3,5,8 or 1-50" aria-invalid={!!parsed.error} />
                <div className="flex flex-wrap gap-1.5">
                  {POINT_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setPoints(p.value)}
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-accent',
                        points === p.value && 'border-primary bg-accent text-accent-foreground',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {parsed.error ? (
                  <p className="text-xs text-destructive">{parsed.error}</p>
                ) : (
                  <p className="truncate text-xs text-muted-foreground">
                    {parsed.points.length} cards: {parsed.points.slice(0, 14).join(' · ')}
                    {parsed.points.length > 14 && ` … ${parsed.points.at(-1)}`}
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={!!parsed.error || !name.trim()}>
                Create room
              </Button>
            </CardFooter>
          </form>
        </Card>
        <Card className="self-start">
          <form onSubmit={join} className="contents">
            <CardHeader>
              <CardTitle>Join a room</CardTitle>
              <CardDescription>Paste the link or code someone shared with you.</CardDescription>
            </CardHeader>
            <CardContent>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Room link or code" aria-label="Room link or code" />
            </CardContent>
            <CardFooter>
              <Button type="submit" variant="outline" className="w-full" disabled={!code.trim()}>
                <DoorOpenIcon /> Join
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </main>
  );
}
