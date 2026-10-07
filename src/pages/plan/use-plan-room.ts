import { useCallback, useEffect, useRef, useState } from 'react';
import { joinRoom, selfId } from 'trystero';

const APP_ID = 'jira-dashboard-plan-poker';

export type RoomConfig = {
  name: string;
  /** Raw points spec as typed, e.g. "1,2,3,5,8" or "1-200". */
  points: string;
};

/** Shared room state. Every peer gossips it; the highest `v` wins. Only hosts bump `v`. */
export type RoomState = {
  config: RoomConfig | null;
  revealed: boolean;
  round: number;
  v: number;
};

export type Member = {
  name: string;
  vote: string | null;
  /** Round the vote belongs to; votes from older rounds don't count. */
  round: number;
  host: boolean;
  joinedAt: number;
  /** Counts picks so other seats can play the "just picked" animation (without revealing the value). */
  picks: number;
};

export const REACTIONS = [
  { key: 'ready', emoji: '✅', label: 'READY' },
  { key: 'open', emoji: '🙋', label: 'OPEN' },
  { key: 'hurry', emoji: '⏰', label: 'HURRY' },
  { key: 'wait', emoji: '✋', label: 'WAIT' },
  { key: 'hmm', emoji: '🤔', label: 'HMM' },
  { key: 'break', emoji: '☕', label: 'BREAK' },
  { key: 'nice', emoji: '🎉', label: 'NICE' },
] as const;
export type ReactionKey = (typeof REACTIONS)[number]['key'];

/** Transient seat effects. `n` changes on every event so the animation replays. */
export type SeatReaction = { key: ReactionKey; n: number };
export type Poke = { from: string; fromName: string; n: number };

type PokeMsg = { to: string; fromName: string };
type ThrowMsg = { to: string; fromName: string };
/** A tomato in flight from one seat to another. */
export type Throw = { from: string; to: string; fromName: string; n: number };
type ReactMsg = { key: ReactionKey };

let fxCounter = 0;

const hostKey = (roomId: string) => `plan.host.${roomId}`;

export function markHost(roomId: string) {
  try {
    localStorage.setItem(hostKey(roomId), '1');
  } catch {
    /* private mode: host only for this tab */
  }
}

function isStoredHost(roomId: string) {
  try {
    return localStorage.getItem(hostKey(roomId)) === '1';
  } catch {
    return false;
  }
}

export function usePlanRoom(roomId: string, name: string, initialConfig: RoomConfig | null) {
  const [me, setMe] = useState<Member>(() => ({
    name,
    vote: null,
    round: 0,
    host: isStoredHost(roomId),
    joinedAt: Date.now(),
    picks: 0,
  }));
  const [peers, setPeers] = useState<Record<string, Member>>({});
  const [room, setRoom] = useState<RoomState>({ config: initialConfig, revealed: false, round: 0, v: 0 });
  /** Bumps each time this tab sees the cards being revealed live (not when joining an already revealed round). */
  const [revealCount, setRevealCount] = useState(0);
  const [joinError, setJoinError] = useState('');
  /** Latest reaction per seat (peer id or selfId). */
  const [reactions, setReactions] = useState<Record<string, SeatReaction>>({});
  /** Poke counter per seat, so everyone can see who just got poked. */
  const [poked, setPoked] = useState<Record<string, number>>({});
  /** Set when someone pokes me. */
  const [incomingPoke, setIncomingPoke] = useState<Poke | null>(null);
  const [throws, setThrows] = useState<Throw[]>([]);

  const meRef = useRef(me);
  meRef.current = me;
  const roomRef = useRef(room);
  roomRef.current = room;
  const sendRef = useRef<{
    member: (m: Member) => void;
    room: (r: RoomState) => void;
    poke: (p: PokeMsg) => void;
    react: (r: ReactMsg) => void;
    throw: (t: ThrowMsg) => void;
  } | null>(null);

  const showReaction = useCallback((seat: string, key: ReactionKey) => {
    if (!REACTIONS.some((r) => r.key === key)) return;
    setReactions((r) => ({ ...r, [seat]: { key, n: ++fxCounter } }));
  }, []);
  const showPoke = useCallback((from: string, msg: PokeMsg) => {
    setPoked((p) => ({ ...p, [msg.to]: ++fxCounter }));
    if (msg.to === selfId) setIncomingPoke({ from, fromName: String(msg.fromName).slice(0, 30), n: fxCounter });
  }, []);
  const showThrow = useCallback((from: string, msg: ThrowMsg) => {
    if (typeof msg.to !== 'string') return;
    // Cap what's in the air so a spammer can't flood the screen.
    setThrows((t) => [...t.slice(-7), { from, to: msg.to, fromName: String(msg.fromName).slice(0, 30), n: ++fxCounter }]);
  }, []);

  const applyRoom = useCallback((next: RoomState) => {
    const cur = roomRef.current;
    if (next.v < cur.v || (next.v === cur.v && (cur.config || !next.config))) return false;
    if (next.revealed && !cur.revealed && next.round === cur.round && next.v === cur.v + 1) setRevealCount((c) => c + 1);
    roomRef.current = next;
    setRoom(next);
    return true;
  }, []);

  useEffect(() => {
    const r = joinRoom({ appId: APP_ID }, roomId, {
      onJoinError: (d) => setJoinError(String((d as { error?: unknown }).error ?? 'Could not connect to a peer.')),
    });
    const memberAction = r.makeAction<Member>('member');
    const roomAction = r.makeAction<RoomState>('room');
    // Pokes go to everyone so all seats can show the jab; only the target gets the alert.
    const pokeAction = r.makeAction<PokeMsg>('poke');
    const reactAction = r.makeAction<ReactMsg>('react');
    const throwAction = r.makeAction<ThrowMsg>('throw');
    sendRef.current = {
      member: (m) => void memberAction.send(m),
      room: (s) => void roomAction.send(s),
      poke: (p) => void pokeAction.send(p),
      react: (x) => void reactAction.send(x),
      throw: (t) => void throwAction.send(t),
    };

    r.onPeerJoin = (id) => {
      void memberAction.send(meRef.current, { target: id });
      if (roomRef.current.config) void roomAction.send(roomRef.current, { target: id });
    };
    r.onPeerLeave = (id) =>
      setPeers((p) => {
        const { [id]: _gone, ...rest } = p;
        return rest;
      });
    memberAction.onMessage = (m, { peerId }) => setPeers((p) => ({ ...p, [peerId]: m }));
    roomAction.onMessage = (s) => void applyRoom(s);
    pokeAction.onMessage = (m, { peerId }) => showPoke(peerId, m);
    reactAction.onMessage = (m, { peerId }) => showReaction(peerId, m.key);
    throwAction.onMessage = (m, { peerId }) => showThrow(peerId, m);

    return () => {
      sendRef.current = null;
      void r.leave();
      setPeers({});
    };
  }, [roomId, applyRoom, showPoke, showReaction, showThrow]);

  // Tell everyone whenever my seat changes.
  useEffect(() => {
    sendRef.current?.member(me);
  }, [me]);

  // A new round clears my pick.
  useEffect(() => {
    if (room.round > me.round) setMe((m) => ({ ...m, vote: null, round: room.round }));
  }, [room.round, me.round]);

  const updateRoom = useCallback(
    (patch: Partial<Omit<RoomState, 'v'>>) => {
      const next = { ...roomRef.current, ...patch, v: roomRef.current.v + 1 };
      applyRoom(next);
      sendRef.current?.room(next);
    },
    [applyRoom],
  );

  const setVote = useCallback(
    (vote: string | null) =>
      setMe((m) => ({ ...m, vote, round: roomRef.current.round, picks: vote === null ? m.picks : m.picks + 1 })),
    [],
  );
  const setName = useCallback((n: string) => setMe((m) => ({ ...m, name: n })), []);
  const becomeHost = useCallback(() => {
    markHost(roomId);
    setMe((m) => ({ ...m, host: true }));
  }, [roomId]);

  const poke = useCallback(
    (to: string) => {
      const msg = { to, fromName: meRef.current.name };
      showPoke(selfId, msg);
      sendRef.current?.poke(msg);
    },
    [showPoke],
  );
  const react = useCallback(
    (key: ReactionKey) => {
      showReaction(selfId, key);
      sendRef.current?.react({ key });
    },
    [showReaction],
  );
  const dismissPoke = useCallback(() => setIncomingPoke(null), []);
  const throwTomato = useCallback(
    (to: string) => {
      const msg = { to, fromName: meRef.current.name };
      showThrow(selfId, msg);
      sendRef.current?.throw(msg);
    },
    [showThrow],
  );
  const landThrow = useCallback((n: number) => setThrows((t) => t.filter((x) => x.n !== n)), []);

  return {
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
  };
}
