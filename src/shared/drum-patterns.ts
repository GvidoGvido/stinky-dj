import type { DrumPattern } from './api';

export const DRUM_PATTERN_NAMES = ['BLANK', 'ROCK', 'FILL', 'HOUSE', 'HIP-HOP', 'DISCO'] as const;
export type DrumPatternName = (typeof DRUM_PATTERN_NAMES)[number];

const len = 16;

function pat(
  kick: number[],
  snare: number[],
  hat: number[],
  clap: number[],
): DrumPattern {
  const row = (steps: number[]) => Array.from({ length: len }, (_, i) => (steps.includes(i) ? 1 : 0));
  return {
    kick: row(kick),
    snare: row(snare),
    hat: row(hat),
    clap: row(clap),
  };
}

export const DRUM_PATTERNS: Record<DrumPatternName, DrumPattern> = {
  BLANK: pat([], [], [], []),
  ROCK: pat([0, 8], [4, 12], [0, 2, 4, 6, 8, 10, 12, 14], []),
  // Rock beat ending in a snare-roll fill over the last quarter of the bar
  FILL: pat([0, 8], [4, 10, 12, 13, 14, 15], [0, 2, 4, 6, 8], []),
  HOUSE: pat([0, 4, 8, 12], [4, 12], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [8]),
  'HIP-HOP': pat([0, 6, 10], [4, 12], [2, 6, 10, 14], [8]),
  DISCO: pat([0, 8], [4, 12], [0, 2, 4, 6, 8, 10, 12, 14], [4, 12]),
};

export function prevDrumPattern(current: DrumPatternName): DrumPatternName {
  const i = DRUM_PATTERN_NAMES.indexOf(current);
  return DRUM_PATTERN_NAMES[(i - 1 + DRUM_PATTERN_NAMES.length) % DRUM_PATTERN_NAMES.length]!;
}

export function nextDrumPattern(current: DrumPatternName): DrumPatternName {
  const i = DRUM_PATTERN_NAMES.indexOf(current);
  return DRUM_PATTERN_NAMES[(i + 1) % DRUM_PATTERN_NAMES.length]!;
}

export function drumPatternLabel(n: DrumPatternName): string {
  return n;
}
