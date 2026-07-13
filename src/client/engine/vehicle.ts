import * as THREE from 'three';
import { PHYS } from './config';
import { buildPart, type PartVariant, type SlotId } from './parts';
import { toon, noOutline } from './style';
import type { Terrain } from './terrain';

export type Selection = Record<SlotId, PartVariant>;

export type VehicleSummary = {
  mass: number;
  power: number;
  grip: number;
  aero: number;
  sturdiness: number;
  balance: number;
  topHeavy: number;
};

export type VehicleTick = {
  impact: number;
  scraped: boolean;
  rolling: boolean;
  partLost: PartVariant | null;
  destroyed: boolean;
  hitObstacle: boolean;
};

type PartInstance = {
  slot: SlotId;
  variant: PartVariant;
  group: THREE.Group;
  mx: number;
  my: number;
  mass: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  core: boolean;
};

type ContactNode = {
  lx: number;
  ly: number;
  lz: number;
  radius: number;
  isWheel: boolean;
  roll: number;
  restitution: number;
  owner: PartInstance;
  wasTouching: boolean;
  wheelMesh?: THREE.Group;
};

type Debris = {
  group: THREE.Group;
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  t: number;
  bounces: number;
};

const TRACK_HALF = 1.05;
// When placing a vehicle “at rest” on the deck surface, we intentionally sink it a hair.
// This prevents strict contact equality from causing wheels to never register ground contact.
const CONTACT_SINK = 0.01;

function wheelContactRadius(wheel: PartVariant, radius: number): number {
  // Wheel visuals are often torus-based with a tube radius that exceeds the “wheelRadius” stat.
  // For a torus geometry (R, r_t), the mesh extents in Y are about (R + r_t).
  // The physics model uses this radius for both placement and contact solving.
  switch (wheel.archetype) {
    case 'stone':
      // Stone uses a cylinder with radius == wheelRadius.
      return radius;
    case 'spring':
      // Spring uses a secondary torus: TorusGeometry(r, r * 0.38, ...)
      // so visual extents are about R + 0.38R ~= 1.38R.
      return radius * 1.38;
    default:
      // Most tires use outer torus: TorusGeometry(r, r * 0.42, ...)
      // so visual extents are about R + 0.42R ~= 1.42R.
      return radius * 1.42;
  }
}

export class Vehicle {
  readonly group = new THREE.Group();
  private readonly frame = new THREE.Group();
  private readonly sockets = new THREE.Group();
  private readonly parts: PartInstance[] = [];
  private nodes: ContactNode[] = [];
  private readonly debris: Debris[] = [];
  private readonly scene: THREE.Scene;
  private highlightSlotId: SlotId | null = null;
  private highlightT = 0;

  private readonly bodyHW: number;
  private readonly bodyHH: number;

  x = 0;
  y = 0;
  worldZ = 0;
  vx = 0;
  vy = 0;
  angle = 0;
  omega = 0;

  private mass = 1;
  private inertia = 1;
  private comX = 0;
  private comY = 0;
  private aero = 0;
  private lift = 0;
  private power = 0.5;

  destroyed = false;
  private launched = false;
  private maxX = -Infinity;
  private stillT = 0;
  private wheelSpin = 0;

  private pendingWheel: {
    inst: PartInstance;
    axleX: number;
    axleY: number;
    axleZ: number;
    wr: number;
    contactR: number;
    mesh: THREE.Group;
  }[] = [];

  constructor(scene: THREE.Scene, selection: Selection) {
    this.scene = scene;
    this.group.add(this.frame);
    this.frame.add(this.sockets);
    scene.add(this.group);

    const body = selection.body;
    this.bodyHW = (body.stats.hw ?? 1.4) * body.scale;
    this.bodyHH = (body.stats.hh ?? 0.7) * body.scale;

    this.assemble(selection);
    this.recompute();
  }

  private assemble(sel: Selection): void {
    const hw = this.bodyHW;
    const hh = this.bodyHH;
    const wr = (sel.wheels.stats.wheelRadius ?? 0.55) * sel.wheels.scale;

    const add = (
      slot: SlotId,
      variant: PartVariant,
      group: THREE.Group,
      mountX: number,
      mountY: number,
      mountZ: number,
      massX: number,
      massY: number,
      core = false
    ): PartInstance => {
      group.position.set(mountX, mountY, mountZ);
      this.frame.add(group);
      this.addSocket(mountX, mountY, mountZ, slot);
      const inst: PartInstance = {
        slot,
        variant,
        group,
        mx: massX,
        my: massY,
        mass: variant.stats.mass,
        hp: variant.stats.durability,
        maxHp: variant.stats.durability,
        alive: true,
        core,
      };
      this.parts.push(inst);
      return inst;
    };

    add('body', sel.body, buildPart(sel.body), 0, 0, 0, 0, 0, true);
    add('engine', sel.engine, buildPart(sel.engine), -hw * 0.88, hh * 0.05, 0, -(hw + 0.5), hh * 0.05);
    add('nose', sel.nose, buildPart(sel.nose), hw * 0.95, hh * 0.02, 0, hw + 0.7, hh * 0.02);
    add('topper', sel.topper, buildPart(sel.topper), 0, hh * 1.05, 0, 0, hh + 0.85);

    const wheelPositions: [number, number][] = [
      [hw * 0.58, TRACK_HALF],
      [hw * 0.58, -TRACK_HALF],
      [-hw * 0.58, TRACK_HALF],
      [-hw * 0.58, -TRACK_HALF],
    ];
    for (const [ax, az] of wheelPositions) {
      const axleY = -hh + wr * 0.12;
      const wheelGroup = buildPart(sel.wheels);
      const inst = add('wheels', sel.wheels, wheelGroup, ax, axleY, az, ax, axleY - wr * 0.2);
      const contactR = wheelContactRadius(sel.wheels, wr);
      this.pendingWheel.push({ inst, axleX: ax, axleY, axleZ: az, wr, contactR, mesh: wheelGroup });
    }
  }

  private addSocket(x: number, y: number, z: number, slot: SlotId): void {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.05, 8, 18),
      noOutline(toon({ color: 0xffe566, emissive: 0x554400, transparent: true, opacity: 0.85 }))
    );
    ring.position.set(x, y, z);
    ring.userData.slot = slot;
    this.sockets.add(ring);

    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), toon({ color: 0xc8d0d8 }));
    bolt.position.set(x, y + 0.12, z);
    this.sockets.add(bolt);
  }

  highlightSlot(slot: SlotId | null): void {
    this.highlightSlotId = slot;
    this.applyHighlight(0);
  }

  tickHighlight(dt: number): void {
    if (!this.highlightSlotId) return;
    this.highlightT += dt;
    this.applyHighlight(this.highlightT);
  }

  private applyHighlight(t: number): void {
    const pulse = 0.35 + Math.sin(t * 6) * 0.25;
    for (const child of this.sockets.children) {
      const s = (child.userData.slot as SlotId | undefined) ?? null;
      const mat = (child as THREE.Mesh).material as THREE.MeshToonMaterial;
      if (!mat?.emissive) continue;
      if (s === this.highlightSlotId) {
        mat.emissive.setHex(0xffcc22);
        child.scale.setScalar(1 + pulse * 0.15);
      } else {
        mat.emissive.setHex(0x332200);
        child.scale.setScalar(1);
      }
    }
    for (const p of this.parts) {
      const on = p.slot === this.highlightSlotId && p.alive;
      p.group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const m = obj.material as THREE.MeshToonMaterial;
        if (!m?.emissive) return;
        m.emissive.setHex(on ? 0x446688 : 0x000000);
      });
    }
  }

  private recompute(): void {
    let M = 0;
    let cx = 0;
    let cy = 0;
    let aero = 0;
    let lift = 0;
    let power = 0.35;
    for (const p of this.parts) {
      if (!p.alive) continue;
      M += p.mass;
      cx += p.mass * p.mx;
      cy += p.mass * p.my;
      aero += p.variant.stats.aero ?? 0;
      lift = Math.max(lift, p.variant.stats.lift ?? 0);
      if (p.slot === 'engine') power = p.variant.stats.power ?? power;
    }
    M = Math.max(0.5, M);
    this.mass = M;
    this.comX = cx / M;
    this.comY = cy / M;
    this.aero = Math.min(1, aero);
    this.lift = lift;
    this.power = power;

    let I = 0.5;
    for (const p of this.parts) {
      if (!p.alive) continue;
      const dx = p.mx - this.comX;
      const dy = p.my - this.comY;
      I += p.mass * (dx * dx + dy * dy + 0.25);
    }
    this.inertia = Math.max(1.5, I);

    const nodes: ContactNode[] = [];
    for (const w of this.pendingWheel) {
      if (!w.inst.alive) continue;
      nodes.push({
        lx: w.axleX,
        ly: w.axleY,
        lz: w.axleZ,
        radius: w.contactR,
        isWheel: true,
        roll: w.inst.variant.stats.roll ?? 0.8,
        restitution: w.inst.variant.stats.restitution ?? 0.2,
        owner: w.inst,
        wasTouching: false,
        wheelMesh: w.mesh,
      });
    }
    const body = this.parts.find((p) => p.core)!;
    const hw = this.bodyHW;
    const hh = this.bodyHH;
    for (const [lx, ly, lz] of [
      [hw, -hh, TRACK_HALF],
      [hw, -hh, -TRACK_HALF],
      [-hw, -hh, TRACK_HALF],
      [-hw, -hh, -TRACK_HALF],
    ] as const) {
      nodes.push({ lx, ly, lz, radius: 0.08, isWheel: false, roll: 0, restitution: 0.08, owner: body, wasTouching: false });
    }
    const nose = this.parts.find((p) => p.slot === 'nose' && p.alive);
    if (nose) nodes.push({ lx: hw + 0.85, ly: hh * 0.05, lz: 0, radius: 0.22, isWheel: false, roll: 0, restitution: 0.12, owner: nose, wasTouching: false });
    const eng = this.parts.find((p) => p.slot === 'engine' && p.alive);
    if (eng) nodes.push({ lx: -(hw + 0.75), ly: hh * 0.05, lz: 0, radius: 0.22, isWheel: false, roll: 0, restitution: 0.12, owner: eng, wasTouching: false });
    this.nodes = nodes;
  }

  summary(): VehicleSummary {
    const grip =
      this.pendingWheel.reduce((a, w) => a + (w.inst.variant.stats.roll ?? 0), 0) /
      Math.max(1, this.pendingWheel.length);
    const sturdiness =
      this.parts.reduce((a, p) => a + p.maxHp, 0) / (this.parts.length * 70);
    const balance = 1 - THREE.MathUtils.clamp(Math.abs(this.comX) / Math.max(0.6, this.bodyHW), 0, 1);
    const topHeavy = THREE.MathUtils.clamp((this.comY + this.bodyHH) / (this.bodyHH * 2 + 1.4), 0, 1);
    return {
      mass: this.mass,
      power: this.power,
      grip,
      aero: this.aero,
      sturdiness: THREE.MathUtils.clamp(sturdiness, 0, 1),
      balance,
      topHeavy,
    };
  }

  placeAt(x: number, surfaceY: number, surfaceAngle = 0): void {
    this.x = x;
    // Sink a hair so initial “exactly touching” frames still count as contact.
    this.y = surfaceY + this.restDrop() - CONTACT_SINK;
    this.angle = surfaceAngle;
    this.vx = this.vy = this.omega = 0;
    this.maxX = x;
    this.syncMesh();
  }

  private restDrop(): number {
    let lowest = -this.bodyHH;
    for (const w of this.pendingWheel) {
      if (w.inst.alive) lowest = Math.min(lowest, w.axleY - w.contactR);
    }
    return -lowest;
  }

  launch(impulse: number): void {
    this.launched = true;
    this.sockets.visible = false;
    this.vx += impulse * (0.6 + this.power * 0.7);
    this.vy += 2.5 + this.power * 1.5;
  }

  get isLaunched(): boolean {
    return this.launched;
  }
  get distance(): number {
    return this.maxX;
  }

  update(dt: number, terrain: Terrain, steer: number): VehicleTick {
    const tick: VehicleTick = {
      impact: 0,
      scraped: false,
      rolling: false,
      partLost: null,
      destroyed: false,
      hitObstacle: false,
    };
    this.tickHighlight(dt);
    this.animateDebris(dt, terrain);
    if (this.destroyed) {
      this.syncMesh();
      return tick;
    }

    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const gEff = PHYS.gravity * (1 - this.lift * 0.7);

    let Fx = 0;
    let Fy = -this.mass * gEff;
    const rcx = c * this.comX - s * this.comY;
    let T = rcx * (-this.mass * gEff);

    let anyContact = false;
    let wheelContacts = 0;

    for (const node of this.nodes) {
      const rx = c * node.lx - s * node.ly;
      const ry = s * node.lx + c * node.ly;
      const px = this.x + rx;
      const py = this.y + ry;

      const vpx = this.vx - this.omega * ry;
      const vpy = this.vy + this.omega * rx;

      const surface = terrain.surfaceAt(px);
      const dist = py - surface;
      const touching = dist <= node.radius;

      if (touching) {
        anyContact = true;
        if (node.isWheel) wheelContacts++;
        const n = terrain.normalAt(px);
        const pen = node.radius - dist;
        const vn = vpx * n.x + vpy * n.y;
        const damp = PHYS.contactDamp * (1 - node.restitution * 0.7);
        let fnMag = PHYS.contactK * pen - damp * vn;
        if (fnMag < 0) fnMag = 0;
        Fx += n.x * fnMag;
        Fy += n.y * fnMag;
        T += rx * (n.y * fnMag) - ry * (n.x * fnMag);

        const tx = -n.y;
        const ty = n.x;
        const vt = vpx * tx + vpy * ty;
        let ft: number;
        if (node.isWheel) {
          ft = -(PHYS.rollResist * (1 - node.roll)) * vt;
          this.wheelSpin += (vt / Math.max(0.2, node.radius)) * dt;
          if (Math.abs(vt) > 1) tick.rolling = true;
        } else {
          ft = -Math.sign(vt) * PHYS.scrapeFriction * fnMag;
          if (Math.abs(vt) > 1.5) tick.scraped = true;
        }
        Fx += tx * ft;
        Fy += ty * ft;
        T += rx * (ty * ft) - ry * (tx * ft);

        if (!node.wasTouching && vn < -PHYS.damageSpeed * 0.35) {
          this.handleImpact(node, -vn, false, tick);
        }
      }

      if (!touching) {
        for (const obs of terrain.obstacles) {
          const dx = px - obs.x;
          const dy = py - obs.y;
          const sum = obs.r + node.radius;
          const d2 = dx * dx + dy * dy;
          if (d2 >= sum * sum) continue;
          anyContact = true;
          const d = Math.sqrt(d2) || 0.0001;
          const nx = dx / d;
          const ny = dy / d;
          const pen = sum - d;
          const vn = vpx * nx + vpy * ny;
          let fnMag = PHYS.contactK * pen - PHYS.contactDamp * vn;
          if (fnMag < 0) fnMag = 0;
          Fx += nx * fnMag;
          Fy += ny * fnMag;
          T += rx * (ny * fnMag) - ry * (nx * fnMag);
          if (vn < 0) {
            tick.hitObstacle = true;
            this.handleImpact(node, -vn, true, tick, obs.bite, nx, ny);
          }
        }
      }

      node.wasTouching = touching;
    }

    const ax = Fx / this.mass;
    const ay = Fy / this.mass;
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.omega += (T / this.inertia) * dt;

    if (wheelContacts >= 2) {
      const target = terrain.angleAt(this.x);
      this.angle += (target - this.angle) * Math.min(1, dt * 7);
    }

    if (Math.abs(steer) > 0.02) {
      if (!anyContact || wheelContacts === 0) {
        this.omega += steer * PHYS.steerAccel * dt;
        const perpX = -Math.sin(this.angle);
        const perpY = Math.cos(this.angle);
        this.vx += perpX * steer * PHYS.airSteerForce * dt;
        this.vy += perpY * steer * PHYS.airSteerForce * dt;
      } else {
        this.omega += steer * PHYS.groundSteerTorque * dt;
      }
    }

    if (!anyContact) {
      const angDrag = PHYS.angularDragBase * (0.25 + this.aero * 0.5);
      this.omega *= Math.max(0, 1 - angDrag * dt);
      const lin = PHYS.airDrag * (0.4 + this.aero * 0.4);
      this.vx *= Math.max(0, 1 - lin * dt);
      this.vy *= Math.max(0, 1 - lin * dt * 0.35);
    }

    this.omega = THREE.MathUtils.clamp(this.omega, -14, 14);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.omega * dt;

    if (this.x > this.maxX) this.maxX = this.x;

    const speed = Math.hypot(this.vx, this.vy);
    if (anyContact && speed < 0.7 && this.launched) {
      this.stillT += dt;
    } else {
      this.stillT = 0;
    }

    this.syncMesh();
    if (tick.partLost && tick.partLost.slot === 'body') {
      this.destroyed = true;
      tick.destroyed = true;
    }
    return tick;
  }

  get stopped(): boolean {
    return this.stillT > 1.1;
  }

  private handleImpact(
    node: ContactNode,
    approach: number,
    obstacle: boolean,
    tick: VehicleTick,
    bite = 1,
    nx = 0,
    ny = 1
  ): void {
    if (approach <= 0) return;
    if (approach > tick.impact) tick.impact = approach;
    const threshold = obstacle ? PHYS.damageSpeed * 0.55 : PHYS.damageSpeed;
    if (approach < threshold) return;

    const over = approach - threshold;
    let dmg = PHYS.damageScale * over * bite;
    if (obstacle) dmg += bite * approach * 0.35;
    if (approach > PHYS.catastrophicSpeed) dmg += node.owner.maxHp * 0.85;

    node.owner.hp -= dmg;
    if (node.owner.hp <= 0 && node.owner.alive) {
      this.detach(node.owner, tick, nx, ny, approach);
    }
  }

  private detach(part: PartInstance, tick: VehicleTick, nx: number, ny: number, impact: number): void {
    part.alive = false;
    tick.partLost = part.variant;

    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const wx = this.x + c * part.group.position.x - s * part.group.position.y;
    const wy = this.y + s * part.group.position.x + c * part.group.position.y;
    const wz = this.worldZ + part.group.position.z;
    const wAngle = this.angle;

    this.frame.remove(part.group);
    part.group.position.set(wx, wy, wz);
    part.group.rotation.set(0, 0, wAngle);
    this.scene.add(part.group);

    const pop = 0.4 + impact * 0.08;
    this.debris.push({
      group: part.group,
      vx: this.vx + nx * pop + (Math.random() - 0.5) * 3,
      vy: this.vy + ny * pop + 2 + Math.random() * 2,
      vz: (Math.random() - 0.5) * 4,
      spinX: (Math.random() - 0.5) * 8,
      spinY: (Math.random() - 0.5) * 10,
      spinZ: (Math.random() - 0.5) * 12 + this.omega * 0.5,
      t: 0,
      bounces: 0,
    });

    if (!part.core) this.recompute();
  }

  private animateDebris(dt: number, terrain: Terrain): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]!;
      d.t += dt;
      d.vy -= PHYS.gravity * dt;
      d.vx *= Math.max(0, 1 - dt * 0.35);
      d.vz *= Math.max(0, 1 - dt * 0.35);

      d.group.position.x += d.vx * dt;
      d.group.position.y += d.vy * dt;
      d.group.position.z += d.vz * dt;
      d.group.rotation.x += d.spinX * dt;
      d.group.rotation.y += d.spinY * dt;
      d.group.rotation.z += d.spinZ * dt;

      const gy = terrain.surfaceAt(d.group.position.x);
      if (d.group.position.y < gy + 0.15 && d.vy < 0 && d.bounces < 4) {
        d.group.position.y = gy + 0.15;
        d.vy = -d.vy * 0.42;
        d.vx *= 0.72;
        d.spinZ += (Math.random() - 0.5) * 6;
        d.bounces++;
      }

      if (d.t > 3.2) {
        const k = Math.max(0, 1 - (d.t - 3.2) * 1.2);
        d.group.scale.setScalar(k);
        if (k <= 0) {
          this.scene.remove(d.group);
          this.debris.splice(i, 1);
        }
      }
    }
  }

  private syncMesh(): void {
    this.group.position.set(this.x, this.y, this.worldZ);
    this.group.rotation.z = this.angle;
    for (const node of this.nodes) {
      if (node.wheelMesh) node.wheelMesh.rotation.x = -this.wheelSpin;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const d of this.debris) this.scene.remove(d.group);
    this.debris.length = 0;
  }
}
