import * as THREE from 'three';
import { Rng } from './rng';
import type { TrackTheme } from './terrain';

/** Daily-seeded surreal palette for sky + slide ribbon. */
export function trackTheme(seed: number): TrackTheme {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const h1 = rng.range(0, 360);
  const h2 = (h1 + rng.range(40, 120)) % 360;
  const h3 = (h2 + rng.range(30, 90)) % 360;
  return {
    skyTop: `hsl(${Math.round(h1)}, 72%, 68%)`,
    skyBottom: `hsl(${Math.round(h2)}, 88%, 82%)`,
    groundColor: hslToHex(h3, 55, 0.52),
    groundColor2: hslToHex((h3 + 18) % 360, 60, 0.62),
    accent: hslToHex((h1 + 200) % 360, 85, 0.58),
  };
}

function hslToHex(h: number, s: number, l: number): number {
  return new THREE.Color().setHSL(h / 360, s / 100, l).getHex();
}
