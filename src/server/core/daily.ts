import type { RoundState } from '../../shared/api';

const MS_PER_DAY = 86_400_000;
/** Hackathon requirement: lock/reveal at 00:00 GMT+2. */
const ROUND_OFFSET_MINUTES = 120;

/** Returns the current "round id" (YYYY-MM-DD) in GMT+2. */
export function currentRoundId(now: Date = new Date()): string {
  // Shift local time into UTC space, then use UTC Y/M/D to get GMT+2 date.
  const shifted = new Date(now.getTime() + ROUND_OFFSET_MINUTES * 60_000);
  const y = shifted.getUTCFullYear();
  const m = `${shifted.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${shifted.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function roundIdToEpochMidnightLocal(roundId: string): number {
  const [yRaw, mRaw, dRaw] = roundId.split('-');
  const y = parseInt(yRaw ?? '', 10);
  const m = parseInt(mRaw ?? '', 10);
  const d = parseInt(dRaw ?? '', 10);
  // `roundId` represents a local date in GMT+2. Convert that to a UTC timestamp.
  return Date.UTC(y, m - 1, d) - ROUND_OFFSET_MINUTES * 60_000;
}

export function previousRoundId(roundId: string): string {
  const t = roundIdToEpochMidnightLocal(roundId) - MS_PER_DAY;
  return roundIdForEpoch(t);
}

function roundIdForEpoch(epochMillisUtc: number): string {
  const shifted = new Date(epochMillisUtc + ROUND_OFFSET_MINUTES * 60_000);
  const y = shifted.getUTCFullYear();
  const m = `${shifted.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${shifted.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Deterministic 32-bit seed from a string (FNV-1a). */
export function seedFromString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32 PRNG for deterministic sleeve primitives. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildRoundState(now: Date = new Date()): RoundState {
  const roundId = currentRoundId(now);
  const seed = seedFromString(`hook-of-the-day|${roundId}`);
  return { roundId, seed };
}
