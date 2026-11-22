import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three';

import type { Rgb } from '../../core/colors';
import type { AnticheatMark } from '../../core/replay/anticheat';
import {
  badCutBox,
  bladeOf,
  checkCut,
  cutAngleOnNote,
  fromReplay,
  goodCutBox,
  HUMAN_SCALE_NEEDED,
  type HitboxRules,
  type NoteBox,
  type SweepCheck,
} from '../../core/replay/note-hitbox';
import type { Replay, ReplayPose } from '../../core/replay/types';
import { mainViewOnly, withoutBloom } from './overlay-material';

/** One cut the reviewer is looking at: a note mark with its recorded cut, and the play's tolerance */
export interface InspectorFocus {
  mark: AnticheatMark;
  /** Degrees either side of the arrow the game accepts; null when the note takes any direction */
  tolerance: number | null;
  dot: boolean;
  /** Pro Mode and old dots change the note's boxes */
  rules: HitboxRules;
  color: Rgb;
  noteIndex: number;
  /** The note's box placement on the frame before the cut and on the cut's frame, in the player's space */
  poses: { previous: Matrix4 | null; cut: Matrix4 | null } | null;
}

/** What the scene shows about the focused cut, measured from the replay's own frames and the note as drawn */
export interface Inspection {
  /** The cut frame and the one before it (song seconds) */
  frames: [number, number] | null;
  /** The box around the blade's sweep against the note's good-cut box, the closer of its two placements */
  sweep: SweepCheck | null;
  /** Which placement the blade came closer to: the note on the frame before the cut, or on the cut's frame */
  closer: 'previous' | 'cut' | null;
  /** The cut's angle from the arrow on the note as drawn */
  angle: number | null;
  /** Speed of the blade's tip between the two frames (m/s) */
  tipSpeed: number | null;
}

const SHOW_AROUND = 0.75;

function material(color: Rgb, opacity: number) {
  return withoutBloom(
    new MeshBasicMaterial({
      color: new Color(...color),
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: false,
      side: DoubleSide,
      toneMapped: false,
    }),
  );
}

function bar(from: Vector3, to: Vector3, thickness: number, surface: MeshBasicMaterial) {
  const length = from.distanceTo(to);
  const mesh = new Mesh(new BoxGeometry(thickness, thickness, Math.max(length, 1e-4)), surface);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.lookAt(to);
  return mesh;
}

function quad(points: Vector3[], surface: MeshBasicMaterial) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(points.flatMap((point) => point.toArray())), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return new Mesh(geometry, surface);
}

function boxOutline(box: NoteBox, thickness: number, surface: MeshBasicMaterial) {
  const group = new Group();
  const [w, h, d] = box.size.map((value) => value / 2) as [number, number, number];
  const corner = (x: number, y: number, z: number) =>
    new Vector3(box.center[0] + x * w, box.center[1] + y * h, box.center[2] + z * d);
  const edges: [Vector3, Vector3][] = [];
  for (const y of [-1, 1]) for (const z of [-1, 1]) edges.push([corner(-1, y, z), corner(1, y, z)]);
  for (const x of [-1, 1]) for (const z of [-1, 1]) edges.push([corner(x, -1, z), corner(x, 1, z)]);
  for (const x of [-1, 1]) for (const y of [-1, 1]) edges.push([corner(x, y, -1), corner(x, y, 1)]);
  for (const [from, to] of edges) group.add(bar(from, to, thickness, surface));
  return group;
}

export function frameAround(poses: ReplayPose[], time: number) {
  if (poses.length < 2) return null;
  let low = 0;
  let high = poses.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if ((poses[middle]?.time ?? 0) <= time + 0.0005) low = middle;
    else high = middle;
  }
  const index = Math.max(1, low);
  const current = poses[index];
  const previous = poses[index - 1];
  return current === undefined || previous === undefined ? null : { previous, current };
}

const GREEN: Rgb = [0.3, 1, 0.45];
const RED: Rgb = [1, 0.25, 0.3];
const AMBER: Rgb = [1, 0.7, 0.15];
const WHITE: Rgb = [1, 1, 1];

/**
 * The focused cut drawn around its note: the game's good-cut and bad-cut boxes where the note was at the cut, the blade at
 * the cut frame and the frame before with the sweep between them, the recorded cut point, plane and saber direction, and
 * the arrow's tolerance with the cut's direction on the note's face.
 */
export class AnticheatInspector {
  readonly root = new Group();
  private focus: InspectorFocus | null = null;
  private readonly fixed = new Group();
  private readonly onNote = new Group();
  private readonly owned: { geometry: BufferGeometry; material: MeshBasicMaterial }[] = [];
  private result: Inspection = { frames: null, sweep: null, closer: null, angle: null, tipSpeed: null };
  private cutPose: Matrix4 | null = null;
  private blades: { previous: { bottom: Vector3; top: Vector3 }; current: { bottom: Vector3; top: Vector3 } } | null =
    null;
  private readonly inverse = new Matrix4();
  private readonly local = new Matrix4();
  private goodBox: Group | null = null;
  private goodMaterial: MeshBasicMaterial | null = null;
  private cutLine: Mesh | null = null;

  constructor() {
    this.root.name = 'anticheat-inspector';
    this.root.renderOrder = 12;
    this.root.add(this.fixed, this.onNote);
    this.onNote.matrixAutoUpdate = false;
    this.root.visible = false;
  }

  get inspection() {
    return this.result;
  }

  /** The point to look at: the recorded cut point, or the blade's tip at the cut when the cut has no values */
  get target(): Vector3 | null {
    const cut = this.focus?.mark.cut;
    if (cut?.recorded === true) return fromReplay(cut.cutPoint);
    return this.blades?.current.top.clone() ?? null;
  }

  private track<T extends Object3D>(object: T): T {
    mainViewOnly(object);
    object.traverse((child) => {
      if (child instanceof Mesh) {
        child.renderOrder = 12;
        this.owned.push({ geometry: child.geometry as BufferGeometry, material: child.material as MeshBasicMaterial });
      }
    });
    return object;
  }

  setFocus(focus: InspectorFocus | null, replay: Replay | null) {
    this.clear();
    this.focus = focus;
    const cut = focus?.mark.cut;
    if (focus === null || replay === null) return;
    const around = frameAround(replay.poses, focus.mark.time);
    if (around !== null) {
      const hand = focus.mark.hand === 0 ? 'leftHand' : 'rightHand';
      const previous = bladeOf(around.previous[hand]);
      const current = bladeOf(around.current[hand]);
      this.blades = { previous, current };
      const dt = around.current.time - around.previous.time;
      this.result = {
        frames: [around.previous.time, around.current.time],
        sweep: null,
        closer: null,
        angle: null,
        tipSpeed: dt > 0 ? previous.top.distanceTo(current.top) / dt : null,
      };
      const bladeColor = focus.color;
      this.fixed.add(
        this.track(bar(previous.bottom, previous.top, 0.008, material(bladeColor, 0.45))),
        this.track(bar(current.bottom, current.top, 0.012, material(bladeColor, 0.95))),
        this.track(quad([previous.bottom, previous.top, current.top, current.bottom], material(bladeColor, 0.18))),
      );
    }
    if (cut !== undefined && cut.recorded) {
      const point = fromReplay(cut.cutPoint);
      const normal = fromReplay(cut.cutNormal).normalize();
      const direction = fromReplay(cut.saberDirection).normalize();
      const dot = new Mesh(new SphereGeometry(0.025, 12, 8), material(WHITE, 0.95));
      dot.position.copy(point);
      // The cut plane holds the saber's direction; its normal is the recorded one
      const along = direction.clone();
      const across = new Vector3().crossVectors(normal, along).normalize();
      const corners = [
        point.clone().addScaledVector(along, -0.35).addScaledVector(across, -0.35),
        point.clone().addScaledVector(along, 0.35).addScaledVector(across, -0.35),
        point.clone().addScaledVector(along, 0.35).addScaledVector(across, 0.35),
        point.clone().addScaledVector(along, -0.35).addScaledVector(across, 0.35),
      ];
      this.fixed.add(
        this.track(dot),
        this.track(quad(corners, material(WHITE, 0.12))),
        this.track(bar(point, point.clone().addScaledVector(direction, 0.45), 0.012, material(WHITE, 0.9))),
      );
    }
    // Boxes and the tolerance on the note, placed with the note's matrix each frame
    this.goodMaterial = material(GREEN, 0.95);
    this.goodBox = this.track(
      boxOutline(goodCutBox(focus.dot ? 'dot' : 'arrow', focus.rules), 0.012, this.goodMaterial),
    );
    this.onNote.add(
      this.goodBox,
      this.track(boxOutline(badCutBox(focus.dot ? 'dot' : 'arrow', focus.rules), 0.008, material(WHITE, 0.6))),
    );
    // Where the note stood a frame earlier, faint: the game may test the cut against that box
    const previousPose = focus.poses?.previous ?? null;
    if (previousPose !== null) {
      const earlier = this.track(
        boxOutline(goodCutBox(focus.dot ? 'dot' : 'arrow', focus.rules), 0.006, material(GREEN, 0.4)),
      );
      earlier.matrixAutoUpdate = false;
      earlier.matrix.copy(previousPose);
      this.fixed.add(earlier);
    }
    if (focus.tolerance !== null && !focus.dot) {
      const tolerance = (focus.tolerance * Math.PI) / 180;
      const wedge = new Mesh(
        new CircleGeometry(0.45, 48, -Math.PI / 2 - tolerance, tolerance * 2),
        material(GREEN, 0.22),
      );
      wedge.position.z = 0.27;
      const arrow = bar(new Vector3(0, 0, 0.27), new Vector3(0, -0.45, 0.27), 0.01, material(GREEN, 0.9));
      this.onNote.add(this.track(wedge), this.track(arrow));
    }
    this.cutPose = focus.poses?.cut?.clone() ?? null;
    this.measure();
    this.root.visible = true;
  }

  /** Places the note's parts: travelling with the note before the cut, where it was cut from then on */
  update(time: number, notePose: { matrix: Matrix4; time: number } | null, parent: Object3D) {
    const focus = this.focus;
    if (focus === null) return;
    const near = Math.abs(time - focus.mark.time) <= SHOW_AROUND;
    this.root.visible = near;
    if (!near) return;
    parent.updateWorldMatrix(true, false);
    this.inverse.copy(parent.matrixWorld).invert();
    const placed =
      this.cutPose !== null && time >= focus.mark.time - 0.002
        ? this.cutPose
        : notePose === null
          ? null
          : this.local.multiplyMatrices(this.inverse, notePose.matrix);
    this.onNote.visible = placed !== null;
    if (placed !== null) {
      this.onNote.matrix.copy(placed);
      this.onNote.matrixWorldNeedsUpdate = true;
    }
  }

  private measure() {
    const focus = this.focus;
    const pose = this.cutPose ?? focus?.poses?.previous ?? null;
    if (focus === null || pose === null) return;
    const box = goodCutBox(focus.dot ? 'dot' : 'arrow', focus.rules);
    const blades = this.blades;
    const check = (placement: Matrix4 | null | undefined) =>
      placement === null || placement === undefined || blades === null
        ? null
        : checkCut(placement, box, blades.previous, blades.current).box;
    const atCut = check(this.cutPose);
    const before = check(focus.poses?.previous);
    const closer =
      atCut === null
        ? before === null
          ? null
          : 'previous'
        : before !== null && before.scaleNeeded < atCut.scaleNeeded
          ? 'previous'
          : 'cut';
    const sweep = closer === 'previous' ? before : atCut;
    const cut = focus.mark.cut;
    const angle = cut?.recorded === true ? cutAngleOnNote(pose, cut.saberDirection) : null;
    this.result = { ...this.result, sweep, closer, angle: angle?.degrees ?? null };
    this.goodMaterial?.color.setRGB(
      ...(sweep === null || sweep.hits ? GREEN : sweep.scaleNeeded <= HUMAN_SCALE_NEEDED ? AMBER : RED),
    );
    if (angle !== null && !focus.dot) {
      const tip = new Vector3(angle.direction.x, angle.direction.y, 0).multiplyScalar(0.5).setZ(0.28);
      const outside = focus.tolerance !== null && Math.abs(angle.degrees) > focus.tolerance;
      this.cutLine = this.track(bar(new Vector3(0, 0, 0.28), tip, 0.014, material(outside ? RED : WHITE, 0.95)));
      this.onNote.add(this.cutLine);
    }
  }

  clear() {
    for (const group of [this.fixed, this.onNote]) group.clear();
    for (const { geometry, material: surface } of this.owned) {
      geometry.dispose();
      surface.dispose();
    }
    this.owned.length = 0;
    this.focus = null;
    this.cutPose = null;
    this.blades = null;
    this.goodBox = null;
    this.goodMaterial = null;
    this.cutLine = null;
    this.result = { frames: null, sweep: null, closer: null, angle: null, tipSpeed: null };
    this.root.visible = false;
  }

  dispose() {
    this.clear();
  }
}
