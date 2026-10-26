// Tunables of the technical character. Units: meters, seconds, radians.

/** Simulation rate. Server ticks (M3) reuse the same step so prediction matches authority. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const CHARACTER = {
  /**
   * Body is a rounded cylinder, not a capsule: a capsule's curved bottom meets step edges with a tilted normal
   * that Rapier treats as a steep slope, so auto-step never triggers (measured in M1, see ADR-0003).
   */
  halfHeight: 0.85,
  radius: 0.3,
  borderRadius: 0.05,
  /** Skin gap kept between the body and obstacles. */
  skin: 0.01,
  /** Stairs/curbs up to this height are climbed automatically. */
  maxStepHeight: 0.35,
  minStepWidth: 0.15,
  snapToGround: 0.3,
  maxSlopeClimb: (40 * Math.PI) / 180,
  minSlopeSlide: (45 * Math.PI) / 180,
  gravity: -9.81,
  terminalFallSpeed: -30,
  /** Below this height the character is considered lost and respawned. */
  killPlaneY: -20,
} as const;

/** Distance from feet to body center. */
export const BODY_CENTER_Y = CHARACTER.halfHeight;

export const MOVEMENT = {
  walkSpeed: 2.2,
  runSpeed: 5.0,
  acceleration: 28,
  deceleration: 36,
  /** Max body turn rate while moving (rad/s). */
  turnRate: 12,
} as const;
