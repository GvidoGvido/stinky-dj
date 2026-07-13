import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import type { DrumSound } from '../shared/api';

export type NoteSource = 'canvas' | 'keyboard' | 'touch-keys';

export type StudioCallbacks = {
  onNoteDown: (midi: number, source: NoteSource, id: number, layer: 'melody' | 'bass') => void;
  onNoteUp: (midi: number, source: NoteSource, id: number, layer: 'melody' | 'bass') => void;
  onStepToggle: (sound: DrumSound, step: number) => void;
  onRecPress: () => void;
  /** Console / drum-machine control: action id + up/down arrow. */
  onCtrl: (action: string, dir: 'up' | 'down') => void;
  getRecordingProgress: () => number;
  isRecording: () => boolean;
  getPattern: () => Record<DrumSound, number[]>;
  getStepHighlight: () => number;
  getPresetLabel: () => string;
  getBassLabel: () => string;
  getBpmLabel: () => string;
  getDrumsLabel: () => string;
  getDrumKitLabel: () => string;
  getDrumPatternLabel: () => string;
  getEchoLabel: () => string;
  getReverbLabel: () => string;
  getAttackLabel: () => string;
  getMicLabel: () => string;
  getSustainLabel: () => string;
  getLeadVolLabel: () => string;
  getBassVolLabel: () => string;
  getDrumVolLabel: () => string;
};

export const KEYBOARD_MAP: Record<string, number> = {
  KeyA: 60, KeyW: 61, KeyS: 62, KeyE: 63, KeyD: 64, KeyF: 65,
  KeyT: 66, KeyG: 67, KeyY: 68, KeyH: 69, KeyU: 70, KeyJ: 71, KeyK: 72,
  KeyO: 73, KeyL: 74, KeyP: 75, Semicolon: 76, Quote: 77,
  KeyZ: 78, KeyX: 79, KeyC: 80, KeyV: 81, KeyB: 82, KeyN: 84,
};

export const BASS_KEYBOARD_MAP: Record<string, number> = {
  Digit1: 36, Digit2: 37, Digit3: 38, Digit4: 39, Digit5: 40, Digit6: 41,
  Digit7: 42, Digit8: 43, Digit9: 44, Digit0: 45, Minus: 46, Equal: 47, BracketLeft: 48,
};

const ALL_KEYS = { ...KEYBOARD_MAP, ...BASS_KEYBOARD_MAP };

type KeyObj = { mesh: THREE.Mesh; restY: number; layer: 'melody' | 'bass'; midi: number; down: boolean };
type PadObj = { mesh: THREE.Mesh; sound: DrumSound; step: number; on: boolean };
type DisplayObj = { mesh: THREE.Mesh; lastText: string };

const DESK_Y = 0.14;
const COL = { drum: -1.35, synth: 0, tape: 1.35, can: -1.8, tray: 1.8 } as const;
const GEAR_Z = 0.1;
const PROP_Z = 0.62;
const CAM_POS = { x: 0, y: 1.3, z: 3.1 } as const;
const CAM_LOOK = { x: 0, y: 0.62, z: 0 } as const;
const KB_GLIDE_ID = { melody: 1000, bass: 1500 } as const;

function mat(color: number, opts: { emissive?: number; emissiveInt?: number; shininess?: number } = {}): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color,
    emissive: new THREE.Color(opts.emissive ?? color),
    emissiveIntensity: opts.emissiveInt ?? 0.08,
    flatShading: true,
    shininess: opts.shininess ?? 40,
    specular: 0x666688,
  });
}

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function drawDisplayText(c: HTMLCanvasElement, text: string, color: string): void {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#0a1810';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#2a4030';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
  ctx.font = 'bold 64px Trebuchet MS, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const short = text.length > 9 ? `${text.slice(0, 8)}…` : text;
  ctx.fillText(short, c.width / 2, c.height / 2 + 4);
}

function makeDisplay(w: number, h: number, x: number, y: number, z: number): DisplayObj {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  drawDisplayText(c, '---', '#7cff5c');
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.position.set(x, y, z);
  mesh.userData.displayCanvas = c;
  return { mesh, lastText: '---' };
}

function updateDisplay(d: DisplayObj, text: string, color = '#7cff5c'): void {
  if (text === d.lastText) return;
  d.lastText = text;
  const sm = d.mesh.material as THREE.MeshBasicMaterial;
  const c = d.mesh.userData.displayCanvas as HTMLCanvasElement;
  drawDisplayText(c, text, color);
  (sm.map as THREE.CanvasTexture).needsUpdate = true;
}

function arrowBtn(
  parent: THREE.Group,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number,
  arrow: 'up' | 'down',
  action: string,
): THREE.Mesh[] {
  const btn = box(w, h, d, color, x, y, z);
  parent.add(btn);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 96px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 4;
  ctx.fillText(arrow === 'up' ? '▲' : '▼', 64, 68);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.92, h * 0.88),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }),
  );
  plate.position.set(x, y, z + d / 2 + 0.002);
  parent.add(plate);
  const pick = { kind: 'ctrl', action: `${action}-${arrow}` };
  btn.userData.pick = pick;
  plate.userData.pick = pick;
  return [btn, plate];
}

function ctrlLabel(parent: THREE.Group, w: number, x: number, y: number, z: number, text: string): void {
  const c = document.createElement('canvas');
  c.width = 280;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4f4fc';
  ctx.font = 'bold 42px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const short = text.replace(' VOL', '');
  ctx.fillText(short.length > 7 ? `${short.slice(0, 6)}…` : short, 140, 34);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.96, 0.042),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }),
  );
  plate.position.set(x, y, z);
  parent.add(plate);
}

function addConsoleGroupHeader(
  parent: THREE.Group,
  title: string,
  colXs: number[],
  y: number,
  z: number,
): void {
  const left = colXs[0]!;
  const right = colXs[colXs.length - 1]!;
  const centerX = (left + right) / 2;
  const span = right - left + 0.06;

  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 40;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 20px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(title).width + 24;
  const tx = 160;
  const pillY = 20;
  ctx.fillStyle = 'rgba(255, 140, 40, 0.12)';
  ctx.strokeStyle = 'rgba(255, 180, 90, 0.42)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(tx - tw / 2, pillY - 11, tw, 22, 11);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 208, 140, 0.96)';
  ctx.fillText(title, tx, pillY);

  const titlePlate = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(span * 0.52, 0.24), 0.034),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }),
  );
  titlePlate.position.set(centerX, y, z);
  parent.add(titlePlate);
}

function addConsoleGroupBranches(
  parent: THREE.Group,
  colXs: number[],
  yBar: number,
  yEnd: number,
  z: number,
): void {
  const color = 0xc48848;
  const depth = 0.001;
  const thick = 0.0025;
  const left = colXs[0]!;
  const right = colXs[colXs.length - 1]!;
  parent.add(box(right - left, thick, depth, color, (left + right) / 2, yBar, z));
  const dropH = Math.max(0.008, yBar - yEnd);
  for (const x of colXs) {
    parent.add(box(thick, dropH, depth, color, x, (yBar + yEnd) / 2, z));
  }
}

function makeZzzSprite(scale = 1): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f0f6ff';
  ctx.font = 'italic bold 84px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(30,50,100,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText(scale > 1.05 ? 'zz' : 'z', 64, 74);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
    }),
  );
  const s = 0.11 * scale;
  sprite.scale.set(s, s, 1);
  sprite.renderOrder = 30;
  return sprite;
}

function drawFirTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  height: number,
  color: string,
  variant = 0,
): void {
  const layers = variant === 1 ? 3 : variant === 2 ? 5 : 4;
  const widthMul = variant === 1 ? 1.18 : variant === 2 ? 0.78 : 1;
  const layerStep = variant === 1 ? 0.21 : variant === 2 ? 0.13 : 0.17;
  const trunkW = Math.max(2, height * (variant === 2 ? 0.07 : 0.09));
  const trunkH = height * (variant === 1 ? 0.14 : 0.16);
  ctx.fillStyle = color;
  ctx.fillRect(x - trunkW / 2, baseY - trunkH, trunkW, trunkH + 2);
  for (let i = 0; i < layers; i++) {
    const layerBase = baseY - trunkH - i * (height * layerStep);
    const layerH = height * (0.36 - i * (variant === 2 ? 0.04 : 0.05));
    const layerW = height * (0.5 - i * 0.07) * widthMul;
    ctx.beginPath();
    ctx.moveTo(x, layerBase - layerH);
    ctx.lineTo(x - layerW / 2, layerBase);
    ctx.lineTo(x + layerW / 2, layerBase);
    ctx.closePath();
    ctx.fill();
  }
}

/** Stable 0–1 pseudo-random from an integer seed (same result every load). */
function texRand(seed: number): number {
  const t = Math.sin(seed * 127.1 + seed * 311.7) * 43758.5453;
  return t - Math.floor(t);
}

function firTrunkH(height: number, variant: number): number {
  return height * (variant === 1 ? 0.14 : 0.16);
}

function plantForest(
  ctx: CanvasRenderingContext2D,
  startX: number,
  endX: number,
  ridgeY: (x: number) => number,
  baseHeight: number,
  color: string,
  seed: number,
  avgSpacing: number,
  /** Extra pixels to sink the trunk below the ridge (hidden by hill fill). */
  embed = 0,
): void {
  let x = startX;
  let i = 0;
  while (x < endX) {
    const r0 = texRand(seed + i * 5);
    const r1 = texRand(seed + i * 5 + 1);
    const r2 = texRand(seed + i * 5 + 2);
    const r3 = texRand(seed + i * 5 + 3);
    const scale = 0.58 + r0 * 0.62;
    const variant = Math.floor(r1 * 3);
    const height = baseHeight * scale;
    const xJitter = (r2 - 0.5) * 14;
    const px = x + xJitter;
    const ridge = ridgeY(px);
    const sink = embed + r3 * 3;
    const treeBase = ridge + firTrunkH(height, variant) + sink;
    drawFirTree(ctx, px, treeBase, height, color, variant);
    x += avgSpacing * (0.45 + texRand(seed + i * 5 + 4) * 1.1);
    i++;
  }
}

function drawHorizonMist(ctx: CanvasRenderingContext2D, top: number, bottom: number, rgba: string): void {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.45, rgba);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, top, 512, bottom - top);
}

function makeSunsetTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 360;
  const ctx = c.getContext('2d')!;

  const g = ctx.createLinearGradient(0, 0, 0, 360);
  g.addColorStop(0, '#1a2048');
  g.addColorStop(0.28, '#4a2868');
  g.addColorStop(0.45, '#8a4878');
  g.addColorStop(0.58, '#c85858');
  g.addColorStop(0.72, '#e87848');
  g.addColorStop(0.85, '#f0a050');
  g.addColorStop(1, '#ffd080');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 360);

  // Soft horizon warmth — wide vertical band, no hard circle
  const horizonGlow = ctx.createLinearGradient(0, 195, 0, 295);
  horizonGlow.addColorStop(0, 'rgba(255,210,150,0)');
  horizonGlow.addColorStop(0.5, 'rgba(255,190,110,0.28)');
  horizonGlow.addColorStop(0.72, 'rgba(255,175,85,0.38)');
  horizonGlow.addColorStop(1, 'rgba(255,155,70,0.12)');
  ctx.fillStyle = horizonGlow;
  ctx.fillRect(0, 190, 512, 105);

  // Sun disc — narrow horizontal bloom, not a radial blob
  const sunBloom = ctx.createLinearGradient(170, 0, 342, 0);
  sunBloom.addColorStop(0, 'rgba(255,235,190,0)');
  sunBloom.addColorStop(0.38, 'rgba(255,225,170,0.12)');
  sunBloom.addColorStop(0.5, 'rgba(255,245,215,0.42)');
  sunBloom.addColorStop(0.62, 'rgba(255,225,170,0.12)');
  sunBloom.addColorStop(1, 'rgba(255,235,190,0)');
  ctx.fillStyle = sunBloom;
  ctx.fillRect(0, 238, 512, 38);

  const sunCore = ctx.createLinearGradient(0, 246, 0, 260);
  sunCore.addColorStop(0, 'rgba(255,250,230,0)');
  sunCore.addColorStop(0.5, 'rgba(255,252,240,0.55)');
  sunCore.addColorStop(1, 'rgba(255,250,230,0)');
  ctx.fillStyle = sunCore;
  ctx.fillRect(228, 244, 56, 16);

  // Upper-sky haze — thin horizontal wisps, not circles
  for (let i = 0; i < 4; i++) {
    const y = 28 + i * 24 + texRand(i * 31) * 12;
    const wisp = ctx.createLinearGradient(0, y - 10, 0, y + 10);
    wisp.addColorStop(0, 'rgba(100,80,130,0)');
    wisp.addColorStop(0.5, `rgba(120,95,150,${0.03 + texRand(i * 7) * 0.03})`);
    wisp.addColorStop(1, 'rgba(100,80,130,0)');
    ctx.fillStyle = wisp;
    ctx.fillRect(0, y - 12, 512, 24);
  }

  const bgHillY = (x: number) => 232 + Math.sin(x * 0.006 + 0.4) * 18 + Math.sin(x * 0.013) * 8;
  const farHillY = (x: number) => 252 + Math.sin(x * 0.009 + 1.2) * 12 + Math.sin(x * 0.022) * 6;
  const midHillY = (x: number) => 264 + Math.sin(x * 0.01 + 0.6) * 14 + Math.sin(x * 0.024) * 7;
  const hillY = (x: number) => 272 + Math.sin(x * 0.011) * 16 + Math.sin(x * 0.028) * 9;

  // Distant ridge — faded lavender
  plantForest(ctx, 0, 512, bgHillY, 20, '#5a4868', 501, 18, 1);
  ctx.fillStyle = '#4a3a58';
  ctx.beginPath();
  ctx.moveTo(0, 360);
  for (let x = 0; x <= 512; x += 8) ctx.lineTo(x, bgHillY(x));
  ctx.lineTo(512, 360);
  ctx.closePath();
  ctx.fill();
  drawHorizonMist(ctx, 200, 278, 'rgba(180,140,200,0.2)');

  // Far ridge — muted purple-grey
  plantForest(ctx, 4, 508, farHillY, 24, '#3a2848', 101, 15, 2);
  ctx.fillStyle = '#322848';
  ctx.beginPath();
  ctx.moveTo(0, 360);
  for (let x = 0; x <= 512; x += 8) ctx.lineTo(x, farHillY(x));
  ctx.lineTo(512, 360);
  ctx.closePath();
  ctx.fill();
  drawHorizonMist(ctx, 228, 305, 'rgba(255,170,130,0.16)');

  // Mid ridge
  plantForest(ctx, 2, 510, midHillY, 34, '#221430', 203, 17, 5);
  ctx.fillStyle = '#1c1224';
  ctx.beginPath();
  ctx.moveTo(0, 360);
  for (let x = 0; x <= 512; x += 6) ctx.lineTo(x, midHillY(x));
  ctx.lineTo(512, 360);
  ctx.closePath();
  ctx.fill();

  // Main forested hill
  plantForest(ctx, 2, 510, hillY, 40, '#1a1028', 207, 16, 6);
  ctx.fillStyle = '#1a1028';
  ctx.beginPath();
  ctx.moveTo(0, 360);
  for (let x = 0; x <= 512; x += 6) ctx.lineTo(x, hillY(x));
  ctx.lineTo(512, 360);
  ctx.closePath();
  ctx.fill();

  plantForest(ctx, 0, 512, hillY, 48, '#1a1028', 307, 11, 1);
  plantForest(ctx, 6, 506, hillY, 32, '#1a1028', 411, 10, 1);

  for (let i = 0; i < 4; i++) {
    const lx = 8 + i * 14 + texRand(i * 9) * 8;
    drawFirTree(ctx, lx, hillY(lx) + 12, 62 + texRand(i * 13) * 18, '#0a0610', Math.floor(texRand(i * 7) * 3));
    const rx = 504 - i * 14 - texRand(i * 19) * 8;
    drawFirTree(ctx, rx, hillY(rx) + 10, 58 + texRand(i * 15) * 16, '#0a0610', Math.floor(texRand(i * 5) * 3));
  }

  drawHorizonMist(ctx, 255, 340, 'rgba(255,140,90,0.12)');

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRedditPoster(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 340;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a1a22';
  ctx.fillRect(0, 0, 256, 340);
  ctx.strokeStyle = '#ff4500';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 240, 324);
  ctx.fillStyle = '#ff4500';
  ctx.beginPath();
  ctx.arc(128, 130, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(108, 118, 8, 0, Math.PI * 2);
  ctx.arc(148, 118, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(128, 145, 28, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff4500';
  ctx.font = 'bold 28px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('r/HookOfTheDay', 128, 230);
  ctx.font = '16px Trebuchet MS, sans-serif';
  ctx.fillStyle = '#ccc';
  ctx.fillText('drop your hook', 128, 265);
  return c;
}

function makeQuirkyPoster(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 340;
  const ctx = c.getContext('2d')!;
  // Peeling wallpaper yellow
  ctx.fillStyle = '#f4e04d';
  ctx.fillRect(0, 0, 256, 340);
  ctx.fillStyle = '#ff6eb4';
  ctx.fillRect(12, 12, 232, 316);
  ctx.fillStyle = '#1a1028';
  ctx.font = 'bold 22px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('OFFICIAL NOTICE', 128, 48);
  ctx.font = 'bold 34px Trebuchet MS, sans-serif';
  ctx.fillStyle = '#7cff5c';
  ctx.fillText('NO', 128, 95);
  ctx.fillStyle = '#fff';
  ctx.fillText('BAD VIBES', 128, 132);
  ctx.fillStyle = '#1a1028';
  ctx.font = '18px Trebuchet MS, sans-serif';
  ctx.fillText('in this studio', 128, 162);
  // Goofy goldfish (the yellow thing)
  ctx.fillStyle = '#ffd028';
  ctx.beginPath();
  ctx.ellipse(128, 218, 50, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(82, 218);
  ctx.lineTo(48, 198);
  ctx.lineTo(48, 238);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(108, 196);
  ctx.lineTo(128, 176);
  ctx.lineTo(148, 196);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(128, 238);
  ctx.lineTo(118, 252);
  ctx.lineTo(138, 252);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(220,120,0,0.45)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(108 + i * 14, 220, 9, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
  ctx.fillStyle = '#1a1028';
  ctx.beginPath();
  ctx.arc(162, 212, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(164, 210, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff9020';
  ctx.beginPath();
  ctx.moveTo(172, 218);
  ctx.lineTo(182, 216);
  ctx.lineTo(172, 222);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#444';
  ctx.fillRect(98, 188, 60, 11);
  ctx.fillRect(92, 191, 9, 20);
  ctx.fillRect(155, 191, 9, 20);
  ctx.fillStyle = '#ff6eb4';
  ctx.font = 'bold 14px Trebuchet MS, sans-serif';
  ctx.fillText('★ CERTIFIED QUIRKY ★', 128, 285);
  ctx.font = '12px Trebuchet MS, sans-serif';
  ctx.fillStyle = '#1a1028';
  ctx.fillText('violators get jazz solos', 128, 310);
  return c;
}

function makeGoldTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, '#fff0a8');
  g.addColorStop(0.35, '#e8b828');
  g.addColorStop(0.7, '#c08818');
  g.addColorStop(1, '#906010');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(255,240,180,${Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
  }
  ctx.strokeStyle = 'rgba(120,80,10,0.22)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * 128, Math.random() * 128);
    ctx.lineTo(Math.random() * 128, Math.random() * 128);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,230,140,0.35)';
  for (let r = 20; r < 70; r += 14) {
    ctx.beginPath();
    ctx.arc(64, 64, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMarbleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a3848';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = `rgba(200,200,220,${0.06 + Math.random() * 0.12})`;
    ctx.lineWidth = 2 + Math.random() * 4;
    ctx.beginPath();
    ctx.moveTo(Math.random() * 128, Math.random() * 128);
    ctx.bezierCurveTo(Math.random() * 128, Math.random() * 128, Math.random() * 128, Math.random() * 128, Math.random() * 128, Math.random() * 128);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWoodPlankTexture(
  orientation: 'vertical' | 'horizontal',
  dark = false,
): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const palette = dark
    ? ['#3a2818', '#422c1c', '#362414', '#4a3220', '#322010']
    : ['#8a6848', '#7a5838', '#725236', '#6b4c32', '#846040'];
  const plankPx = orientation === 'vertical' ? 52 : 44;
  const along = orientation === 'vertical' ? w : h;
  const cross = orientation === 'vertical' ? h : w;

  for (let p = 0; p < along; p += plankPx) {
    const idx = Math.floor(p / plankPx) % palette.length;
    ctx.fillStyle = palette[idx]!;
    if (orientation === 'vertical') {
      ctx.fillRect(p + 1.5, 0, plankPx - 2, cross);
    } else {
      ctx.fillRect(0, p + 1.5, cross, plankPx - 2);
    }

    for (let g = 0; g < 10; g++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.035 + (g % 3) * 0.018})`;
      ctx.lineWidth = 1;
      if (orientation === 'vertical') {
        const gx = p + 8 + g * 4 + (idx * 3) % 6;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx + (g % 2 ? 1.5 : -0.8), cross);
        ctx.stroke();
      } else {
        const gy = p + 8 + g * 4 + (idx * 3) % 6;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(cross, gy + (g % 2 ? 1.5 : -0.8));
        ctx.stroke();
      }
    }

    if (idx % 4 === 2) {
      ctx.fillStyle = dark ? 'rgba(20,12,8,0.4)' : 'rgba(40,25,15,0.28)';
      ctx.beginPath();
      if (orientation === 'vertical') {
        ctx.ellipse(p + plankPx * 0.5, cross * 0.28 + (idx * 55) % 120, 7, 5, 0.25, 0, Math.PI * 2);
      } else {
        ctx.ellipse(cross * 0.35 + (idx * 60) % 140, p + plankPx * 0.45, 7, 5, 0.25, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    ctx.fillStyle = dark ? '#1a1008' : '#3a2818';
    if (orientation === 'vertical') {
      ctx.fillRect(p, 0, 1.5, cross);
    } else {
      ctx.fillRect(0, p, cross, 1.5);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function woodMat(map: THREE.CanvasTexture, tint = 0xffffff, emissiveInt = 0.07): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    map,
    color: tint,
    emissive: new THREE.Color(0x3a2818),
    emissiveIntensity: emissiveInt,
    flatShading: true,
    shininess: 18,
    specular: 0x554433,
  });
}

function woodMesh(w: number, h: number, d: number, map: THREE.CanvasTexture, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), woodMat(map));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function trophyGoldMat(map: THREE.CanvasTexture, emissiveInt = 0.7): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    map,
    color: 0xffffff,
    emissive: new THREE.Color(0xffaa22),
    emissiveIntensity: emissiveInt,
    flatShading: true,
    shininess: 130,
    specular: 0xffeecc,
  });
}

function makeConcertPoster(title: string, sub: string, hue: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 340;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `hsl(${hue}, 40%, 18%)`;
  ctx.fillRect(0, 0, 256, 340);
  ctx.fillStyle = `hsl(${hue}, 55%, 48%)`;
  ctx.fillRect(14, 14, 228, 200);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 30px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 128, 100);
  ctx.font = '20px Trebuchet MS, sans-serif';
  ctx.fillStyle = '#eee';
  ctx.fillText(sub, 128, 140);
  ctx.fillStyle = '#222';
  ctx.fillRect(14, 230, 228, 96);
  ctx.fillStyle = '#7cff5c';
  ctx.font = 'bold 24px Trebuchet MS, sans-serif';
  ctx.fillText('TONIGHT', 128, 285);
  return c;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export class Studio3D {
  private container: HTMLElement;
  private cb: StudioCallbacks | null = null;
  private renderer: THREE.WebGLRenderer;
  private outline: OutlineEffect;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private clock = new THREE.Clock();
  private raf = 0;
  private keys: KeyObj[] = [];
  private pads: PadObj[] = [];
  private interactive: THREE.Mesh[] = [];
  private recBtn!: THREE.Mesh;
  private recLed!: THREE.Mesh;
  private reelL!: THREE.Group;
  private reelR!: THREE.Group;
  private vuLeds: THREE.Mesh[] = [];
  private smoke: THREE.Mesh[] = [];
  private micZzz: THREE.Sprite[] = [];
  private micWasOff = false;
  // private micBadge!: THREE.Mesh;
  private ember!: THREE.Mesh;
  private synthDisplays: DisplayObj[] = [];
  private drumDisplays: DisplayObj[] = [];
  private lastSynthTexts: string[] = Array.from({ length: 12 }, () => '');
  private lastDrumTexts = ['', ''];
  private smokeOrigin = new THREE.Vector3();
  private anchors = new Map<string, THREE.Vector3>();
  private keysDown = new Set<string>();
  private kbGlide: Record<'melody' | 'bass', { code: string; midi: number } | null> = { melody: null, bass: null };
  private touchIds = new Map<number, KeyObj | PadObj | 'rec'>();
  private keyboardTouchIds = new Map<string, number>();
  private nextKeyboardTouchId = 2000;
  private camBase: { x: number; y: number; z: number; lookY: number; fov: number } = {
    x: CAM_POS.x,
    y: CAM_POS.y,
    z: CAM_POS.z,
    lookY: CAM_LOOK.y,
    fov: 48,
  };
  private composeCover = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    container.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 40);
    this.camera.position.set(CAM_POS.x, CAM_POS.y, CAM_POS.z);
    this.camera.lookAt(CAM_LOOK.x, CAM_LOOK.y, CAM_LOOK.z);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.setClearColor(0x2a2438);

    this.outline = new OutlineEffect(this.renderer, {
      defaultThickness: 0.01,
      defaultColor: [0.04, 0.03, 0.06],
      defaultAlpha: 0.55,
      defaultKeepAlive: true,
    });

    this.buildRoom();
    this.buildDesk();
    this.buildDrumMachine();
    this.buildSynth();
    this.buildTapeDeck();
    this.buildMic();
    this.buildProps();
    this.setupInput(canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setCallbacks(cb: StudioCallbacks): void {
    this.cb = cb;
  }

  projectAnchor(id: string): { x: number; y: number } | null {
    const a = this.anchors.get(id);
    if (!a) return null;
    const v = a.clone().project(this.camera);
    if (v.z > 1) return null;
    const rect = this.container.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
    };
  }

  start(): void {
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.update(this.clock.getElapsedTime());
      this.outline.render(this.scene, this.camera);
    };
    tick();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }

  private setAnchor(id: string, x: number, y: number, z: number): void {
    this.anchors.set(id, new THREE.Vector3(x, y, z));
  }

  setComposeCoverage(fraction: number): void {
    this.composeCover = clamp01(fraction);
    this.applyCamera();
  }

  private applyCamera(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const aspect = w / Math.max(h, 1);
    const portrait = aspect < 0.82;
    const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
    const cover = this.composeCover;
    const mobileChrome = portrait && coarse ? Math.max(cover, 0.16) : cover;

    let fov = portrait ? 54 : 48;
    let z = portrait ? 3.5 : CAM_POS.z;
    let y = portrait ? 1.36 : CAM_POS.y;
    let lookY = portrait ? 0.56 : CAM_LOOK.y;

    if (mobileChrome > 0.08) {
      fov += mobileChrome * 8;
      z += mobileChrome * 1.15;
      y += mobileChrome * 0.14;
      lookY += mobileChrome * 0.05;
    } else if (cover > 0.1) {
      fov += cover * 8;
      z += cover * 1.1;
      y += cover * 0.12;
      lookY -= cover * 0.06;
    }

    this.camera.fov = fov;
    this.camera.position.set(CAM_POS.x, y, z);
    this.camera.lookAt(CAM_LOOK.x, lookY, CAM_LOOK.z);
    this.camera.updateProjectionMatrix();
    this.camBase = { x: CAM_POS.x, y, z, lookY, fov };
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.applyCamera();
    this.renderer.setSize(w, h, false);
  }

  private buildRoom(): void {
    this.scene.fog = new THREE.Fog(0x4a3828, 10, 22);
    this.scene.background = new THREE.Color(0x382820);
    this.scene.add(new THREE.AmbientLight(0xd8c8b0, 0.44));

    const sunset = new THREE.DirectionalLight(0xff9955, 2.0);
    sunset.position.set(-3, 2.8, -1.5);
    this.scene.add(sunset);

    const sunsetFill = new THREE.PointLight(0xff7733, 2.8, 16, 1.5);
    sunsetFill.position.set(-0.8, 1.4, 0.3);
    this.scene.add(sunsetFill);

    const fill = new THREE.DirectionalLight(0xffeedd, 0.3);
    fill.position.set(2, 3, 4);
    this.scene.add(fill);

    const floorTex = makeWoodPlankTexture('horizontal');
    floorTex.repeat.set(3, 3);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), woodMat(floorTex, 0xccb090, 0.05));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallTex = makeWoodPlankTexture('vertical');
    wallTex.repeat.set(2.2, 1.1);
    const wall = woodMesh(9, 3.2, 0.12, wallTex, 0, 1.55, -2.25);
    this.scene.add(wall);

    const trimTex = makeWoodPlankTexture('horizontal', true);
    trimTex.repeat.set(2.5, 1);
    this.scene.add(woodMesh(9.05, 0.1, 0.14, trimTex, 0, 3.14, -2.22));
    this.scene.add(woodMesh(9.05, 0.14, 0.14, trimTex, 0, 0.1, -2.22));

    const winX = -1.2;
    const winY = 1.88;
    const winW = 1.55;
    const winH = 1.0;
    const frameTex = makeWoodPlankTexture('vertical', true);
    frameTex.repeat.set(1.2, 1);
    const frameMat = woodMat(frameTex, 0xaa8868, 0.06);
    const frames: [number, number, number, number, number, number][] = [
      [winW + 0.1, 0.05, 0.04, winX, winY + winH / 2 + 0.025, -2.17],
      [winW + 0.1, 0.05, 0.04, winX, winY - winH / 2 - 0.025, -2.17],
      [0.05, winH + 0.1, 0.04, winX - winW / 2 - 0.025, winY, -2.17],
      [0.05, winH + 0.1, 0.04, winX + winW / 2 + 0.025, winY, -2.17],
    ];
    for (const [w, h, d, x, y, z] of frames) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
      f.position.set(x, y, z);
      f.castShadow = true;
      this.scene.add(f);
    }

    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(winW - 0.02, winH - 0.02),
      new THREE.MeshBasicMaterial({ map: makeSunsetTexture() }),
    );
    pane.position.set(winX, winY, -2.185);
    this.scene.add(pane);

    // Single soft light shaft from the window — fades out in every direction
    // (radial-ish gradient) so it reads as haze, not a solid block.
    const shaftC = document.createElement('canvas');
    shaftC.width = 256;
    shaftC.height = 256;
    const sctx = shaftC.getContext('2d')!;
    // Fade in at the top too, so the plane's upper edge never shows as a line
    const vGrad = sctx.createLinearGradient(0, 0, 0, 256);
    vGrad.addColorStop(0, 'rgba(255,200,140,0)');
    vGrad.addColorStop(0.22, 'rgba(255,200,140,0.26)');
    vGrad.addColorStop(0.6, 'rgba(255,170,100,0.1)');
    vGrad.addColorStop(1, 'rgba(255,150,80,0)');
    sctx.fillStyle = vGrad;
    sctx.fillRect(0, 0, 256, 256);
    // Fade left/right edges to transparent so the plane has no visible borders
    sctx.globalCompositeOperation = 'destination-in';
    const hGrad = sctx.createLinearGradient(0, 0, 256, 0);
    hGrad.addColorStop(0, 'rgba(0,0,0,0)');
    hGrad.addColorStop(0.3, 'rgba(0,0,0,1)');
    hGrad.addColorStop(0.7, 'rgba(0,0,0,1)');
    hGrad.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = hGrad;
    sctx.fillRect(0, 0, 256, 256);
    const shaftTex = new THREE.CanvasTexture(shaftC);
    const shaftMat = new THREE.MeshBasicMaterial({
      map: shaftTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(winW * 1.15, 2.4), shaftMat);
    shaft.position.set(winX + 0.28, winY - 0.9, -1.55);
    shaft.rotation.set(-0.5, 0.1, 0.05);
    this.scene.add(shaft);

    // Warm spotlight actually shining from the window onto the desk
    const winSpot = new THREE.SpotLight(0xffb070, 3.5, 9, 0.7, 0.6, 1.2);
    winSpot.position.set(winX, winY, -2.1);
    winSpot.target.position.set(-0.4, DESK_Y, 0.4);
    this.scene.add(winSpot);
    this.scene.add(winSpot.target);

    const poster = (canvas: HTMLCanvasElement, x: number, y: number, pw: number, ph: number) => {
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: tex }));
      m.position.set(x, y, -2.18);
      this.scene.add(m);
    };
    poster(makeRedditPoster(), 0.05, 1.78, 0.52, 0.7);
    poster(makeConcertPoster('MIDNIGHT', 'JAM SESSION', 280), 0.66, 1.72, 0.46, 0.62);
    poster(makeQuirkyPoster(), 1.9, 2.05, 0.44, 0.58);

    this.buildGoldPlaque(2.55, 1.95, -2.12);
    this.buildShelf(1.55, 1.28, -2.14);
    this.buildWallGuitar(-2.42, 1.35, -2.15, 'electric');
    this.buildWallGuitar(-3.05, 1.4, -2.15, 'bass');
  }

  private buildShelf(x: number, y: number, z: number): void {
    const shelfTex = makeWoodPlankTexture('horizontal');
    shelfTex.repeat.set(2.5, 1);
    const bracketTex = makeWoodPlankTexture('vertical', true);
    bracketTex.repeat.set(1, 1);
    this.scene.add(woodMesh(1.1, 0.045, 0.3, shelfTex, x, y, z + 0.15));
    this.scene.add(woodMesh(0.04, 0.16, 0.24, bracketTex, x - 0.42, y - 0.1, z + 0.13));
    this.scene.add(woodMesh(0.04, 0.16, 0.24, bracketTex, x + 0.42, y - 0.1, z + 0.13));

    const flowerPot = (px: number, hue: number, plantH: number) => {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.11, 12), mat(0xc06838, { emissiveInt: 0.15 }));
      pot.position.set(px, y + 0.078, z + 0.15);
      this.scene.add(pot);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.078, 0.025, 12), mat(0xd47840, { emissiveInt: 0.15 }));
      rim.position.set(px, y + 0.13, z + 0.15);
      this.scene.add(rim);
      // Leaf blades fanning out from the pot
      for (let i = 0; i < 7; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.02, plantH, 5), mat(hue, { emissiveInt: 0.2 }));
        const a = (i / 7) * Math.PI * 2;
        leaf.position.set(px + Math.cos(a) * 0.035, y + 0.13 + plantH / 2, z + 0.15 + Math.sin(a) * 0.035);
        leaf.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
        this.scene.add(leaf);
      }
    };
    flowerPot(x - 0.3, 0x3a8a3a, 0.28);
    this.buildGrammyAward(x + 0.28, y, z);

    // A couple of records leaning on the shelf
    this.scene.add(box(0.02, 0.28, 0.28, 0x222230, x + 0.02, y + 0.16, z + 0.12));
    this.scene.add(box(0.02, 0.28, 0.28, 0x902838, x + 0.055, y + 0.155, z + 0.13));
  }

  /** Small Grammy-style gramophone trophy for the wall shelf. */
  private buildGrammyAward(px: number, y: number, z: number): void {
    const gz = z + 0.15;
    const goldTex = makeGoldTexture();
    const marbleTex = makeMarbleTexture();
    const gold = (emissiveInt = 0.75) => trophyGoldMat(goldTex, emissiveInt);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.105, 0.035, 14),
      new THREE.MeshPhongMaterial({ map: marbleTex, color: 0xccccdd, flatShading: true, shininess: 60 }),
    );
    base.position.set(px, y + 0.06, gz);
    this.scene.add(base);

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.07, 0.025, 12),
      new THREE.MeshPhongMaterial({ map: marbleTex, color: 0x888899, flatShading: true }),
    );
    plinth.position.set(px, y + 0.09, gz);
    this.scene.add(plinth);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.028, 0.1, 10), gold(0.85));
    stem.position.set(px, y + 0.15, gz);
    this.scene.add(stem);

    const cup = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), gold());
    cup.scale.set(1, 0.75, 0.85);
    cup.position.set(px, y + 0.21, gz);
    this.scene.add(cup);

    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.14, 14), gold(0.9));
    horn.rotation.set(0.35, 0.15, -1.15);
    horn.position.set(px + 0.055, y + 0.27, gz + 0.01);
    this.scene.add(horn);

    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.038 - i * 0.01, 0.003, 6, 12), gold(0.8));
      ring.rotation.set(0.35, 0.15, -1.15);
      ring.position.set(px + 0.04 + i * 0.022, y + 0.255 + i * 0.018, gz + 0.01);
      this.scene.add(ring);
    }

    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 8, 14), gold(0.95));
    mouth.rotation.set(0.35, 0.15, -1.15);
    mouth.position.set(px + 0.11, y + 0.31, gz + 0.02);
    this.scene.add(mouth);

    const tagC = document.createElement('canvas');
    tagC.width = 128;
    tagC.height = 48;
    const tx = tagC.getContext('2d')!;
    tx.fillStyle = '#1a1018';
    tx.fillRect(0, 0, 128, 48);
    tx.fillStyle = '#ffcc44';
    tx.font = 'bold 16px Trebuchet MS, sans-serif';
    tx.textAlign = 'center';
    tx.fillText('GRAMMY', 64, 22);
    tx.font = '11px Trebuchet MS, sans-serif';
    tx.fillStyle = '#ccc';
    tx.fillText('BEST HOOK', 64, 38);
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.11, 0.038),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(tagC), transparent: true }),
    );
    tag.position.set(px, y + 0.075, gz + 0.06);
    this.scene.add(tag);
  }

  /**
   * Wall-hung electric or bass guitar. Solid body from an extruded double-cutaway
   * silhouette so the cel-shading outline reads it as one 3D slab.
   */
  private buildWallGuitar(
    x: number,
    y: number,
    z: number,
    kind: 'electric' | 'bass',
  ): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(1.28);

    const bodyColor = kind === 'electric' ? 0xc23a3a : 0x2f6fb8;
    const scale = kind === 'bass' ? 1.06 : 1;

    // Double-cutaway solid body silhouette (strat-ish), drawn in the X/Y plane
    const s = new THREE.Shape();
    s.moveTo(0, -0.46);
    s.bezierCurveTo(0.17, -0.46, 0.21, -0.34, 0.185, -0.22);
    s.bezierCurveTo(0.17, -0.14, 0.1, -0.11, 0.115, -0.045);
    // Right horn
    s.bezierCurveTo(0.125, 0.005, 0.085, 0.03, 0.05, 0.0);
    s.bezierCurveTo(0.03, -0.02, -0.03, -0.02, -0.05, 0.0);
    // Left horn (slightly longer)
    s.bezierCurveTo(-0.085, 0.045, -0.13, 0.02, -0.115, -0.045);
    s.bezierCurveTo(-0.1, -0.11, -0.17, -0.14, -0.185, -0.22);
    s.bezierCurveTo(-0.21, -0.34, -0.17, -0.46, 0, -0.46);
    const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false });
    const body = new THREE.Mesh(bodyGeo, mat(bodyColor, { emissiveInt: 0.14, shininess: 80 }));
    body.scale.setScalar(scale);
    g.add(body);

    const neckLen = kind === 'bass' ? 0.62 : 0.52;
    const strings = kind === 'bass' ? 4 : 6;
    const neckTop = neckLen - 0.02;

    // Neck, fretboard and frets
    g.add(box(0.05, neckLen, 0.022, 0x6a4a28, 0, neckLen / 2 - 0.04, 0.03));
    g.add(box(0.052, neckLen - 0.1, 0.006, 0x33220f, 0, neckLen / 2 - 0.06, 0.044));
    for (let i = 0; i < 6; i++) {
      g.add(box(0.05, 0.006, 0.007, 0xb8b8c0, 0, 0.06 + i * (neckLen - 0.18) / 6, 0.045));
    }

    // Headstock + tuning pegs (all on one side, electric style)
    g.add(box(0.075, 0.15, 0.02, 0x1c1c26, 0.012, neckTop + 0.05, 0.03));
    const pegs = kind === 'bass' ? 4 : 6;
    for (let i = 0; i < pegs; i++) {
      g.add(box(0.026, 0.014, 0.03, 0xd8d8e0, -0.032, neckTop + 0.005 + i * (0.12 / pegs), 0.032));
    }

    // Pickguard, pickups, bridge, knobs
    if (kind === 'electric') {
      const pg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 18), mat(0xf0ead8, { emissiveInt: 0.12 }));
      pg.rotation.x = Math.PI / 2;
      pg.scale.set(1, 1, 1.45);
      pg.position.set(0.015, -0.24, 0.054);
      g.add(pg);
    }
    const pickups = kind === 'bass' ? 2 : 3;
    for (let i = 0; i < pickups; i++) {
      g.add(box(0.11, 0.03, 0.012, 0x1a1a22, 0, -0.13 - i * 0.075, 0.06));
    }
    g.add(box(0.13, 0.035, 0.016, 0x2a2a34, 0, -0.36 * scale, 0.06));
    for (let i = 0; i < 2; i++) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 10), mat(0xd8d8e0));
      knob.rotation.x = Math.PI / 2;
      knob.position.set(0.1, -0.32 - i * 0.055, 0.06);
      g.add(knob);
    }

    // Strings from bridge to headstock
    const spread = kind === 'bass' ? 0.036 : 0.04;
    for (let i = 0; i < strings; i++) {
      const sx = -spread / 2 + (i * spread) / (strings - 1);
      const str = box(kind === 'bass' ? 0.005 : 0.0035, 0.36 * scale + neckTop, 0.003, 0xd8d8c8, sx, (neckTop - 0.36 * scale) / 2, 0.066);
      (str.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.4;
      g.add(str);
    }

    // Wall hook
    g.add(box(0.02, 0.05, 0.04, 0x2a2830, 0, neckTop + 0.11, 0.012));

    this.scene.add(g);
  }

  private buildGoldPlaque(x: number, y: number, z: number): void {
    const frameTex = makeWoodPlankTexture('vertical', true);
    frameTex.repeat.set(1.4, 1.2);
    this.scene.add(woodMesh(0.62, 0.72, 0.04, frameTex, x, y, z));
    const record = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.016, 36),
      mat(0xddb020, { emissive: 0xffaa22, emissiveInt: 0.9, shininess: 110 }),
    );
    record.rotation.x = Math.PI / 2;
    record.position.set(x, y + 0.04, z + 0.022);
    this.scene.add(record);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.018, 20), mat(0x1a1018));
    label.rotation.x = Math.PI / 2;
    label.position.set(x, y + 0.04, z + 0.03);
    this.scene.add(label);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffcc44';
    ctx.font = 'bold 22px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GOLD RECORD', 128, 28);
    ctx.font = '14px Trebuchet MS, sans-serif';
    ctx.fillStyle = '#ccc';
    ctx.fillText('1M SOLD', 128, 50);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.09),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }),
    );
    plate.position.set(x, y - 0.22, z + 0.024);
    this.scene.add(plate);
  }

  private buildDesk(): void {
    this.scene.add(box(5.2, 0.14, 1.2, 0x8a6848, 0, 0.07, 0.15));
    this.scene.add(box(5.22, 0.04, 1.22, 0x6a5038, 0, 0.01, 0.15));
  }

  private addKey(g: THREE.Group, midi: number, x: number, z: number, w: number, h: number, d: number, color: number, layer: 'melody' | 'bass'): void {
    const mesh = box(w, h, d, color, x, DESK_Y + h / 2 + 0.01, z);
    g.add(mesh);
    this.interactive.push(mesh);
    mesh.userData.pick = { kind: layer === 'melody' ? 'melody-key' : 'bass-key', midi, layer };
    this.keys.push({ mesh, restY: mesh.position.y, layer, midi, down: false });
  }

  private buildSynth(): void {
    const g = new THREE.Group();
    g.position.set(COL.synth, 0, GEAR_Z);

    // Two full octaves, C4..C6
    const ww = 0.082;
    const whites = 15;
    const span = ww * whites;
    const sx = -span / 2 + ww / 2;

    // Slanted console panel behind the keys, face tilted toward the camera
    const panel = new THREE.Group();
    panel.position.set(0, DESK_Y + 0.34, -0.38);
    panel.rotation.x = -0.42;
    g.add(panel);

    const panelW = span + 0.16;
    const panelH = 1.04;
    panel.add(box(panelW, panelH, 0.06, 0x2a2838, 0, 0, 0));
    panel.add(box(0.06, panelH + 0.02, 0.1, 0x1a1820, -panelW / 2 - 0.01, 0, 0));
    panel.add(box(0.06, panelH + 0.02, 0.1, 0x1a1820, panelW / 2 + 0.01, 0, 0));

    const logoC = document.createElement('canvas');
    logoC.width = 256;
    logoC.height = 40;
    const lctx = logoC.getContext('2d')!;
    lctx.fillStyle = '#7cff5c';
    lctx.font = 'bold 24px Trebuchet MS, sans-serif';
    lctx.textAlign = 'center';
    lctx.fillText('HOOK SYNTH', 128, 29);
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.048),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(logoC), transparent: true }),
    );
    logo.position.set(0, panelH / 2 - 0.048, 0.032);
    panel.add(logo);

    type Ctrl = { tag: string; action: string; col: number };
    const row1: Ctrl[] = [
      { tag: 'SYN', action: 'syn', col: 0x3a6048 },
      { tag: 'BASS', action: 'bass', col: 0x604830 },
      { tag: 'BPM', action: 'bpm', col: 0x304860 },
      { tag: 'DRM', action: 'drm', col: 0x603858 },
    ];
    const row2: Ctrl[] = [
      { tag: 'ECHO', action: 'echo', col: 0x404858 },
      { tag: 'REV', action: 'rev', col: 0x404858 },
      { tag: 'ATK', action: 'atk', col: 0x404858 },
      { tag: 'MIC', action: 'mic', col: 0x3a5040 },
    ];
    const row3: Ctrl[] = [
      { tag: 'KEY VOL', action: 'leadvol', col: 0x5a5030 },
      { tag: 'BASS VOL', action: 'bassvol', col: 0x5a5030 },
      { tag: 'DRM VOL', action: 'drumvol', col: 0x5a5030 },
      { tag: 'SUST', action: 'sust', col: 0x4a4858 },
    ];
    const colCount = 4;
    const colInset = 0.1;
    const colStep = (panelW - colInset * 2) / colCount;
    const colX = (i: number) => -panelW / 2 + colInset + colStep * (i + 0.5);
    const colW = colStep * 0.84;
    const rowH = 0.26;
    const rowYs = [panelH / 2 - 0.2, panelH / 2 - 0.2 - rowH, panelH / 2 - 0.2 - rowH * 2];
    const addCtrl = (c: Ctrl, col: number, y: number) => {
      const x = colX(col);
      const btnY = y - 0.085;
      ctrlLabel(panel, colW, x, y + 0.048, 0.036, c.tag);
      const disp = makeDisplay(colW * 0.9, 0.032, x, btnY + 0.052, 0.034);
      panel.add(disp.mesh);
      this.synthDisplays.push(disp);
      const arrW = 0.068;
      const arrH = 0.036;
      const arrGap = arrW * 0.55;
      for (const m of arrowBtn(panel, arrW, arrH, 0.014, x - arrGap, btnY, 0.032, c.col, 'up', c.action)) {
        this.interactive.push(m);
      }
      for (const m of arrowBtn(panel, arrW, arrH, 0.014, x + arrGap, btnY, 0.032, c.col, 'down', c.action)) {
        this.interactive.push(m);
      }
    };
    const addGroupedRow = (row: Ctrl[], rowY: number, groupTitle: string) => {
      const groupedCols = [0, 1, 2];
      const xs = groupedCols.map((i) => colX(i));
      const branchZ = 0.036;
      addConsoleGroupHeader(panel, groupTitle, xs, rowY + 0.122, branchZ);
      addConsoleGroupBranches(panel, xs, rowY + 0.098, rowY + 0.068, branchZ);
      row.forEach((c, col) => addCtrl(c, col, rowY));
    };
    row1.forEach((c, col) => addCtrl(c, col, rowYs[0]!));
    addGroupedRow(row2.slice(0, 3), rowYs[1]!, 'EFFECTS');
    addCtrl(row2[3]!, 3, rowYs[1]!);
    addGroupedRow(row3.slice(0, 3), rowYs[2]!, 'VOLUME');
    addCtrl(row3[3]!, 3, rowYs[2]!);

    // Keybed: melody whites/blacks at the back, bass strip in front
    g.add(box(span + 0.08, 0.02, 0.56, 0x101018, 0, DESK_Y + 0.008, 0.13));
    g.add(box(0.06, 0.07, 0.56, 0x2a2430, -span / 2 - 0.06, DESK_Y + 0.04, 0.13));
    g.add(box(0.06, 0.07, 0.56, 0x2a2430, span / 2 + 0.06, DESK_Y + 0.04, 0.13));

    // Semitone offsets for two octaves of white keys (C D E F G A B ×2 + top C)
    const whiteSemis = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
    // Black keys sit between whites: C# D# F# G# A# in each octave
    const blackDefs = [
      { semi: 1, wx: 0.5 },
      { semi: 3, wx: 1.5 },
      { semi: 6, wx: 3.5 },
      { semi: 8, wx: 4.5 },
      { semi: 10, wx: 5.5 },
      { semi: 13, wx: 7.5 },
      { semi: 15, wx: 8.5 },
      { semi: 18, wx: 10.5 },
      { semi: 20, wx: 11.5 },
      { semi: 22, wx: 12.5 },
    ];

    for (let wi = 0; wi < whites; wi++) {
      this.addKey(g, 60 + whiteSemis[wi]!, sx + wi * ww, 0.02, ww - 0.006, 0.045, 0.24, 0xfffaf5, 'melody');
    }
    for (const b of blackDefs) {
      const bx = sx + b.wx * ww;
      const bk = box(0.046, 0.06, 0.14, 0x1a1a22, bx, DESK_Y + 0.062, -0.03);
      bk.renderOrder = 3;
      g.add(bk);
      this.interactive.push(bk);
      bk.userData.pick = { kind: 'melody-key', midi: 60 + b.semi, layer: 'melody' };
      this.keys.push({ mesh: bk, restY: bk.position.y, layer: 'melody', midi: 60 + b.semi, down: false });
    }

    // Bass strip: one flat orange row in front of the melody keys, all 13 semitones
    const bw = span / 13;
    for (let i = 0; i < 13; i++) {
      const isSharp = [1, 3, 6, 8, 10].includes(i);
      this.addKey(g, 36 + i, -span / 2 + bw / 2 + i * bw, 0.28, bw - 0.005, 0.03, 0.12, isSharp ? 0x9a4a20 : 0xffb868, 'bass');
    }

    this.scene.add(g);
    this.setAnchor('synth', COL.synth, DESK_Y + 0.1, GEAR_Z + 0.2);
    this.setAnchor('console', COL.synth, DESK_Y + 0.3, GEAR_Z - 0.28);
  }

  private buildDrumMachine(): void {
    const g = new THREE.Group();
    g.position.set(COL.drum, 0, GEAR_Z);

    // Vintage 808-style body with a face tilted toward the camera
    const face = new THREE.Group();
    face.position.set(0, DESK_Y + 0.15, 0.02);
    face.rotation.x = -0.5;
    g.add(face);

    const fw = 0.82;
    const fh = 0.42;
    face.add(box(fw, fh, 0.07, 0xc87830, 0, 0, 0));
    face.add(box(fw + 0.04, 0.05, 0.1, 0x3a3028, 0, -fh / 2, 0));
    face.add(box(fw + 0.04, 0.05, 0.1, 0x3a3028, 0, fh / 2, 0));

    const logo808 = document.createElement('canvas');
    logo808.width = 256;
    logo808.height = 48;
    const l8 = logo808.getContext('2d')!;
    l8.fillStyle = '#fff';
    l8.font = 'bold 30px Trebuchet MS, sans-serif';
    l8.textAlign = 'center';
    l8.fillText('RHYTHM 808', 128, 35);
    const logoMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.05),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(logo808), transparent: true }),
    );
    logoMesh.position.set(-0.24, fh / 2 - 0.055, 0.037);
    face.add(logoMesh);

    const kitY = fh / 2 - 0.055;
    const kitBtnY = kitY - 0.048;
    ctrlLabel(face, 0.14, 0.1, kitY + 0.012, 0.038, 'KIT');
    const kitDisp = makeDisplay(0.12, 0.03, 0.1, kitBtnY + 0.038, 0.038);
    face.add(kitDisp.mesh);
    this.drumDisplays.push(kitDisp);
    for (const m of arrowBtn(face, 0.045, 0.04, 0.014, 0.055, kitBtnY, 0.037, 0x404858, 'up', 'kit')) {
      this.interactive.push(m);
    }
    for (const m of arrowBtn(face, 0.045, 0.04, 0.014, 0.145, kitBtnY, 0.037, 0x404858, 'down', 'kit')) {
      this.interactive.push(m);
    }

    const patY = kitY;
    const patBtnY = patY - 0.048;
    ctrlLabel(face, 0.14, 0.27, patY + 0.012, 0.038, 'PAT');
    const patDisp = makeDisplay(0.12, 0.03, 0.27, patBtnY + 0.038, 0.038);
    face.add(patDisp.mesh);
    this.drumDisplays.push(patDisp);
    for (const m of arrowBtn(face, 0.045, 0.04, 0.014, 0.225, patBtnY, 0.037, 0x405848, 'up', 'pat')) {
      this.interactive.push(m);
    }
    for (const m of arrowBtn(face, 0.045, 0.04, 0.014, 0.315, patBtnY, 0.037, 0x405848, 'down', 'pat')) {
      this.interactive.push(m);
    }

    const sounds: DrumSound[] = ['kick', 'snare', 'hat', 'clap'];
    const padColors = [0xff59d3, 0xffa040, 0x7cff5c, 0x35a7e8];
    const rowLbl = ['K', 'S', 'H', 'C'];
    const padW = 0.034;
    const padGap = 0.0465;
    const gridX = -fw / 2 + 0.075;
    const gridY = fh / 2 - 0.175;
    for (let row = 0; row < 4; row++) {
      const lc = document.createElement('canvas');
      lc.width = 32;
      lc.height = 32;
      const lx = lc.getContext('2d')!;
      lx.fillStyle = '#1a1210';
      lx.fillRect(1, 1, 30, 30);
      lx.strokeStyle = '#3a3028';
      lx.lineWidth = 2;
      lx.strokeRect(1, 1, 30, 30);
      lx.fillStyle = '#fff8e8';
      lx.font = 'bold 23px Trebuchet MS';
      lx.textAlign = 'center';
      lx.textBaseline = 'middle';
      lx.fillText(rowLbl[row]!, 16, 17);
      const lbl = new THREE.Mesh(
        new THREE.PlaneGeometry(0.036, 0.036),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lc) }),
      );
      lbl.position.set(gridX - 0.055, gridY - row * 0.06, 0.041);
      face.add(lbl);

      for (let col = 0; col < 16; col++) {
        const pad = new THREE.Mesh(
          new THREE.BoxGeometry(padW, 0.05, 0.018),
          mat(padColors[row]!, { emissiveInt: 0.16 }),
        );
        pad.position.set(gridX + col * padGap, gridY - row * 0.06, 0.038);
        face.add(pad);
        this.interactive.push(pad);
        pad.userData.pick = { kind: 'pad', sound: sounds[row], step: col };
        this.pads.push({ mesh: pad, sound: sounds[row]!, step: col, on: false });
      }
    }

    this.scene.add(g);
    this.setAnchor('drums', COL.drum, DESK_Y + 0.3, GEAR_Z + 0.05);
  }

  private buildTapeDeck(): void {
    const g = new THREE.Group();
    g.position.set(COL.tape, 0, GEAR_Z);

    // Reel-to-reel deck with a face tilted toward the camera
    const face = new THREE.Group();
    face.position.set(0, DESK_Y + 0.15, 0.02);
    face.rotation.x = -0.5;
    g.add(face);

    const fw = 0.66;
    const fh = 0.42;
    face.add(box(fw, fh, 0.07, 0x9a9498, 0, 0, 0));
    face.add(box(fw + 0.04, 0.05, 0.1, 0x4a4448, 0, -fh / 2, 0));
    face.add(box(fw + 0.04, 0.05, 0.1, 0x4a4448, 0, fh / 2, 0));

    const tapeLogoC = document.createElement('canvas');
    tapeLogoC.width = 256;
    tapeLogoC.height = 40;
    const tl = tapeLogoC.getContext('2d')!;
    tl.fillStyle = '#2a2830';
    tl.font = 'bold 26px Trebuchet MS, sans-serif';
    tl.textAlign = 'center';
    tl.fillText('TAPE DECK', 128, 29);
    const tapeLogo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.04),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(tapeLogoC), transparent: true }),
    );
    tapeLogo.position.set(0, fh / 2 - 0.04, 0.037);
    face.add(tapeLogo);

    // Each reel is a group that spins around its own axis (local z = face normal),
    // so the spokes visibly rotate while recording.
    const mkReel = (x: number): THREE.Group => {
      const spinner = new THREE.Group();
      spinner.position.set(x, 0.045, 0.05);
      face.add(spinner);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.022, 22), mat(0x4a4a58));
      disc.rotation.x = Math.PI / 2;
      disc.position.z = -0.005;
      spinner.add(disc);
      for (let s = 0; s < 3; s++) {
        const spoke = box(0.16, 0.02, 0.008, 0x9a9aa8, 0, 0, 0.01);
        spoke.rotation.z = (s * Math.PI) / 3;
        spinner.add(spoke);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.034, 12), mat(0xd8d8e0));
      hub.rotation.x = Math.PI / 2;
      spinner.add(hub);
      return spinner;
    };
    this.reelL = mkReel(-0.17);
    this.reelR = mkReel(0.17);

    // Tape strip between reels
    face.add(box(0.16, 0.02, 0.01, 0x2a2020, 0, -0.045, 0.04));

    this.recLed = box(0.028, 0.028, 0.014, 0x550000, -0.24, -fh / 2 + 0.075, 0.037);
    face.add(this.recLed);

    this.recBtn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.062, 0.068, 0.028, 20),
      mat(0xff4040, { emissive: 0xff2020, emissiveInt: 0.5 }),
    );
    this.recBtn.rotation.x = Math.PI / 2;
    this.recBtn.position.set(0, -fh / 2 + 0.085, 0.045);
    face.add(this.recBtn);
    this.interactive.push(this.recBtn);
    this.recBtn.userData.pick = { kind: 'rec' };

    const rc = document.createElement('canvas');
    rc.width = 64;
    rc.height = 64;
    const rcx = rc.getContext('2d')!;
    rcx.fillStyle = '#fff';
    rcx.font = 'bold 20px Trebuchet MS';
    rcx.textAlign = 'center';
    rcx.textBaseline = 'middle';
    rcx.fillText('REC', 32, 32);
    const recPlate = new THREE.Mesh(
      new THREE.CircleGeometry(0.048, 18),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(rc), transparent: true }),
    );
    recPlate.position.set(0, -fh / 2 + 0.085, 0.06);
    face.add(recPlate);

    for (let i = 0; i < 6; i++) {
      const led = box(0.018, 0.03, 0.012, 0x1a3020, 0.13 + i * 0.026, -fh / 2 + 0.08, 0.037);
      face.add(led);
      this.vuLeds.push(led);
    }

    this.scene.add(g);
    this.setAnchor('tape', COL.tape, DESK_Y + 0.3, GEAR_Z + 0.05);
  }

  private buildMic(): void {
    // Classic '50s desk mic (Shure 55 style) leaning back toward the player.
    const g = new THREE.Group();
    g.position.set(0.88, 0, GEAR_Z - 0.05);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.115, 0.03, 16), mat(0x2a2830));
    base.position.set(0, DESK_Y + 0.028, 0);
    g.add(base);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.42, 10), mat(0x8a8a98, { shininess: 90 }));
    pole.position.set(0, DESK_Y + 0.24, 0);
    g.add(pole);

    // Head assembly tilted back so the grille faces the camera
    const head = new THREE.Group();
    head.position.set(0, DESK_Y + 0.47, 0.01);
    head.rotation.x = 0.5;
    g.add(head);

    // U-shaped yoke holding the capsule
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 18, Math.PI), mat(0x3a3848));
    yoke.rotation.set(0, Math.PI / 2, Math.PI / 2);
    yoke.position.set(0, -0.015, 0);
    head.add(yoke);

    // Capsule body: fat rounded shell, flat grille face toward +z (camera)
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), mat(0xa8a8b8, { emissiveInt: 0.12, shininess: 110 }));
    shell.scale.set(0.85, 1, 0.72);
    head.add(shell);

    // Horizontal grille slats, classic look
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(new THREE.TorusGeometry(0.048 - Math.abs(i - 1.5) * 0.007, 0.005, 6, 18), mat(0x50505f));
      slat.rotation.x = Math.PI / 2;
      slat.position.set(0, 0.03 - i * 0.02, 0.012);
      head.add(slat);
    }

    // Dark front window behind slats
    const front = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), mat(0x22222e));
    front.scale.set(0.78, 0.92, 0.66);
    front.position.z = 0.006;
    head.add(front);

    // Little brand badge on the front
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 10), mat(0xddb020, { emissive: 0xffaa22, emissiveInt: 0.7 }));
    badge.rotation.x = Math.PI / 2;
    badge.position.set(0, -0.028, 0.042);
    head.add(badge);
    // this.micBadge = badge;

    for (let i = 0; i < 5; i++) {
      const z = makeZzzSprite(0.9 + (i % 2) * 0.22);
      z.visible = false;
      z.position.set((Math.random() - 0.5) * 0.04, 0.02 + Math.random() * 0.02, 0.078);
      head.add(z);
      this.micZzz.push(z);
    }

    this.scene.add(g);
    this.setAnchor('mic', 0.88, DESK_Y + 0.5, GEAR_Z);
  }

  private buildProps(): void {
    // --- Beer can: tall, bright red label wrap, silver top with tab ---
    const canG = new THREE.Group();
    canG.position.set(COL.can, DESK_Y, PROP_Z);
    const canR = 0.085;
    const canH = 0.24;

    const labelC = document.createElement('canvas');
    labelC.width = 512;
    labelC.height = 256;
    const bx = labelC.getContext('2d')!;
    bx.fillStyle = '#c81f1f';
    bx.fillRect(0, 0, 512, 256);
    bx.fillStyle = '#f5e9c8';
    bx.fillRect(0, 84, 512, 88);
    bx.fillStyle = '#a01818';
    bx.font = 'bold 64px Trebuchet MS, sans-serif';
    bx.textAlign = 'center';
    bx.textBaseline = 'middle';
    bx.fillText('BEER', 128, 128);
    bx.fillText('BEER', 384, 128);
    bx.fillStyle = '#f5e9c8';
    bx.font = 'bold 24px Trebuchet MS, sans-serif';
    bx.fillText('STUDIO BREW · EST 1994', 256, 220);
    const labelTex = new THREE.CanvasTexture(labelC);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(canR, canR * 0.96, canH, 18, 1, true),
      new THREE.MeshBasicMaterial({ map: labelTex }),
    );
    body.position.y = canH / 2;
    canG.add(body);

    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(canR * 0.96, canR * 0.9, 0.02, 18), mat(0xb8b8c0));
    bottom.position.y = 0.01;
    canG.add(bottom);
    // Dark contour rim + contact shadow so the can sits grounded on the desk
    const bottomRim = new THREE.Mesh(new THREE.CylinderGeometry(canR * 0.92, canR * 0.92, 0.008, 18), mat(0x2a2028));
    bottomRim.position.y = 0.003;
    canG.add(bottomRim);
    const canShadow = new THREE.Mesh(
      new THREE.CircleGeometry(canR * 1.25, 20),
      new THREE.MeshBasicMaterial({ color: 0x1a1016, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    canShadow.rotation.x = -Math.PI / 2;
    canShadow.position.set(0.015, 0.002, 0.015);
    canG.add(canShadow);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(canR * 0.82, canR, 0.03, 18), mat(0xd8d8e0, { emissiveInt: 0.2 }));
    top.position.y = canH + 0.012;
    canG.add(top);
    const tab = box(0.045, 0.008, 0.02, 0x909098, 0, canH + 0.032, 0.012);
    canG.add(tab);
    this.scene.add(canG);
    this.setAnchor('beer', COL.can, DESK_Y + canH, PROP_Z);

    // --- Ashtray with a cigarette resting on the rim ---
    const tx = COL.tray;
    const tz = PROP_Z;
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.05, 20), mat(0xb0a89a, { emissiveInt: 0.16 }));
    tray.position.set(tx, DESK_Y + 0.028, tz);
    this.scene.add(tray);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.1, 0.034, 20), mat(0x2e2a24));
    inner.position.set(tx, DESK_Y + 0.042, tz);
    this.scene.add(inner);
    // Ash pile
    const ash = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat(0x777770));
    ash.scale.set(1.4, 0.5, 1.4);
    ash.position.set(tx - 0.03, DESK_Y + 0.05, tz + 0.02);
    this.scene.add(ash);

    // Cigarette: one straight white stick + tan filter + glowing tip, built
    // as a single group so all parts stay aligned. It leans on the rim.
    const cigG = new THREE.Group();
    const cigLen = 0.17;
    const cigR = 0.012;
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(cigR, cigR, cigLen * 0.72, 10), mat(0xfdfaf2, { emissiveInt: 0.25 }));
    paper.position.y = cigLen * 0.14;
    cigG.add(paper);
    const filter = new THREE.Mesh(new THREE.CylinderGeometry(cigR, cigR, cigLen * 0.28, 10), mat(0xe8a54e, { emissiveInt: 0.2 }));
    filter.position.y = -cigLen * 0.36;
    cigG.add(filter);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(cigR * 0.92, cigR * 0.92, 0.014, 10), mat(0xff5510, { emissive: 0xff3300, emissiveInt: 1.6 }));
    tip.position.y = cigLen * 0.5 + 0.006;
    cigG.add(tip);
    // Lean the cig: filter end down inside the tray, lit end up on the rim
    cigG.rotation.z = Math.PI / 2 - 0.35;
    cigG.rotation.y = 0.5;
    cigG.position.set(tx - 0.02, DESK_Y + 0.075, tz - 0.04);
    this.scene.add(cigG);

    const tipWorld = new THREE.Vector3();
    tip.getWorldPosition(tipWorld);
    this.ember = tip;
    this.smokeOrigin.copy(tipWorld);
    this.setAnchor('smoke', tx, DESK_Y + 0.12, tz);

    for (let i = 0; i < 16; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.014 + i * 0.0022, 6, 6),
        new THREE.MeshPhongMaterial({ color: 0xd8d8e2, transparent: true, opacity: 0.45, flatShading: true }),
      );
      p.position.copy(this.smokeOrigin);
      p.position.y += i * 0.035;
      this.scene.add(p);
      this.smoke.push(p);
    }
  }

  private setupInput(canvas: HTMLCanvasElement): void {
    const pick = (clientX: number, clientY: number): THREE.Intersection | null => {
      const rect = canvas.getBoundingClientRect();
      this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      return this.raycaster.intersectObjects(this.interactive, false)[0] ?? null;
    };

    const keyFromPoint = (clientX: number, clientY: number): KeyObj | null => {
      const hit = pick(clientX, clientY);
      if (!hit) return null;
      const p = hit.object.userData.pick as Record<string, unknown> | undefined;
      if (p?.kind !== 'melody-key' && p?.kind !== 'bass-key') return null;
      return this.keys.find((k) => k.mesh === hit.object) ?? null;
    };

    const handlePointerDown = (ev: PointerEvent): void => {
      const hit = pick(ev.clientX, ev.clientY);
      if (!hit) return;
      const p = hit.object.userData.pick as Record<string, unknown>;
      if (!p) return;

      if (p.kind === 'melody-key' || p.kind === 'bass-key') {
        ev.preventDefault();
        const ko = this.keys.find((k) => k.mesh === hit.object);
        if (!ko) return;
        try {
          canvas.setPointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        if (this.touchIds.get(ev.pointerId) === ko) return;
        const held = this.touchIds.get(ev.pointerId);
        if (held && held !== 'rec' && 'midi' in held) this.releaseKey(held, ev.pointerId);
        this.pressKey(ko, ev.pointerId);
        return;
      }
      if (p.kind === 'pad') {
        const po = this.pads.find((x) => x.mesh === hit.object);
        if (!po) return;
        this.cb?.onStepToggle(po.sound, po.step);
        return;
      }
      if (p.kind === 'rec') {
        this.cb?.onRecPress();
        return;
      }
      if (p.kind === 'ctrl') {
        const a = p.action as string;
        const cb = this.cb;
        if (!cb) return;
        const m = a.match(/^(.+)-(up|down)$/);
        if (m) cb.onCtrl(m[1]!, m[2] as 'up' | 'down');
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });

    canvas.addEventListener('pointermove', (ev) => {
      const held = this.touchIds.get(ev.pointerId);
      if (!held || held === 'rec' || !('midi' in held)) return;
      const ko = keyFromPoint(ev.clientX, ev.clientY);
      if (!ko || ko === held) return;
      ev.preventDefault();
      this.releaseKey(held, ev.pointerId);
      this.pressKey(ko, ev.pointerId);
    }, { passive: false });

    canvas.addEventListener('pointerup', (ev) => this.releasePointer(ev.pointerId));
    canvas.addEventListener('pointercancel', (ev) => this.releasePointer(ev.pointerId));

    const touchKeyFrom = (touch: Touch): KeyObj | null => keyFromPoint(touch.clientX, touch.clientY);

    canvas.addEventListener(
      'touchstart',
      (ev) => {
        for (const touch of ev.changedTouches) {
          const ko = touchKeyFrom(touch);
          if (!ko) continue;
          ev.preventDefault();
          const id = touch.identifier + 10_000;
          if (this.touchIds.get(id) === ko) continue;
          const held = this.touchIds.get(id);
          if (held && held !== 'rec' && 'midi' in held) this.releaseKey(held, id);
          this.pressKey(ko, id);
        }
      },
      { passive: false },
    );

    canvas.addEventListener(
      'touchmove',
      (ev) => {
        for (const touch of ev.changedTouches) {
          const id = touch.identifier + 10_000;
          const held = this.touchIds.get(id);
          if (!held || held === 'rec' || !('midi' in held)) continue;
          const ko = touchKeyFrom(touch);
          if (!ko || ko === held) continue;
          ev.preventDefault();
          this.releaseKey(held, id);
          this.pressKey(ko, id);
        }
      },
      { passive: false },
    );

    const endTouch = (ev: TouchEvent): void => {
      for (const touch of ev.changedTouches) {
        this.releasePointer(touch.identifier + 10_000);
      }
    };
    canvas.addEventListener('touchend', endTouch, { passive: true });
    canvas.addEventListener('touchcancel', endTouch, { passive: true });

    window.addEventListener('blur', () => this.releaseAllKeys());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.releaseAllKeys();
    });

    window.addEventListener('keydown', (ev) => {
      if (this.keyboardEventBlocked(ev)) return;
      const code = ev.code;
      const midi = ALL_KEYS[code];
      if (midi === undefined || this.keysDown.has(code)) return;
      ev.preventDefault();
      this.keysDown.add(code);
      const layer = BASS_KEYBOARD_MAP[code] !== undefined ? 'bass' : 'melody';
      const keyId = this.keyboardTouchId(code);

      const ko = this.keys.find((k) => k.midi === midi && k.layer === layer);
      if (ko) {
        this.pressKey(ko, keyId);
      } else {
        this.cb?.onNoteDown(midi, 'keyboard', keyId, layer);
      }
      this.kbGlide[layer] = { code, midi };
    });

    window.addEventListener('keyup', (ev) => {
      if (this.keyboardEventBlocked(ev)) return;
      const code = ev.code;
      const midi = ALL_KEYS[code];
      if (midi === undefined || !this.keysDown.has(code)) return;
      ev.preventDefault();
      this.keysDown.delete(code);
      const layer = BASS_KEYBOARD_MAP[code] !== undefined ? 'bass' : 'melody';
      const keyId = this.keyboardTouchId(code);
      const ko = this.keys.find((k) => k.midi === midi && k.layer === layer);
      if (ko) {
        this.releaseKey(ko, keyId);
      } else {
        this.cb?.onNoteUp(midi, 'keyboard', keyId, layer);
      }
      if (this.kbGlide[layer]?.code === code) this.kbGlide[layer] = null;
    });
  }

  private keyboardTouchId(code: string): number {
    let id = this.keyboardTouchIds.get(code);
    if (id === undefined) {
      id = this.nextKeyboardTouchId++;
      this.keyboardTouchIds.set(code, id);
    }
    return id;
  }

  private noteSourceForId(id: number): NoteSource {
    if (id === KB_GLIDE_ID.melody || id === KB_GLIDE_ID.bass || id >= 2000) return 'keyboard';
    return 'canvas';
  }

  private keyHeldByOthers(ko: KeyObj, exceptId?: number): boolean {
    for (const [id, obj] of this.touchIds) {
      if (exceptId !== undefined && id === exceptId) continue;
      if (obj === ko) return true;
    }
    return false;
  }

  private releaseKeyboardGlide(layer: 'melody' | 'bass'): void {
    const glide = this.kbGlide[layer];
    if (!glide) return;
    const glideId = KB_GLIDE_ID[layer];
    const ko = this.keys.find((k) => k.midi === glide.midi && k.layer === layer);
    if (ko?.down) this.releaseKey(ko, glideId);
    else this.cb?.onNoteUp(glide.midi, 'keyboard', glideId, layer);
    this.kbGlide[layer] = null;
  }

  private pressKey(ko: KeyObj, id: number): void {
    const prev = this.touchIds.get(id);
    if (prev && prev !== 'rec' && 'midi' in prev && prev !== ko) {
      this.releaseKey(prev, id);
    }
    if (this.touchIds.get(id) === ko) return;

    const alreadyHeld = ko.down;
    ko.down = true;
    ko.mesh.position.y = ko.restY - 0.008;
    (ko.mesh.material as THREE.MeshPhongMaterial).emissive.setHex(ko.layer === 'bass' ? 0x804010 : 0x666620);
    (ko.mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.5;
    this.touchIds.set(id, ko);
    if (!alreadyHeld) {
      const source = this.noteSourceForId(id);
      this.cb?.onNoteDown(ko.midi, source, id, ko.layer);
    }
  }

  private releaseKey(ko: KeyObj, id: number): void {
    if (this.touchIds.get(id) !== ko) return;
    this.touchIds.delete(id);
    if (this.keyHeldByOthers(ko)) return;

    if (!ko.down) return;
    ko.down = false;
    ko.mesh.position.y = ko.restY;
    const m = ko.mesh.material as THREE.MeshPhongMaterial;
    m.emissive.copy(m.color);
    m.emissiveIntensity = 0.08;
    const source = this.noteSourceForId(id);
    this.cb?.onNoteUp(ko.midi, source, id, ko.layer);
  }

  private releasePointer(id: number): void {
    const obj = this.touchIds.get(id);
    if (!obj || obj === 'rec') return;
    if ('midi' in obj) this.releaseKey(obj, id);
  }

  private releaseAllKeys(): void {
    for (const [id, obj] of [...this.touchIds.entries()]) {
      if (obj !== 'rec' && 'midi' in obj) this.releaseKey(obj, id);
    }
    this.releaseKeyboardGlide('melody');
    this.releaseKeyboardGlide('bass');
    this.keysDown.clear();
  }

  /** Drop held 3D/keyboard notes when UI blocks instrument input (review bar, typing, etc.). */
  releaseInstrumentInput(): void {
    this.releaseAllKeys();
  }

  private keyboardEventBlocked(ev: KeyboardEvent): boolean {
    const target = ev.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return true;
    return document.body.classList.contains('instruments-blocked');
  }

  private update(t: number): void {
    const rec = this.cb?.isRecording() ?? false;
    (this.recLed.material as THREE.MeshPhongMaterial).emissive.setHex(rec ? 0xff2020 : 0x330000);
    (this.recLed.material as THREE.MeshPhongMaterial).emissiveIntensity = rec ? 1.2 : 0.2;
    (this.recBtn.material as THREE.MeshPhongMaterial).emissiveIntensity = rec ? 0.7 : 0.45;

    if (rec) {
      this.reelL.rotation.z = -t * 4;
      this.reelR.rotation.z = -t * 4.4;
      const n = Math.floor((this.cb?.getRecordingProgress() ?? 0) * this.vuLeds.length);
      this.vuLeds.forEach((led, i) => {
        const on = i < n;
        (led.material as THREE.MeshPhongMaterial).color.setHex(on ? 0x7cff5c : 0x1a3020);
        (led.material as THREE.MeshPhongMaterial).emissiveIntensity = on ? 0.8 : 0;
      });
    }

    if (this.ember) {
      this.ember.scale.setScalar(1 + Math.sin(t * 4) * 0.3);
      (this.ember.material as THREE.MeshPhongMaterial).emissiveIntensity = 1.0 + Math.sin(t * 5) * 0.5;
    }

    for (const p of this.smoke) {
      p.position.y += 0.0028;
      p.position.x += Math.sin(t * 0.8 + p.id) * 0.0006;
      if (p.position.y > DESK_Y + 0.65) {
        p.position.copy(this.smokeOrigin);
        p.position.x += (Math.random() - 0.5) * 0.025;
      }
    }

    const micOff = this.cb?.getMicLabel() === 'OFF';
    const zBaseY = 0.02;
    const zBaseZ = 0.078;
    if (micOff && !this.micWasOff) {
      for (const z of this.micZzz) {
        z.position.set((Math.random() - 0.5) * 0.045, zBaseY + Math.random() * 0.02, zBaseZ + Math.random() * 0.012);
      }
    }
    this.micWasOff = micOff;
    for (const z of this.micZzz) {
      z.visible = micOff;
      if (!micOff) continue;
      z.position.y += 0.0015;
      z.position.x += Math.sin(t * 0.65 + z.id) * 0.0007;
      const mat = z.material as THREE.SpriteMaterial;
      const dy = z.position.y - zBaseY;
      mat.opacity = Math.max(0.35, 0.92 - dy * 2.1);
      if (dy > 0.14) {
        z.position.set((Math.random() - 0.5) * 0.045, zBaseY + Math.random() * 0.015, zBaseZ + Math.random() * 0.012);
      }
    }

    const pat = this.cb?.getPattern();
    const hi = this.cb?.getStepHighlight() ?? -1;
    if (pat) {
      for (const po of this.pads) {
        const on = pat[po.sound]?.[po.step] === 1;
        po.on = on;
        const isHi = po.step === hi;
        (po.mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = on ? 0.65 : isHi ? 0.32 : 0.12;
      }
    }

    const cb = this.cb;
    if (cb) {
      const synthTexts = [
        cb.getPresetLabel(), cb.getBassLabel(), cb.getBpmLabel(), cb.getDrumsLabel(),
        cb.getEchoLabel(), cb.getReverbLabel(), cb.getAttackLabel(), cb.getMicLabel(),
        cb.getLeadVolLabel(), cb.getBassVolLabel(), cb.getDrumVolLabel(), cb.getSustainLabel(),
      ];
      const synthColors = [
        '#7cff5c', '#ffb060', '#35a7e8', '#ff59d3',
        '#aaa', '#aaa', '#aaa', '#7cff5c',
        '#ffd860', '#ffd860', '#ffd860', '#7cff5c',
      ];
      for (let i = 0; i < synthTexts.length; i++) {
        if (synthTexts[i] !== this.lastSynthTexts[i]) {
          updateDisplay(this.synthDisplays[i]!, synthTexts[i]!, synthColors[i]);
          this.lastSynthTexts[i] = synthTexts[i]!;
        }
      }
      const drumTexts = [cb.getDrumKitLabel(), cb.getDrumPatternLabel()];
      for (let i = 0; i < 2; i++) {
        if (drumTexts[i] !== this.lastDrumTexts[i]) {
          updateDisplay(this.drumDisplays[i]!, drumTexts[i]!, '#ffa040');
          this.lastDrumTexts[i] = drumTexts[i]!;
        }
      }
    }

    this.camera.position.y = this.camBase.y + Math.sin(t * 0.2) * 0.006;
    this.camera.lookAt(CAM_LOOK.x, this.camBase.lookY, CAM_LOOK.z);
  }
}
