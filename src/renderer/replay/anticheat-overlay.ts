import {
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';

import type { Rgb } from '../../core/colors';
import { sampleReplayFrames } from '../../core/replay/sampling';
import type { Replay, ReplayTransform } from '../../core/replay/types';

/** Moves `target` to the pose between two frames, the way the replay's own sabers move */
export type SampleTransform = (target: Object3D, from: ReplayTransform, to: ReplayTransform, amount: number) => void;

/** A swing or turn-around the anticheat points at: the path of the saber tip over it, shown around its time */
export interface SwingPath {
  hand: 0 | 1;
  from: number;
  to: number;
  color: Rgb;
}

/** Another player's replay of the same map, drawn as plain sabers and a head next to the main player */
export interface Ghost {
  replay: Replay;
  color: Rgb;
}

const PATH_STEP = 1 / 120;
const PATH_LEAD = 0.6;
const PATH_RADIUS = 0.012;

function material(color: Rgb, opacity: number) {
  return new MeshBasicMaterial({ color: new Color(...color), transparent: true, opacity, depthWrite: false, toneMapped: false });
}

interface PathEntry {
  path: SwingPath;
  mesh: Mesh;
}

interface GhostEntry {
  ghost: Ghost;
  root: Group;
  head: Mesh;
  hands: [Object3D, Object3D];
  offsets: [Object3D, Object3D];
  blades: [Mesh, Mesh];
}

/**
 * What the anticheat adds to the replay: the saber tip's path over the swings and turn-arounds a finding points at, and in
 * a comparison the other players' sabers moving with the same song clock.
 */
export class AnticheatOverlay {
  readonly root = new Group();
  private paths: PathEntry[] = [];
  private ghosts: GhostEntry[] = [];
  private readonly scratchHand = new Object3D();
  private readonly matrix = new Matrix4();
  private readonly ghostHeadGeometry = new SphereGeometry(0.09, 16, 12);
  private readonly ghostBladeGeometry = new BoxGeometry(0.02, 0.02, 1);
  private bladeLength = 1;

  constructor(private readonly sample: SampleTransform) {
    this.root.name = 'anticheat-overlay';
  }

  /** Tip of a saber in the player's space at `time`: the hand's pose, the saber offset, then the tip along the blade */
  private tipAt(replay: Replay, time: number, hand: 0 | 1, offset: Object3D, tip: Vector3) {
    const frames = sampleReplayFrames(replay.poses, time);
    if (frames === null) return null;
    this.sample(this.scratchHand, hand === 0 ? frames.from.leftHand : frames.from.rightHand, hand === 0 ? frames.to.leftHand : frames.to.rightHand, frames.amount);
    this.scratchHand.updateMatrix();
    offset.updateMatrix();
    return tip.clone().applyMatrix4(this.matrix.multiplyMatrices(this.scratchHand.matrix, offset.matrix));
  }

  setPaths(paths: SwingPath[], replay: Replay | null, offsets: [Object3D, Object3D], tips: [Vector3, Vector3]) {
    this.clearPaths();
    if (replay === null) return;
    for (const path of paths) {
      const points: Vector3[] = [];
      for (let time = path.from; time <= path.to + 1e-6; time += PATH_STEP) {
        const point = this.tipAt(replay, time, path.hand, offsets[path.hand], tips[path.hand]);
        if (point !== null) points.push(point);
      }
      if (points.length < 2) continue;
      const curve = new CatmullRomCurve3(points);
      const mesh = new Mesh(new TubeGeometry(curve, Math.min(400, points.length * 2), PATH_RADIUS, 6, false), material(path.color, 0.9));
      mesh.renderOrder = 9;
      mesh.visible = false;
      this.root.add(mesh);
      this.paths.push({ path, mesh });
    }
  }

  setGhosts(ghosts: Ghost[], bladeLength: number) {
    this.clearGhosts();
    this.bladeLength = bladeLength;
    for (const ghost of ghosts) {
      const root = new Group();
      const headMaterial = material(ghost.color, 0.55);
      const bladeMaterial = material(ghost.color, 0.85);
      const head = new Mesh(this.ghostHeadGeometry, headMaterial);
      const hands: [Object3D, Object3D] = [new Object3D(), new Object3D()];
      const offsets: [Object3D, Object3D] = [new Object3D(), new Object3D()];
      const blades: [Mesh, Mesh] = [new Mesh(this.ghostBladeGeometry, bladeMaterial), new Mesh(this.ghostBladeGeometry, bladeMaterial)];
      for (let hand = 0; hand < 2; hand++) {
        const blade = blades[hand];
        const offset = offsets[hand];
        const holder = hands[hand];
        if (blade === undefined || offset === undefined || holder === undefined) continue;
        // The blade runs along -z from the hand, as the replay's own sabers do
        blade.scale.set(1, 1, bladeLength);
        blade.position.z = -bladeLength / 2;
        offset.add(blade);
        holder.add(offset);
        root.add(holder);
      }
      root.add(head);
      root.visible = false;
      this.root.add(root);
      this.ghosts.push({ ghost, root, head, hands, offsets, blades });
    }
  }

  get ghostCount() {
    return this.ghosts.length;
  }

  setGhostVisible(index: number, visible: boolean) {
    const entry = this.ghosts[index];
    if (entry !== undefined) entry.root.userData.hidden = !visible;
  }

  update(time: number, offsets: [Object3D, Object3D]) {
    for (const { path, mesh } of this.paths) mesh.visible = time >= path.from - PATH_LEAD && time <= path.to + PATH_LEAD;
    for (const entry of this.ghosts) {
      const frames = sampleReplayFrames(entry.ghost.replay.poses, time);
      entry.root.visible = frames !== null && entry.root.userData.hidden !== true;
      if (frames === null) continue;
      this.sample(entry.head, frames.from.head, frames.to.head, frames.amount);
      this.sample(entry.hands[0], frames.from.leftHand, frames.to.leftHand, frames.amount);
      this.sample(entry.hands[1], frames.from.rightHand, frames.to.rightHand, frames.amount);
      for (let hand = 0; hand < 2; hand++) {
        const source = offsets[hand];
        const target = entry.offsets[hand];
        if (source === undefined || target === undefined) continue;
        target.position.copy(source.position);
        target.quaternion.copy(source.quaternion);
      }
      for (const blade of entry.blades) {
        blade.scale.z = this.bladeLength;
        blade.position.z = -this.bladeLength / 2;
      }
    }
  }

  setBladeLength(length: number) {
    this.bladeLength = length;
  }

  private clearPaths() {
    for (const { mesh } of this.paths) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    this.paths = [];
  }

  private clearGhosts() {
    for (const entry of this.ghosts) {
      this.root.remove(entry.root);
      (entry.head.material as MeshBasicMaterial).dispose();
      (entry.blades[0].material as MeshBasicMaterial).dispose();
    }
    this.ghosts = [];
  }

  dispose() {
    this.clearPaths();
    this.clearGhosts();
    const geometries: BufferGeometry[] = [this.ghostHeadGeometry, this.ghostBladeGeometry];
    for (const geometry of geometries) geometry.dispose();
  }
}
