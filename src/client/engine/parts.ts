import * as THREE from 'three';
import { Rng } from './rng';
import { toon, noOutline } from './style';

export type SlotId = 'body' | 'wheels' | 'engine' | 'nose' | 'topper';
export const SLOT_ORDER: SlotId[] = ['body', 'wheels', 'engine', 'nose', 'topper'];
export const SLOT_LABEL: Record<SlotId, string> = {
  body: 'Kart Shell',
  wheels: 'Tires',
  engine: 'Boost',
  nose: 'Bumper',
  topper: 'Flair',
};

export type PartStats = {
  mass: number;
  durability: number;
  hw?: number;
  hh?: number;
  wheelRadius?: number;
  roll?: number;
  restitution?: number;
  power?: number;
  aero?: number;
  lift?: number;
};

export type PartVariant = {
  slot: SlotId;
  archetype: string;
  name: string;
  color: number;
  color2: number;
  scale: number;
  stats: PartStats;
};

type Archetype = { noun: string; base: PartStats };

const BODIES: Record<string, Archetype> = {
  tub: { noun: 'Bubble Kart', base: { mass: 4.0, durability: 62, hw: 1.45, hh: 0.62 } },
  wedge: { noun: 'Speed Wedge', base: { mass: 3.4, durability: 54, hw: 1.75, hh: 0.55 } },
  box: { noun: 'Block Buggy', base: { mass: 5.0, durability: 74, hw: 1.25, hh: 0.85 } },
  banana: { noun: 'Banana Racer', base: { mass: 3.0, durability: 44, hw: 1.85, hh: 0.48 } },
  barrel: { noun: 'Drum Racer', base: { mass: 4.6, durability: 68, hw: 1.1, hh: 0.95 } },
  sofa: { noun: 'Couch Cruiser', base: { mass: 6.2, durability: 50, hw: 1.7, hh: 0.78 } },
};

const WHEELS: Record<string, Archetype> = {
  cart: { noun: 'Standard Tires', base: { mass: 0.6, durability: 34, wheelRadius: 0.58, roll: 0.82, restitution: 0.2 } },
  monster: { noun: 'Monster Tires', base: { mass: 1.4, durability: 56, wheelRadius: 0.95, roll: 0.96, restitution: 0.3 } },
  caster: { noun: 'Tiny Rollers', base: { mass: 0.3, durability: 18, wheelRadius: 0.34, roll: 0.55, restitution: 0.1 } },
  stone: { noun: 'Stone Rollers', base: { mass: 2.1, durability: 72, wheelRadius: 0.72, roll: 0.6, restitution: 0.05 } },
  spring: { noun: 'Bouncy Tires', base: { mass: 0.7, durability: 30, wheelRadius: 0.65, roll: 0.85, restitution: 0.62 } },
  wagon: { noun: 'Wagon Wheels', base: { mass: 0.9, durability: 46, wheelRadius: 0.8, roll: 0.9, restitution: 0.22 } },
};

const ENGINES: Record<string, Archetype> = {
  hamster: { noun: 'Hamster Motor', base: { mass: 1.0, durability: 30, power: 0.5 } },
  blower: { noun: 'Turbo Fan', base: { mass: 1.5, durability: 34, power: 0.85 } },
  rocket: { noun: 'Rocket Pack', base: { mass: 2.0, durability: 22, power: 1.55 } },
  v8: { noun: 'Pipe Engine', base: { mass: 3.0, durability: 52, power: 1.2 } },
  fan: { noun: 'Prop Fan', base: { mass: 1.2, durability: 34, power: 0.7 } },
  catapult: { noun: 'Snap Boost', base: { mass: 1.4, durability: 40, power: 1.05 } },
};

const NOSES: Record<string, Archetype> = {
  plow: { noun: 'Snow Plow', base: { mass: 1.2, durability: 42, aero: 0.2 } },
  noodle: { noun: 'Pool Noodle', base: { mass: 0.4, durability: 64, aero: 0.1 } },
  ram: { noun: 'Ram Horn', base: { mass: 2.0, durability: 76, aero: 0.05 } },
  beak: { noun: 'Beak Bumper', base: { mass: 0.6, durability: 30, aero: 0.36 } },
  bumper: { noun: 'Rubber Bumper', base: { mass: 1.0, durability: 54, aero: 0.15 } },
  cone: { noun: 'Cone Guard', base: { mass: 0.7, durability: 38, aero: 0.22 } },
};

const TOPPERS: Record<string, Archetype> = {
  fin: { noun: 'Shark Fin', base: { mass: 0.5, durability: 26, aero: 0.5 } },
  wing: { noun: 'Spoiler Wing', base: { mass: 0.8, durability: 30, aero: 0.72 } },
  umbrella: { noun: 'Parasol', base: { mass: 0.4, durability: 16, aero: 0.4, lift: 0.16 } },
  balloons: { noun: 'Balloon Stack', base: { mass: 0.3, durability: 12, aero: 0.2, lift: 0.42 } },
  flag: { noun: 'Victory Flag', base: { mass: 0.2, durability: 18, aero: 0.16 } },
  prophat: { noun: 'Propeller Cap', base: { mass: 0.6, durability: 22, aero: 0.55, lift: 0.1 } },
};

const TABLES: Record<SlotId, Record<string, Archetype>> = {
  body: BODIES,
  wheels: WHEELS,
  engine: ENGINES,
  nose: NOSES,
  topper: TOPPERS,
};

const ADJECTIVES = [
  'Turbo', 'Deluxe', 'Wacky', 'Mega', 'Rainbow', 'Budget', 'Royal', 'Wonky',
  'Galactic', 'Sparkle', 'Chunky', 'Feral', 'Spicy', 'Vintage', 'Golden',
];
const PALETTE = [
  0xe8503a, 0xf2952f, 0xf6cf3a, 0x6fcf66, 0x35a7e8, 0x8a6fe0, 0xef79b3,
  0x2bb7a8, 0xff7a5c, 0x9ad24a, 0xff4d6d, 0x4ecdc4,
];

function jitter(rng: Rng, v: number, pct: number): number {
  return v * (1 + rng.range(-pct, pct));
}

function makeVariant(rng: Rng, slot: SlotId, archetype: string): PartVariant {
  const arch = TABLES[slot][archetype]!;
  const base = arch.base;
  const stats: PartStats = {
    mass: jitter(rng, base.mass, 0.12),
    durability: Math.round(jitter(rng, base.durability, 0.15)),
  };
  if (base.hw !== undefined) stats.hw = jitter(rng, base.hw, 0.1);
  if (base.hh !== undefined) stats.hh = jitter(rng, base.hh, 0.1);
  if (base.wheelRadius !== undefined) stats.wheelRadius = jitter(rng, base.wheelRadius, 0.1);
  if (base.roll !== undefined) stats.roll = THREE.MathUtils.clamp(jitter(rng, base.roll, 0.08), 0.3, 1);
  if (base.restitution !== undefined) stats.restitution = base.restitution;
  if (base.power !== undefined) stats.power = jitter(rng, base.power, 0.12);
  if (base.aero !== undefined) stats.aero = THREE.MathUtils.clamp(jitter(rng, base.aero, 0.1), 0, 1);
  if (base.lift !== undefined) stats.lift = jitter(rng, base.lift, 0.12);

  const adj = rng.pick(ADJECTIVES);
  return {
    slot,
    archetype,
    name: `${adj} ${arch.noun}`,
    color: rng.pick(PALETTE),
    color2: rng.pick(PALETTE),
    scale: jitter(rng, 1, 0.12),
    stats,
  };
}

export function generateCatalog(seed: number, perSlot = 6): Record<SlotId, PartVariant[]> {
  const rng = new Rng(seed);
  const out = {} as Record<SlotId, PartVariant[]>;
  for (const slot of SLOT_ORDER) {
    const keys = Object.keys(TABLES[slot]);
    const variants: PartVariant[] = [];
    for (let i = 0; i < perSlot; i++) {
      const arch = keys[(i + rng.int(0, keys.length - 1)) % keys.length]!;
      variants.push(makeVariant(rng, slot, arch));
    }
    out[slot] = variants;
  }
  return out;
}

export function buildPart(v: PartVariant): THREE.Group {
  switch (v.slot) {
    case 'body':
      return buildBody(v);
    case 'wheels':
      return buildWheel(v);
    case 'engine':
      return buildEngine(v);
    case 'nose':
      return buildNose(v);
    case 'topper':
      return buildTopper(v);
  }
}

function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Shared kart read — tray, roll cage, seat, wheel arches. Layered under every body archetype. */
function kartFrame(hw: number, hh: number, main: THREE.Material, trim: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const depth = 1.65;

  const tray = box(hw * 2.05, hh * 0.28, depth, toon({ color: 0x2a2a2a }));
  tray.position.y = -hh * 0.55;
  g.add(tray);

  for (const [ax, az] of [
    [hw * 0.62, depth / 2 - 0.05],
    [hw * 0.62, -depth / 2 + 0.05],
    [-hw * 0.62, depth / 2 - 0.05],
    [-hw * 0.62, -depth / 2 + 0.05],
  ] as const) {
    const arch = box(0.55, 0.42, 0.55, trim);
    arch.position.set(ax, -hh * 0.35, az);
    g.add(arch);
  }

  const seat = box(hw * 0.55, hh * 0.45, depth * 0.55, main);
  seat.position.set(-hw * 0.05, hh * 0.05, 0);
  g.add(seat);

  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 6, 12), toon({ color: 0x222222 }));
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(-hw * 0.15, hh * 0.35, depth * 0.22);
  g.add(wheel);

  for (const sx of [-1, 1]) {
    const post = box(0.1, hh * 0.95, 0.1, trim);
    post.position.set(sx * hw * 0.42, hh * 0.45, -depth * 0.28);
    g.add(post);
    const rail = box(hw * 0.55, 0.08, 0.08, trim);
    rail.position.set(0, hh * 0.92, -depth * 0.28);
    g.add(rail);
  }

  return g;
}

/** Mario-Kart-style rounded pod with cockpit cutout and side fenders. */
function kartPod(hw: number, hh: number, main: THREE.Material, trim: THREE.Material, stripe: number): THREE.Group {
  const g = new THREE.Group();
  const depth = 1.55;

  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(hh * 0.95, hw * 1.6, 8, 16), main);
  belly.rotation.z = Math.PI / 2;
  belly.scale.set(1, depth / (hh * 2), 1);
  belly.castShadow = true;
  g.add(belly);

  const roof = new THREE.Mesh(new THREE.SphereGeometry(hw * 0.72, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.1), trim);
  roof.position.set(0, hh * 0.35, 0);
  roof.scale.set(1, 0.55, depth / (hh * 2));
  roof.castShadow = true;
  g.add(roof);

  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(hw * 0.42, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    noOutline(toon({ color: 0x6ec8ff, transparent: true, opacity: 0.55 }))
  );
  cockpit.position.set(-hw * 0.08, hh * 0.55, 0);
  cockpit.scale.set(1, 0.7, 0.85);
  g.add(cockpit);

  for (const s of [-1, 1]) {
    const fender = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, hw * 0.55, 4, 8), trim);
    fender.rotation.z = Math.PI / 2;
    fender.position.set(hw * 0.15 * s, -hh * 0.35, s * (depth / 2 - 0.08));
    fender.castShadow = true;
    g.add(fender);
  }

  const band = box(hw * 1.85, 0.18, depth * 0.92, toon({ color: stripe }));
  band.position.y = hh * 0.05;
  g.add(band);

  return g;
}

function buildBody(v: PartVariant): THREE.Group {
  const g = new THREE.Group();
  const hw = v.stats.hw ?? 1.4;
  const hh = v.stats.hh ?? 0.7;
  const main = toon({ color: v.color });
  const trim = toon({ color: v.color2 });

  g.add(kartFrame(hw, hh, main, trim));

  switch (v.archetype) {
    case 'tub': {
      g.add(kartPod(hw, hh, main, trim, 0xffffff));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(hw * 0.55, 0.08, 8, 22), trim);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -hh * 0.15;
      g.add(ring);
      break;
    }
    case 'wedge': {
      const pod = kartPod(hw * 0.92, hh, main, trim, v.color2);
      pod.rotation.z = -0.08;
      g.add(pod);
      const nose = box(hw * 0.5, hh * 0.35, 1.2, trim);
      nose.position.set(hw * 0.95, -hh * 0.1, 0);
      nose.rotation.z = -0.35;
      g.add(nose);
      break;
    }
    case 'banana': {
      const curve = new THREE.Mesh(new THREE.TorusGeometry(hw * 0.85, hh * 0.55, 10, 24, Math.PI * 0.85), main);
      curve.rotation.y = Math.PI / 2;
      curve.rotation.z = 0.35;
      curve.castShadow = true;
      g.add(curve);
      const seat = box(hw * 0.9, hh * 0.35, 1.1, trim);
      seat.position.set(-hw * 0.2, hh * 0.1, 0);
      g.add(seat);
      break;
    }
    case 'barrel': {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(hh, hh * 0.92, hw * 1.9, 18), main);
      drum.rotation.z = Math.PI / 2;
      drum.castShadow = true;
      g.add(drum);
      for (const sx of [-1, 1]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(hh + 0.04, 0.07, 8, 20), trim);
        band.rotation.y = Math.PI / 2;
        band.position.x = sx * hw * 0.5;
        g.add(band);
      }
      const lid = box(hw * 0.5, 0.15, 1.35, toon({ color: 0xffffff }));
      lid.position.set(0, hh + 0.05, 0);
      g.add(lid);
      break;
    }
    case 'sofa': {
      const seat = box(hw * 1.85, hh * 0.55, 1.45, main);
      seat.position.y = -hh * 0.15;
      g.add(seat);
      const back = box(hw * 1.85, hh * 0.95, 0.35, trim);
      back.position.set(0, hh * 0.45, -0.55);
      g.add(back);
      for (const s of [-1, 1]) {
        const arm = box(0.32, hh * 0.75, 1.45, trim);
        arm.position.set(s * (hw - 0.2), hh * 0.15, 0);
        g.add(arm);
      }
      const cushion = box(hw * 1.5, 0.22, 1.1, toon({ color: v.color2 }));
      cushion.position.y = hh * 0.05;
      g.add(cushion);
      break;
    }
    default: {
      g.add(kartPod(hw, hh, main, trim, v.color2));
      for (const sx of [-1, 1]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.55, 8), trim);
        pipe.rotation.z = Math.PI / 2;
        pipe.position.set(sx * hw * 0.95, -hh * 0.05, sx * 0.55);
        g.add(pipe);
      }
    }
  }
  g.scale.setScalar(v.scale);
  return g;
}

function buildWheel(v: PartVariant): THREE.Group {
  const g = new THREE.Group();
  const r = v.stats.wheelRadius ?? 0.55;
  const tireMat = toon({ color: v.color });
  const hubMat = toon({ color: v.color2 });
  const tread = toon({ color: 0x1a1a1a });

  if (v.archetype === 'stone') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 0.55, 14), toon({ color: 0x8d8478 }));
    disc.rotation.y = Math.PI / 2;
    disc.castShadow = true;
    g.add(disc);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, r * 0.6, 10), hubMat);
    hub.rotation.y = Math.PI / 2;
    g.add(hub);
  } else if (v.archetype === 'spring') {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.16, 8, 18), toon({ color: 0xb7c0c8 }));
    coil.rotation.y = Math.PI / 2;
    coil.castShadow = true;
    g.add(coil);
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.38, 12, 24), tireMat);
    t.rotation.y = Math.PI / 2;
    t.castShadow = true;
    g.add(t);
  } else {
    const outer = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.42, 14, 28), tireMat);
    outer.castShadow = true;
    g.add(outer);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(r * 0.78, r * 0.12, 10, 24), tread);
    g.add(inner);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.38, r * 0.38, r * 0.22, 12), hubMat);
    cap.rotation.y = Math.PI / 2;
    g.add(cap);
    for (let i = 0; i < 5; i++) {
      const star = box(r * 0.55, 0.14, 0.12, toon({ color: 0xffffff }));
      star.rotation.z = (i / 5) * Math.PI * 2;
      g.add(star);
    }
  }
  g.rotation.y = Math.PI / 2;
  g.scale.setScalar(v.scale);
  return g;
}

function buildEngine(v: PartVariant): THREE.Group {
  const g = new THREE.Group();
  const main = toon({ color: v.color });
  const trim = toon({ color: v.color2 });

  switch (v.archetype) {
    case 'rocket': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 1.15, 14), main);
      body.rotation.z = Math.PI / 2;
      body.position.x = -0.55;
      g.add(body);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.55, 14), trim);
      cone.rotation.z = Math.PI / 2;
      cone.position.x = -1.25;
      g.add(cone);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.28, 0.65, 12),
        noOutline(toon({ color: 0xffb24a, emissive: 0xff7a1a }))
      );
      flame.rotation.z = -Math.PI / 2;
      flame.position.x = 0.15;
      g.add(flame);
      break;
    }
    case 'v8': {
      const block = box(0.85, 0.65, 1.05, main);
      block.position.x = -0.5;
      g.add(block);
      for (const sz of [-0.32, 0.32]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.75, 8), trim);
        pipe.position.set(-0.15, 0.5, sz);
        g.add(pipe);
      }
      break;
    }
    case 'fan': {
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 16), trim);
      cage.rotation.z = Math.PI / 2;
      cage.position.x = -0.45;
      g.add(cage);
      for (let i = 0; i < 4; i++) {
        const blade = box(0.45, 0.18, 0.06, main);
        blade.position.x = -0.45;
        blade.rotation.x = (i / 4) * Math.PI;
        g.add(blade);
      }
      break;
    }
    case 'blower': {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.65, 6, 12), main);
      body.rotation.z = Math.PI / 2;
      body.position.x = -0.55;
      g.add(body);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.45, 12), trim);
      nozzle.rotation.z = Math.PI / 2;
      nozzle.position.x = 0.05;
      g.add(nozzle);
      break;
    }
    case 'catapult': {
      const base = box(0.65, 0.22, 0.75, main);
      base.position.x = -0.45;
      g.add(base);
      const arm = box(0.75, 0.12, 0.12, trim);
      arm.position.set(-0.45, 0.35, 0);
      arm.rotation.z = 0.55;
      g.add(arm);
      break;
    }
    default: {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 8, 22), trim);
      ring.position.x = -0.55;
      g.add(ring);
      const critter = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), toon({ color: 0xd9a55b }));
      critter.position.set(-0.55, -0.12, 0);
      g.add(critter);
    }
  }
  g.scale.setScalar(v.scale);
  return g;
}

function buildNose(v: PartVariant): THREE.Group {
  const g = new THREE.Group();
  const main = toon({ color: v.color });
  const trim = toon({ color: v.color2 });

  const bumperBar = box(0.22, 0.55, 1.35, trim);
  bumperBar.position.set(0.35, -0.15, 0);
  g.add(bumperBar);

  switch (v.archetype) {
    case 'plow': {
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 16, 1, false, 0, Math.PI), main);
      blade.rotation.x = Math.PI / 2;
      blade.position.x = 0.55;
      blade.castShadow = true;
      g.add(blade);
      break;
    }
    case 'ram': {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.25, 12), toon({ color: 0x7a5230 }));
      log.rotation.z = Math.PI / 2;
      log.position.x = 0.7;
      log.castShadow = true;
      g.add(log);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 10), trim);
      cap.position.x = 1.35;
      g.add(cap);
      break;
    }
    case 'beak':
    case 'cone': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.35, 16), main);
      cone.rotation.z = -Math.PI / 2;
      cone.position.x = 0.75;
      cone.castShadow = true;
      g.add(cone);
      if (v.archetype === 'cone') {
        const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 8, 18), toon({ color: 0xffffff }));
        stripe.rotation.y = Math.PI / 2;
        stripe.position.x = 0.65;
        g.add(stripe);
      }
      break;
    }
    case 'noodle': {
      const noodle = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.95, 6, 12), main);
      noodle.rotation.z = Math.PI / 2;
      noodle.position.x = 0.7;
      g.add(noodle);
      break;
    }
    default: {
      const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.05, 6, 10), main);
      bar.rotation.x = Math.PI / 2;
      bar.position.x = 0.55;
      g.add(bar);
    }
  }
  g.scale.setScalar(v.scale);
  return g;
}

function buildTopper(v: PartVariant): THREE.Group {
  const g = new THREE.Group();
  const main = toon({ color: v.color });
  const trim = toon({ color: v.color2 });

  switch (v.archetype) {
    case 'fin': {
      const shape = new THREE.Shape();
      shape.moveTo(-0.55, 0);
      shape.lineTo(0.55, 0);
      shape.lineTo(-0.35, 1.15);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false });
      geo.translate(0, 0, -0.08);
      const fin = new THREE.Mesh(geo, main);
      fin.castShadow = true;
      g.add(fin);
      break;
    }
    case 'wing': {
      const plane = box(0.35, 0.12, 1.75, main);
      plane.position.y = 0.95;
      g.add(plane);
      for (const s of [-1, 1]) {
        const strut = box(0.1, 0.95, 0.1, trim);
        strut.position.set(0, 0.48, s * 0.55);
        g.add(strut);
      }
      break;
    }
    case 'umbrella': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.15, 8), trim);
      pole.position.y = 0.58;
      g.add(pole);
      const canopy = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.2),
        main
      );
      canopy.position.y = 1.1;
      canopy.castShadow = true;
      g.add(canopy);
      break;
    }
    case 'balloons': {
      for (let i = 0; i < 5; i++) {
        const c = i % 2 === 0 ? v.color : v.color2;
        const balloon = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 12), toon({ color: c }));
        balloon.scale.y = 1.25;
        const a = (i / 5) * Math.PI * 2;
        balloon.position.set(Math.cos(a) * 0.28, 1.25 + Math.sin(a) * 0.18, Math.sin(a) * 0.22);
        balloon.castShadow = true;
        g.add(balloon);
      }
      break;
    }
    case 'prophat': {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), main);
      cap.position.y = 0.38;
      g.add(cap);
      for (let i = 0; i < 3; i++) {
        const blade = box(0.55, 0.07, 0.16, trim);
        blade.position.y = 0.78;
        blade.rotation.y = (i / 3) * Math.PI * 2;
        g.add(blade);
      }
      break;
    }
    default: {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.25, 8), trim);
      pole.position.y = 0.65;
      g.add(pole);
      const cloth = box(0.65, 0.42, 0.05, main);
      cloth.position.set(0.35, 1.05, 0);
      g.add(cloth);
    }
  }
  g.scale.setScalar(v.scale);
  return g;
}
