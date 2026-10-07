export const MAX_POINTS = 500;

export const POINT_PRESETS = [
  { label: 'Fibonacci', value: '0,1,2,3,5,8,13,21,?' },
  { label: '1–10', value: '1-10' },
  { label: '1–50', value: '1-50' },
  { label: '1–200', value: '1-200' },
  { label: 'T-shirt', value: 'XS,S,M,L,XL,?' },
];

/**
 * "1,2,3,5", "1-200" or a mix like "0,1-5,8,?" -> ordered, de-duplicated list of point values.
 * Throws with a readable message when the input can't be used.
 */
export function parsePoints(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
    if (out.length > MAX_POINTS) throw new Error(`Too many values — keep it under ${MAX_POINTS}.`);
  };
  for (const raw of input.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const range = /^(-?\d+)\s*(?:-|–|\.\.)\s*(-?\d+)$/.exec(token);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (Math.abs(b - a) >= MAX_POINTS) throw new Error(`The range ${token} is too large — keep it under ${MAX_POINTS} values.`);
      const step = a <= b ? 1 : -1;
      for (let n = a; n !== b + step; n += step) push(String(n));
    } else {
      if (token.length > 12) throw new Error(`“${token.slice(0, 12)}…” is too long for a card.`);
      push(token);
    }
  }
  if (out.length < 2) throw new Error('Enter at least two values, like 1,2,3,5,8 or 1-50.');
  return out;
}

export function tryParsePoints(input: string): { points: string[]; error: string } {
  try {
    return { points: parsePoints(input), error: '' };
  } catch (e) {
    return { points: [], error: (e as Error).message };
  }
}

export const isNumeric = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));

/** Numeric values in ascending order (the bow's target field). */
export function numericScale(points: string[]): string[] {
  return points.filter(isNumeric).sort((a, b) => Number(a) - Number(b));
}

export interface VoteStats {
  count: number;
  numericCount: number;
  average: number | null;
  median: number | null;
  min: string | null;
  max: string | null;
  consensus: boolean;
  /** Most common vote(s). */
  mode: string[];
  distribution: { value: string; count: number }[];
}

export function voteStats(votes: string[], points: string[]): VoteStats {
  const nums = votes.filter(isNumeric).map(Number).sort((a, b) => a - b);
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const order = (v: string) => {
    const i = points.indexOf(v);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const distribution = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => order(a.value) - order(b.value));
  const top = Math.max(0, ...counts.values());
  const median = nums.length
    ? nums.length % 2
      ? nums[(nums.length - 1) / 2]
      : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2
    : null;
  return {
    count: votes.length,
    numericCount: nums.length,
    average: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
    median,
    min: nums.length ? String(nums[0]) : null,
    max: nums.length ? String(nums[nums.length - 1]) : null,
    consensus: votes.length > 0 && counts.size === 1,
    mode: distribution.filter((d) => d.count === top).map((d) => d.value),
    distribution,
  };
}

export type Rarity = 3 | 4 | 5;

/**
 * Genshin-style rarity: 5★ gold when everyone agrees, 4★ purple when votes sit on
 * neighbouring cards, 3★ blue when the team is far apart.
 */
export function roundRarity(votes: string[], points: string[]): Rarity {
  if (!votes.length) return 3;
  if (new Set(votes).size === 1) return 5;
  const idx = votes.map((v) => points.indexOf(v));
  if (idx.some((i) => i < 0)) return 3;
  const spread = Math.max(...idx) - Math.min(...idx);
  return spread <= Math.max(1, Math.round(points.length * 0.05)) ? 4 : 3;
}

/**
 * Per card, measured against the team's centre (the single most common vote, or the median
 * card when there's a tie): gold on it, purple next to it, blue for outliers.
 */
export function cardRarity(vote: string, votes: string[], points: string[]): Rarity {
  const i = points.indexOf(vote);
  if (i < 0) return 3;
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const leaders = [...counts].filter(([, c]) => c === top).map(([v]) => v);
  let centre: number;
  if (leaders.length === 1 && points.includes(leaders[0])) centre = points.indexOf(leaders[0]);
  else {
    const idx = votes.map((v) => points.indexOf(v)).filter((n) => n >= 0).sort((a, b) => a - b);
    centre = idx.length % 2 ? idx[(idx.length - 1) / 2] : (idx[idx.length / 2 - 1] + idx[idx.length / 2]) / 2;
  }
  const d = Math.abs(i - centre);
  if (d === 0) return 5;
  return d <= Math.max(1, Math.round(points.length * 0.05)) ? 4 : 3;
}

export const RARITY_COLOR: Record<Rarity, string> = {
  3: '#6cb6ff',
  4: '#c58bff',
  5: '#ffd36b',
};

export function formatNumber(n: number | null): string {
  if (n === null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
