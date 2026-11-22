import { Matrix4, Quaternion, Vector3 } from 'three';

import type { AnticheatRules } from './anticheat';
import type { ReplayTransform } from './types';

// The note's colliders, from BeatLeader's measurements of the game's assets (the values its web replay viewer draws): the
// good-cut box is 0.8 wide and 1.0 deep, 0.5 high on arrows and 0.8 on dots (0.5 on dots before game 1.20, with Old Dots
// or in an OldDots mode), 0.2 high on chain links, and sits 0.25 m towards the player from the note's centre; the bad-cut
// box is a 0.4 m cube at the centre (0.35 × 0.1 × 0.35 on chain links); bombs are a 0.18 m sphere. A good cut needs the box
// around the blade's sweep since the last frame to overlap the good-cut box as the note stood on that frame or the one
// before (on people's replays 99.6% of good cuts do).
//
// For the modifiers BeatLeader's viewer draws Pro Mode as a 0.5 m cube and Small Notes at half size, but the game's own
// verdicts say otherwise for the good-cut box: on eight Pro Mode and Small Notes replays (games 1.24 to 1.37) a third to
// half of the cuts the game counted as good never touched those boxes, while all but a few percent touched the standard
// full-size box. So Small Notes only draws the note at half size, and Pro Mode keeps the good-cut box (its bad-cut box is
// BeatLeader's 0.5 m cube). Sizes are in the note's local space, in this viewer's axes (Unity's z flipped, so +z points
// from the note towards the player).

export interface NoteBox {
  /** Centre in the note's local space */
  center: [number, number, number];
  size: [number, number, number];
}

export type NoteShape = 'arrow' | 'dot' | 'chain';

/** What changes the note's boxes in a play */
export interface HitboxRules {
  proMode: boolean;
  /** Dots with the arrow's box: games before 1.20, the Old Dots modifier, OldDots modes */
  oldDots: boolean;
}

export const DEFAULT_HITBOX_RULES: HitboxRules = { proMode: false, oldDots: false };

export function goodCutBox(shape: NoteShape, rules: HitboxRules = DEFAULT_HITBOX_RULES): NoteBox {
  const height = shape === 'chain' ? 0.2 : shape === 'dot' && !rules.oldDots ? 0.8 : 0.5;
  return { center: [0, 0, 0.25], size: [0.8, height, 1] };
}

export function badCutBox(shape: NoteShape, rules: HitboxRules = DEFAULT_HITBOX_RULES): NoteBox {
  if (shape === 'chain') return { center: [0, 0, 0], size: [0.35, 0.1, 0.35] };
  if (rules.proMode) return { center: [0, 0, 0], size: [0.5, 0.5, 0.5] };
  return { center: [0, 0, 0], size: [0.4, 0.4, 0.4] };
}

export const ARROW_GOOD_CUT_BOX = goodCutBox('arrow');
export const DOT_GOOD_CUT_BOX = goodCutBox('dot');
export const BAD_CUT_BOX = badCutBox('arrow');
export const BOMB_RADIUS = 0.18;
/** The game's blade runs one metre from the saber's origin along its forward axis */
export const BLADE_LENGTH = 1;

/**
 * Degrees either side of the arrow the game accepts. Read from the game's own direction verdicts in replays: its check
 * passes up to 59.95° and fails from 61.16° normally, and passes up to 39.998° and fails from 40.054° with Strict Angles.
 */
export const DEFAULT_DIRECTION_TOLERANCE = 60;
export const STRICT_DIRECTION_TOLERANCE = 40;
/**
 * People's good cuts needed the box at most this much larger in the every-cut check: frames and tracking aren't exact.
 * 99% fit the box itself; the furthest needed 2.6 times its size without modifiers and 3.5 with Pro Mode.
 */
export const HUMAN_SCALE_NEEDED = 4;

export function hasModifier(modifiers: readonly string[] | undefined, code: string) {
  return modifiers?.includes(code) === true;
}

/** Degrees either side of the arrow the game accepts in this play */
export function directionTolerance(modifiers: readonly string[] | undefined, rules?: AnticheatRules | null) {
  if (rules !== null && rules !== undefined && Number.isFinite(rules.directionTolerance))
    return rules.directionTolerance;
  return hasModifier(modifiers, 'SA') ? STRICT_DIRECTION_TOLERANCE : DEFAULT_DIRECTION_TOLERANCE;
}

/** The scale the game draws every note at in this play; its boxes keep their size */
export function noteScale(modifiers: readonly string[] | undefined) {
  return hasModifier(modifiers, 'SC') ? 0.5 : 1;
}

/** The box rules of a play from its modifiers, mode and game version */
export function hitboxRules(modifiers: readonly string[] | undefined, mode = '', gameVersion = ''): HitboxRules {
  const minor = Number(/^\d+\.(\d+)/.exec(gameVersion)?.[1] ?? Number.NaN);
  return {
    proMode: hasModifier(modifiers, 'PM'),
    oldDots: hasModifier(modifiers, 'OD') || mode.includes('OldDots') || (Number.isFinite(minor) && minor < 20),
  };
}

const scratch = {
  inverse: new Matrix4(),
  boxMatrix: new Matrix4(),
  a: new Vector3(),
  b: new Vector3(),
  c: new Vector3(),
  d: new Vector3(),
  e: new Vector3(),
  quaternion: new Quaternion(),
  forward: new Vector3(),
};

/** A saber's blade at one frame: its bottom at the saber's origin and its top one metre along the saber */
export function bladeOf(transform: ReplayTransform, bottom = new Vector3(), top = new Vector3()) {
  bottom.set(transform.position.x, transform.position.y, -transform.position.z);
  scratch.quaternion.set(-transform.rotation.x, -transform.rotation.y, transform.rotation.z, transform.rotation.w);
  scratch.forward.set(0, 0, -BLADE_LENGTH).applyQuaternion(scratch.quaternion);
  top.copy(bottom).add(scratch.forward);
  return { bottom, top };
}

/** Converts a vector the replay stores (Unity axes) into this viewer's axes */
export function fromReplay([x, y, z]: readonly [number, number, number], target = new Vector3()) {
  return target.set(x, y, -z);
}

// Triangle against an axis-aligned box centred at the origin with half sizes `h` (separating axis test)
function triangleHitsBox(v0: Vector3, v1: Vector3, v2: Vector3, h: Vector3) {
  const e0 = new Vector3().subVectors(v1, v0);
  const e1 = new Vector3().subVectors(v2, v1);
  const e2 = new Vector3().subVectors(v0, v2);
  const axes: Vector3[] = [];
  for (const edge of [e0, e1, e2]) {
    axes.push(new Vector3(0, -edge.z, edge.y), new Vector3(edge.z, 0, -edge.x), new Vector3(-edge.y, edge.x, 0));
  }
  axes.push(new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3().crossVectors(e0, e1));
  for (const axis of axes) {
    if (axis.lengthSq() < 1e-12) continue;
    const p0 = v0.dot(axis);
    const p1 = v1.dot(axis);
    const p2 = v2.dot(axis);
    const r = h.x * Math.abs(axis.x) + h.y * Math.abs(axis.y) + h.z * Math.abs(axis.z);
    if (Math.max(p0, p1, p2) < -r || Math.min(p0, p1, p2) > r) return false;
  }
  return true;
}

export interface SweepCheck {
  /** The sweep crossed the box */
  hits: boolean;
  /**
   * How much the box would have to grow about its centre for the sweep to touch it: 1 or less when it touched the real box,
   * 1.5 when it needed a box half again as large. Infinity when even a box ten times as large wasn't touched.
   */
  scaleNeeded: number;
}

/**
 * Whether the blade's sweep from one frame to the next crossed a note's box. `noteMatrix` places the note (its world matrix
 * at the cut, including its scale); the blade positions are in the same space.
 */
export function checkSweep(
  noteMatrix: Matrix4,
  box: NoteBox,
  previous: { bottom: Vector3; top: Vector3 },
  current: { bottom: Vector3; top: Vector3 },
): SweepCheck {
  scratch.inverse.copy(noteMatrix).invert();
  const local = [previous.bottom, previous.top, current.top, current.bottom].map((point) =>
    point
      .clone()
      .applyMatrix4(scratch.inverse)
      .sub(new Vector3(...box.center)),
  );
  const [p0, p1, p2, p3] = local as [Vector3, Vector3, Vector3, Vector3];
  const half = new Vector3(...box.size).multiplyScalar(0.5);
  const touches = (scale: number) => {
    const h = half.clone().multiplyScalar(scale);
    return triangleHitsBox(p0, p1, p2, h) || triangleHitsBox(p0, p2, p3, h);
  };
  return search(touches);
}

// Oriented box against an axis-aligned box centred at the origin with half sizes `h` (separating axis test, 15 axes)
function orientedBoxHitsBox(
  center: Vector3,
  axes: [Vector3, Vector3, Vector3],
  extents: [number, number, number],
  h: Vector3,
) {
  const world = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  const candidates: Vector3[] = [...world, ...axes];
  for (const axis of axes) for (const base of world) candidates.push(new Vector3().crossVectors(axis, base));
  for (const axis of candidates) {
    if (axis.lengthSq() < 1e-10) continue;
    const aabb = h.x * Math.abs(axis.x) + h.y * Math.abs(axis.y) + h.z * Math.abs(axis.z);
    const obb = axes.reduce((sum, own, index) => sum + (extents[index] ?? 0) * Math.abs(own.dot(axis)), 0);
    if (Math.abs(center.dot(axis)) > aabb + obb) return false;
  }
  return true;
}

/**
 * The game finds the notes a blade cut with a box around the blade's sweep since the last frame (along the blade, along
 * the sweep and across it), not with the sweep itself; this is that box, in the space of the given points.
 */
export function sweepBox(previous: { bottom: Vector3; top: Vector3 }, current: { bottom: Vector3; top: Vector3 }) {
  const points = [previous.bottom, previous.top, current.top, current.bottom];
  const along = new Vector3().subVectors(current.top, current.bottom).normalize();
  const sweep = new Vector3()
    .addVectors(current.top, current.bottom)
    .sub(previous.top)
    .sub(previous.bottom)
    .multiplyScalar(0.5);
  sweep.addScaledVector(along, -sweep.dot(along));
  if (sweep.lengthSq() < 1e-10) sweep.set(along.y, -along.x, 0).add(new Vector3(0, along.z, -along.y));
  sweep.normalize();
  const across = new Vector3().crossVectors(along, sweep).normalize();
  const axes: [Vector3, Vector3, Vector3] = [along, sweep, across];
  const center = new Vector3();
  const extents: [number, number, number] = [0, 0, 0];
  for (const [index, axis] of axes.entries()) {
    const values = points.map((point) => point.dot(axis));
    const low = Math.min(...values);
    const high = Math.max(...values);
    center.addScaledVector(axis, (low + high) / 2);
    extents[index] = Math.max((high - low) / 2, 1e-4);
  }
  return { center, axes, extents };
}

export interface SweepChecks {
  /** The blade's sweep itself (two triangles between the frames) */
  sweep: SweepCheck;
  /** The box around the sweep, as the game looks for notes */
  box: SweepCheck;
}

/** Both tests of a cut against a note's box: the sweep itself, and the box around it the game uses */
export function checkCut(
  noteMatrix: Matrix4,
  box: NoteBox,
  previous: { bottom: Vector3; top: Vector3 },
  current: { bottom: Vector3; top: Vector3 },
): SweepChecks {
  const sweep = checkSweep(noteMatrix, box, previous, current);
  scratch.inverse.copy(noteMatrix).invert();
  const shift = new Vector3(...box.center);
  const local = (point: Vector3) => point.clone().applyMatrix4(scratch.inverse).sub(shift);
  const enclosing = sweepBox(
    { bottom: local(previous.bottom), top: local(previous.top) },
    { bottom: local(current.bottom), top: local(current.top) },
  );
  const half = new Vector3(...box.size).multiplyScalar(0.5);
  const touches = (scale: number) =>
    orientedBoxHitsBox(enclosing.center, enclosing.axes, enclosing.extents, half.clone().multiplyScalar(scale));
  return { sweep, box: search(touches) };
}

function search(touches: (scale: number) => boolean): SweepCheck {
  if (touches(1)) {
    let low = 0;
    let high = 1;
    for (let step = 0; step < 18; step++) {
      const middle = (low + high) / 2;
      if (touches(middle)) high = middle;
      else low = middle;
    }
    return { hits: true, scaleNeeded: high };
  }
  if (!touches(10)) return { hits: false, scaleNeeded: Number.POSITIVE_INFINITY };
  let low = 1;
  let high = 10;
  for (let step = 0; step < 22; step++) {
    const middle = (low + high) / 2;
    if (touches(middle)) high = middle;
    else low = middle;
  }
  return { hits: false, scaleNeeded: high };
}

/** The arrow's direction in the note's local plane: the arrow model points down its local −y */
export const ARROW_DIRECTION = new Vector3(0, -1, 0);

/**
 * The cut's direction in the note's face plane and its angle from the arrow, from the recorded saber direction (Unity axes)
 * and the note's world rotation at the cut. Positive angles turn counter-clockwise as seen from the player.
 */
export function cutAngleOnNote(noteMatrix: Matrix4, saberDirection: readonly [number, number, number]) {
  const direction = fromReplay(saberDirection, scratch.a);
  scratch.boxMatrix.extractRotation(noteMatrix).invert();
  const local = direction.applyMatrix4(scratch.boxMatrix);
  const inPlane = new Vector3(local.x, local.y, 0);
  if (inPlane.lengthSq() < 1e-9) return null;
  inPlane.normalize();
  const angle = Math.atan2(ARROW_DIRECTION.x * inPlane.y - ARROW_DIRECTION.y * inPlane.x, ARROW_DIRECTION.dot(inPlane));
  return { direction: inPlane, degrees: (angle * 180) / Math.PI };
}
