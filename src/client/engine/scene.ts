import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { SCENE } from './config';

const FOV = 64;

/** Cel-shaded renderer with Mario-Kart-style 3rd-person chase + garage orbit. */
export class SceneRig {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly outline: OutlineEffect;

  private keyLight!: THREE.DirectionalLight;
  private mode: 'build' | 'chase' = 'build';

  private camX = 0;
  private camY = 0;
  private camZ = 12;
  private lookX = 0;
  private lookY = 0;
  private lookZ = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 800);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearAlpha(0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    this.outline = new OutlineEffect(this.renderer, {
      defaultThickness: SCENE.outlineThickness,
      defaultColor: [0.04, 0.03, 0.06],
      defaultAlpha: 0.92,
      defaultKeepAlive: true,
    });

    this.addLights();
    this.resize();
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xdceeff, 0xffe8c8, 1.15));

    const key = new THREE.DirectionalLight(0xfff6e8, 1.65);
    this.keyLight = key;
    key.position.set(-12, 28, 18);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 160;
    const s = 32;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.00035;
    this.scene.add(key);
    this.scene.add(key.target);

    const rim = new THREE.DirectionalLight(0x88c4ff, 0.55);
    rim.position.set(16, 12, -14);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffaacc, 0.35);
    fill.position.set(0, 8, -20);
    this.scene.add(fill);
  }

  setSky(topHex: string, bottomHex: string): void {
    document.body.style.background = `linear-gradient(178deg, ${topHex} 0%, ${bottomHex} 55%, #f8c4ff 100%)`;
  }

  setBuildOrbit(time: number, targetY = 0): void {
    this.mode = 'build';
    const r = 10;
    const a = time * 0.5;
    this.camX = Math.sin(a) * r;
    this.camZ = Math.cos(a) * r + 2;
    this.camY = targetY + 3.2 + Math.sin(time * 1.2) * 0.35;
    this.lookX = 0;
    this.lookY = targetY + 0.35;
    this.lookZ = 0;
    this.applyImmediate();
  }

  /** Classic behind-the-kart chase: camera sits on +Z looking toward the kart. */
  followChase(x: number, y: number, z: number, angle: number, speed: number, dt: number): void {
    this.mode = 'chase';
    const fwdX = Math.cos(angle);
    const fwdY = Math.sin(angle);

    const back = THREE.MathUtils.lerp(13, 9.5, THREE.MathUtils.clamp(speed / 24, 0, 1));
    const up = THREE.MathUtils.lerp(3.2, 5.5, THREE.MathUtils.clamp(speed / 28, 0, 1));
    const camBackZ = 12;

    const tx = x - fwdX * back;
    const ty = y - fwdY * back + up;
    const tz = z + camBackZ;

    const lx = x + fwdX * 2.2;
    const ly = y + fwdY * 2.2 + 0.45;
    const lz = z;

    const k = 1 - Math.exp(-dt * 9);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    this.camZ += (tz - this.camZ) * k;
    this.lookX += (lx - this.lookX) * k;
    this.lookY += (ly - this.lookY) * k;
    this.lookZ += (lz - this.lookZ) * k;

    this.applyImmediate();
  }

  snapChase(x: number, y: number, z: number, angle: number): void {
    this.mode = 'chase';
    const fwdX = Math.cos(angle);
    const fwdY = Math.sin(angle);
    this.camX = x - fwdX * 12;
    this.camY = y - fwdY * 12 + 3.8;
    this.camZ = z + 12;
    this.lookX = x + fwdX * 2;
    this.lookY = y + fwdY * 2 + 0.4;
    this.lookZ = z;
    this.applyImmediate();
  }

  private applyImmediate(): void {
    this.camera.position.set(this.camX, this.camY, this.camZ);
    this.camera.lookAt(this.lookX, this.lookY, this.lookZ);
    this.keyLight.position.set(this.camX - 14, this.camY + 18, this.camZ + 10);
    this.keyLight.target.position.set(this.lookX, this.lookY, this.lookZ);
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
    this.renderer.setSize(w, h);
    if (this.mode === 'build') this.applyImmediate();
  }

  render(): void {
    this.outline.render(this.scene, this.camera);
  }
}
