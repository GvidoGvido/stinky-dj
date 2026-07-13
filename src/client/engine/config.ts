/** Shared tuning for Junkyard Jump, in world units (~metres). */

export const PHYS = {
  gravity: 24,
  /** Linear air drag while flying (per second). */
  airDrag: 0.16,
  /** Extra angular damping from aero parts (per second, scaled by aero stat). */
  angularDragBase: 0.6,
  /** Ground contact spring + damping (penalty solver). */
  contactK: 900,
  contactDamp: 26,
  /** Rolling resistance for wheels (small → rolls far). */
  rollResist: 0.7,
  /** Sliding friction for scraping body points (large → stops fast). */
  scrapeFriction: 1.5,
  /** Player air-steer angular acceleration (rad/s²). */
  steerAccel: 22,
  /** Lateral air nudge (m/s²) while flying. */
  airSteerForce: 38,
  /** Ground steering torque when wheels touch (rad/s²). */
  groundSteerTorque: 16,
  /** Impact normal speed above which parts take damage. */
  damageSpeed: 12,
  /** Damage scaling per (impactSpeed - damageSpeed). */
  damageScale: 0.7,
  /** A single impact above this speed can instantly shatter a weak part. */
  catastrophicSpeed: 26,
} as const;

export const TRACK = {
  /** Slide start height above the launch lip. */
  startHeight: 26,
  /** X where the slide's launch lip sits. */
  rampX: 60,
  /** Total ground definition length. */
  length: 520,
} as const;

export const LAUNCH = {
  /** Seconds to fully charge the launch meter. */
  chargeSeconds: 1.1,
  /** Min / max launch impulse (scaled by engine stat + charge). */
  minImpulse: 6,
  maxImpulse: 30,
} as const;

/** Cel-shade outline + scene tuning. */
export const SCENE = {
  outlineThickness: 0.004,
} as const;
