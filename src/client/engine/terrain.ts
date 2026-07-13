import * as THREE from 'three';
import { Rng } from './rng';
import { toon, noOutline } from './style';

export type Obstacle = {
  x: number;
  y: number;
  r: number;
  bite: number;
  group: THREE.Group;
};

export type TrackTheme = {
  skyTop: string;
  skyBottom: string;
  groundColor: number;
  groundColor2: number;
  accent: number;
};

const TRACK_WIDTH = 5.2;
/** Tube radius + center bump — physics wheels ride on this surface, not the spline center. */
export const TRACK_SURFACE_OFFSET = 0.15 + TRACK_WIDTH * 0.42;

/** Floating sky slide: physics profile in X-Y, visuals snake in Z with sky decor. */
export class Terrain {
  readonly group = new THREE.Group();
  readonly obstacles: Obstacle[] = [];
  readonly lipX: number;
  readonly startX: number;
  readonly startY: number;
  readonly theme: TrackTheme;

  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly zs: number[] = [];
  private readonly step: number;
  private readonly minX: number;

  constructor(scene: THREE.Scene, seed: number, theme: TrackTheme) {
    this.theme = theme;
    const rng = new Rng(seed);

    const lip = 60;
    this.lipX = lip;
    const cp: [number, number][] = [
      [-40, 18],
      [8, 18],
      [22, 14.5],
      [38, 6],
      [50, 1.2],
      [lip, 3.2],
      [lip + 14, -5],
      [lip + 36, -14],
      [lip + 70, -17.5],
      [150, -19],
      [240, -20.5],
      [360, -21.5],
      [520, -22],
    ];

    this.minX = cp[0]![0];
    const maxX = cp[cp.length - 1]![0];
    this.step = 0.55;
    const curve = new THREE.CatmullRomCurve3(
      cp.map(([x, y]) => new THREE.Vector3(x, y, 0)),
      false,
      'catmullrom',
      0.5
    );
    const samples = Math.ceil((maxX - this.minX) / this.step);
    const pts = curve.getSpacedPoints(samples * 2);
    for (let i = 0; i <= samples; i++) {
      const x = this.minX + i * this.step;
      this.xs.push(x);
      this.ys.push(sampleCurveY(pts, x));
      this.zs.push(Math.sin(x * 0.045) * 6 + Math.sin(x * 0.018) * 3.5);
    }

    this.startX = 2;
    this.startY = this.surfaceAt(this.startX);

    this.buildSkyTrack();
    this.buildStartPlatform(rng);
    this.scatterObstacles(rng, lip);
    this.addSkyDecor(rng, lip);

    scene.add(this.group);
  }

  heightAt(x: number): number {
    const fx = (x - this.minX) / this.step;
    const i = Math.floor(fx);
    if (i < 0) return this.ys[0]!;
    if (i >= this.xs.length - 1) return this.ys[this.ys.length - 1]!;
    const t = fx - i;
    return this.ys[i]! * (1 - t) + this.ys[i + 1]! * t;
  }

  /** Top of the rideable track deck (matches the tube mesh). */
  surfaceAt(x: number): number {
    return this.heightAt(x) + TRACK_SURFACE_OFFSET;
  }

  /** Slope angle at x (radians) for aligning the kart to the deck. */
  angleAt(x: number): number {
    const h = 0.8;
    const dy = this.surfaceAt(x + h) - this.surfaceAt(x - h);
    return Math.atan2(dy, h * 2);
  }

  zAt(x: number): number {
    const fx = (x - this.minX) / this.step;
    const i = Math.floor(fx);
    if (i < 0) return this.zs[0]!;
    if (i >= this.xs.length - 1) return this.zs[this.zs.length - 1]!;
    const t = fx - i;
    return this.zs[i]! * (1 - t) + this.zs[i + 1]! * t;
  }

  normalAt(x: number): { x: number; y: number } {
    const h = 1.0;
    const dy = this.surfaceAt(x + h) - this.surfaceAt(x - h);
    const dx = 2 * h;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  }

  private buildSkyTrack(): void {
    const centerPts: THREE.Vector3[] = [];
    for (let i = 0; i < this.xs.length; i++) {
      centerPts.push(new THREE.Vector3(this.xs[i]!, this.ys[i]! + 0.15, this.zs[i]!));
    }
    const path = new THREE.CatmullRomCurve3(centerPts);

    const railMat = toon({ color: this.theme.groundColor2 });
    const deckMat = toon({ color: this.theme.groundColor });

    const deck = new THREE.Mesh(
      new THREE.TubeGeometry(path, centerPts.length * 2, TRACK_WIDTH * 0.42, 8, false),
      deckMat
    );
    deck.receiveShadow = true;
    deck.castShadow = true;
    this.group.add(deck);

    const leftRail = new THREE.Mesh(
      new THREE.TubeGeometry(path, centerPts.length * 2, 0.22, 6, false),
      railMat
    );
    leftRail.position.y = 0.55;
    leftRail.position.z = -TRACK_WIDTH * 0.48;
    this.group.add(leftRail);

    const rightRail = leftRail.clone();
    rightRail.position.z = TRACK_WIDTH * 0.48;
    this.group.add(rightRail);

    const stripePts: THREE.Vector3[] = [];
    for (let i = 0; i < centerPts.length; i += 3) {
      stripePts.push(centerPts[i]!.clone().add(new THREE.Vector3(0, 0.42, 0)));
    }
    const stripeCurve = new THREE.CatmullRomCurve3(stripePts);
    const stripe = new THREE.Mesh(
      new THREE.TubeGeometry(stripeCurve, stripePts.length * 3, 0.18, 6, false),
      toon({ color: 0xffffff })
    );
    this.group.add(stripe);

    const lipMark = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.55, TRACK_WIDTH + 0.6),
      toon({ color: this.theme.accent, emissive: 0x331100 })
    );
    lipMark.position.set(this.lipX, this.surfaceAt(this.lipX) + 0.35, this.zAt(this.lipX));
    lipMark.rotation.z = 0.18;
    this.group.add(lipMark);

    for (let i = 8; i < this.xs.length; i += 14) {
      const x = this.xs[i]!;
      const y = this.ys[i]!;
      const z = this.zs[i]!;
      this.addChainSupport(x, y, z, rngOffset(i));
    }
  }

  private buildStartPlatform(rng: Rng): void {
    const sx = this.startX - 8;
    const sy = this.startY;
    const sz = this.zAt(sx);
    const pad = new THREE.Group();

    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(6.5, 7.2, 0.55, 24),
      toon({ color: this.theme.groundColor })
    );
    top.position.y = -0.2;
    top.receiveShadow = true;
    pad.add(top);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(6.8, 0.18, 8, 32),
      toon({ color: this.theme.accent })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.08;
    pad.add(rim);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.28, rng.range(9, 14), 8),
        toon({ color: 0xc8d4e8 })
      );
      pillar.position.set(Math.cos(a) * 5.5, -rng.range(5, 8), Math.sin(a) * 5.5);
      pad.add(pillar);
    }

    const rampPts = [
      new THREE.Vector3(sx, sy + 0.1, sz),
      new THREE.Vector3(this.startX - 2, this.startY + 0.08, this.zAt(this.startX - 2)),
      new THREE.Vector3(this.startX + 1, this.startY + 0.05, this.zAt(this.startX + 1)),
    ];
    const rampCurve = new THREE.CatmullRomCurve3(rampPts);
    const ramp = new THREE.Mesh(
      new THREE.TubeGeometry(rampCurve, 24, TRACK_WIDTH * 0.38, 6, false),
      toon({ color: this.theme.groundColor2 })
    );
    pad.add(ramp);

    pad.position.set(sx, sy, sz - 2);
    this.group.add(pad);
  }

  private addChainSupport(x: number, y: number, z: number, hang: number): void {
    const islandY = y + hang + rngOffset(x) * 4 + 18;
    const island = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.SphereGeometry(2.8, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.1),
      toon({ color: this.theme.groundColor2 })
    );
    top.scale.y = 0.45;
    island.add(top);
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), toon({ color: 0x8d7a6a }));
    rock.position.y = -1.8;
    island.add(rock);
    island.position.set(x + rngOffset(x) * 3, islandY, z + rngOffset(z) * 2);
    this.group.add(island);

    const chainCount = 3;
    for (let c = 0; c < chainCount; c++) {
      const ox = (c - 1) * 1.4;
      const links = 7;
      for (let l = 0; l < links; l++) {
        const t = l / links;
        const ly = THREE.MathUtils.lerp(y + 0.5, islandY - 1.2, t);
        const link = new THREE.Mesh(
          new THREE.TorusGeometry(0.14, 0.05, 6, 10),
          toon({ color: 0xb8c0c8 })
        );
        link.position.set(x + ox, ly, z);
        link.rotation.x = Math.PI / 2;
        this.group.add(link);
      }
    }
  }

  private scatterObstacles(rng: Rng, lip: number): void {
    const kinds = ['boulder', 'crate', 'hydrant', 'cone'] as const;
    let x = lip + rng.range(34, 50);
    const count = rng.int(5, 7);
    for (let i = 0; i < count; i++) {
      const kind = rng.pick(kinds);
      const r = kind === 'boulder' ? rng.range(1.0, 1.7) : rng.range(0.6, 1.0);
      const gy = this.surfaceAt(x);
      const gz = this.zAt(x);
      const group = this.buildObstacle(kind, r, rng);
      group.position.set(x, gy + r * 0.55, gz + rng.range(-1.2, 1.2));
      this.group.add(group);
      this.obstacles.push({
        x,
        y: gy + r * 0.55,
        r,
        bite: kind === 'boulder' ? 1.4 : kind === 'crate' ? 1.0 : 0.8,
        group,
      });
      x += rng.range(24, 42);
    }
  }

  private buildObstacle(kind: string, r: number, rng: Rng): THREE.Group {
    const g = new THREE.Group();
    if (kind === 'boulder') {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), toon({ color: 0x8b8276 }));
      rock.castShadow = true;
      g.add(rock);
    } else if (kind === 'crate') {
      const c = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, r * 1.6, r * 1.6), toon({ color: 0xb07a3c }));
      c.castShadow = true;
      g.add(c);
    } else if (kind === 'hydrant') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.7, r * 1.6, 12), toon({ color: 0xd83a30 }));
      body.position.y = r * 0.2;
      body.castShadow = true;
      g.add(body);
    } else {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.8, r * 1.8, 16), toon({ color: 0xf2772f }));
      cone.position.y = r * 0.4;
      cone.castShadow = true;
      g.add(cone);
    }
    void rng;
    return g;
  }

  private addSkyDecor(rng: Rng, lip: number): void {
    for (let i = 0; i < 14; i++) {
      const cloud = this.makeCloud(rng);
      cloud.position.set(
        this.minX + rng.range(-20, 560),
        rng.range(22, 48),
        rng.range(-40, 40)
      );
      cloud.scale.setScalar(rng.range(1.2, 2.8));
      this.group.add(cloud);
    }

    for (let i = 0; i < 8; i++) {
      const x = lip + 20 + i * rng.range(38, 58);
      const gy = this.heightAt(x);
      const gz = this.zAt(x);
      const arch = new THREE.Group();
      for (const s of [-1, 1]) {
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.28, 0.38, rng.range(5, 8), 8),
          toon({ color: this.theme.accent })
        );
        pillar.position.set(s * 2.8, gy + 3.5, gz);
        arch.add(pillar);
      }
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(6.2, 0.35, 0.35),
        toon({ color: this.theme.groundColor2 })
      );
      beam.position.set(0, gy + 7.2, gz);
      arch.add(beam);
      this.group.add(arch);
    }

    const treeColors = [0xef6fa0, 0x6fcadf, 0xf6cf3a, 0x8a6fe0, 0xff7a5c];
    for (let i = 0; i < 10; i++) {
      const x = lip + 25 + i * rng.range(32, 52);
      const gy = this.heightAt(x) + 8;
      const gz = this.zAt(x) + rng.range(-8, 8);
      const island = new THREE.Group();
      const top = new THREE.Mesh(
        new THREE.SphereGeometry(rng.range(2, 3.5), 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        toon({ color: this.theme.groundColor2 })
      );
      top.scale.y = 0.5;
      island.add(top);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 2.5, 8), toon({ color: 0x9c7b50 }));
      trunk.position.y = -1.5;
      island.add(trunk);
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(rng.range(1.2, 2), 14, 12),
        toon({ color: rng.pick(treeColors) })
      );
      ball.position.y = 1.2;
      island.add(ball);
      island.position.set(x, gy, gz);
      this.group.add(island);
    }

    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(rng.range(4, 7), 0.25, 8, 24),
        noOutline(toon({ color: this.theme.accent, transparent: true, opacity: 0.55 }))
      );
      ring.position.set(rng.range(80, 400), rng.range(28, 42), rng.range(-25, 25));
      ring.rotation.x = rng.range(0.4, 1.2);
      ring.rotation.y = rng.range(0, Math.PI);
      this.group.add(ring);
    }

    const fx = lip + 210;
    const fgy = this.heightAt(fx);
    const fgz = this.zAt(fx);
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 9, 8), toon({ color: 0xdedede }));
      pole.position.set(fx, fgy + 4.5, fgz + s * 2.5);
      this.group.add(pole);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.6, 5.2), toon({ color: this.theme.accent }));
    banner.position.set(fx, fgy + 8.5, fgz);
    this.group.add(banner);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4), toon({ color: 0xffffff }));
    flag.position.set(fx + 0.5, fgy + 8.8, fgz);
    this.group.add(flag);
  }

  private makeCloud(rng: Rng): THREE.Group {
    const g = new THREE.Group();
    const puff = toon({ color: 0xffffff, transparent: true, opacity: 0.92 });
    for (let i = 0; i < 5; i++) {
      const s = rng.range(1.2, 2.4);
      const m = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 10), puff);
      m.position.set(rng.range(-2, 2), rng.range(-0.5, 0.8), rng.range(-1.5, 1.5));
      g.add(m);
    }
    return g;
  }
}

function sampleCurveY(pts: THREE.Vector3[], x: number): number {
  let lo = 0;
  let hi = pts.length - 1;
  if (x <= pts[0]!.x) return pts[0]!.y;
  if (x >= pts[hi]!.x) return pts[hi]!.y;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.x < x) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  const t = (x - a.x) / (b.x - a.x || 1);
  return a.y * (1 - t) + b.y * t;
}

function rngOffset(v: number): number {
  return Math.sin(v * 12.9898) * 43758.5453 - Math.floor(Math.sin(v * 12.9898) * 43758.5453) - 0.5;
}
