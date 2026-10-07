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

  const meRef = useRef(me);
  meRef.current = me;
  const roomRef = useRef(room);
  roomRef.current = room;
  const sendRef = useRef<{ member: (m: Member) => void; room: (r: RoomState) => void } | null>(null);

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
    sendRef.current = {
      member: (m) => void memberAction.send(m),
      room: (s) => void roomAction.send(s),
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

    return () => {
      sendRef.current = null;
      void r.leave();
      setPeers({});
    };
  }, [roomId, applyRoom]);

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

  return { selfId, me, peers, room, revealCount, joinError, updateRoom, setVote, setName, becomeHost };
}
