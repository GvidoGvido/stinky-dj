import * as THREE from 'three';

/**
 * Shared cel-shading helpers. We render everything with MeshToonMaterial driven
 * by a banded gradient ramp, then wrap the renderer in an OutlineEffect for the
 * inked, Okami / anime look.
 */

let gradient: THREE.DataTexture | null = null;

/** A 4-step toon ramp shared by every toon material. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const tones = new Uint8Array([95, 165, 215, 255]);
  const tex = new THREE.DataTexture(tones, tones.length, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradient = tex;
  return tex;
}

type ToonOpts = {
  color?: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  flatShading?: boolean;
  map?: THREE.Texture | null;
};

/** Cel-shaded material with the shared ramp. */
export function toon(opts: ToonOpts = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    emissive: opts.emissive ?? 0x000000,
    gradientMap: toonGradient(),
  });
  if (opts.transparent !== undefined) mat.transparent = opts.transparent;
  if (opts.opacity !== undefined) mat.opacity = opts.opacity;
  if (opts.side !== undefined) mat.side = opts.side;
  if (opts.map !== undefined) mat.map = opts.map ?? null;
  return mat;
}

/** Tell the OutlineEffect to skip this material (water, sparkles, glows). */
export function noOutline<T extends THREE.Material>(mat: T): T {
  mat.userData.outlineParameters = { visible: false };
  return mat;
}
