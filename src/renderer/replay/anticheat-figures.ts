import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';

import type { Rgb } from '../../core/colors';
import { bladeOf } from '../../core/replay/note-hitbox';
import { sampleReplayFrames } from '../../core/replay/sampling';
import type { Replay, ReplayTransform } from '../../core/replay/types';
import { mainViewOnly, withoutBloom } from './overlay-material';

/** A player drawn as markers: the headset a dot with its axes, each saber its hilt and the trail of its tip */
export interface Figure {
  replay: Replay;
  color: Rgb;
}

/** Seconds of tip trail behind the current moment */
const TRAIL_SECONDS = 0.45;
const TRAIL_POINTS = 512;
const AXIS_LENGTH = 0.16;

interface Hand {
  hilt: Mesh;
  tip: Mesh;
  trail: Line;
  dots: Points;
  positions: BufferAttribute;
}

interface FigureEntry {
  figure: Figure;
  root: Group;
  head: Group;
  hands: [Hand, Hand];
  hidden: boolean;
}

const bottom = new Vector3();
const top = new Vector3();

function place(target: Group | Mesh, transform: ReplayTransform) {
  target.position.set(transform.position.x, transform.position.y, -transform.position.z);
  target.quaternion
    .set(-transform.rotation.x, -transform.rotation.y, transform.rotation.z, transform.rotation.w)
    .normalize();
}

/**
 * Players as plain markers, so several of them can be told apart and compared at a glance: the head as a dot with its
 * right (red), up (green) and forward (blue) axes as Unity draws them, and each saber as a dot at the hilt and the path of
 * its tip over the last moment, all in the player's colour.
 */
export class AnticheatFigures {
  readonly root = new Group();
  private entries: FigureEntry[] = [];
  private readonly materials: Material[] = [];
  private readonly headGeometry = new SphereGeometry(0.045, 16, 12);
  private readonly hiltGeometry = new SphereGeometry(0.022, 12, 8);
  private readonly tipGeometry = new SphereGeometry(0.014, 10, 6);
  private readonly axisGeometries = [
    new BoxGeometry(AXIS_LENGTH, 0.008, 0.008).translate(AXIS_LENGTH / 2, 0, 0),
    new BoxGeometry(0.008, AXIS_LENGTH, 0.008).translate(0, AXIS_LENGTH / 2, 0),
    // Unity's forward is +z, this viewer's −z
    new BoxGeometry(0.008, 0.008, AXIS_LENGTH).translate(0, 0, -AXIS_LENGTH / 2),
  ];
  private readonly axisMaterials = [0xff3b3b, 0x3bdc4a, 0x3b8bff].map((color) =>
    withoutBloom(new MeshBasicMaterial({ color, toneMapped: false, depthTest: true })),
  );

  constructor() {
    this.root.name = 'anticheat-figures';
    this.root.visible = false;
  }

  setFigures(figures: Figure[]) {
    this.clearFigures();
    for (const figure of figures) {
      const color = new Color(...figure.color);
      const surface = withoutBloom(new MeshBasicMaterial({ color, toneMapped: false }));
      const lineMaterial = withoutBloom(new LineBasicMaterial({ color, toneMapped: false, opacity: 0.9 }));
      const dotMaterial = withoutBloom(
        new PointsMaterial({ color, size: 0.012, sizeAttenuation: true, toneMapped: false }),
      );
      this.materials.push(surface, lineMaterial, dotMaterial);
      const root = new Group();
      const head = new Group();
      head.add(new Mesh(this.headGeometry, surface));
      for (const [index, geometry] of this.axisGeometries.entries()) {
        head.add(new Mesh(geometry, this.axisMaterials[index]));
      }
      const hand = (): Hand => {
        const positions = new BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3);
        positions.setUsage(DynamicDrawUsage);
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', positions);
        geometry.setDrawRange(0, 0);
        const trail = new Line(geometry, lineMaterial);
        const dots = new Points(geometry, dotMaterial);
        trail.frustumCulled = false;
        dots.frustumCulled = false;
        const hilt = new Mesh(this.hiltGeometry, surface);
        const tip = new Mesh(this.tipGeometry, surface);
        root.add(trail, dots, hilt, tip);
        return { hilt, tip, trail, dots, positions };
      };
      root.add(head);
      this.root.add(mainViewOnly(root));
      this.entries.push({ figure, root, head, hands: [hand(), hand()], hidden: false });
    }
  }

  setVisible(visible: boolean) {
    this.root.visible = visible;
  }

  setFigureHidden(index: number, hidden: boolean) {
    const entry = this.entries[index];
    if (entry !== undefined) entry.hidden = hidden;
  }

  update(time: number) {
    if (!this.root.visible) return;
    for (const entry of this.entries) {
      const frames = entry.figure.replay.poses;
      const sample = sampleReplayFrames(frames, time);
      entry.root.visible = sample !== null && !entry.hidden;
      if (sample === null || entry.hidden) continue;
      const current = sample.amount < 0.5 ? sample.from : sample.to;
      place(entry.head, current.head);
      for (const [index, hand] of entry.hands.entries()) {
        const key = index === 0 ? 'leftHand' : 'rightHand';
        bladeOf(current[key], bottom, top);
        hand.hilt.position.copy(bottom);
        hand.tip.position.copy(top);
        // The tip at every recorded frame of the last moment, oldest first
        let count = 0;
        const array = hand.positions.array as Float32Array;
        let first = frames.length;
        let low = 0;
        let high = frames.length - 1;
        while (low <= high) {
          const middle = (low + high) >> 1;
          if ((frames[middle]?.time ?? 0) < time - TRAIL_SECONDS) low = middle + 1;
          else {
            first = middle;
            high = middle - 1;
          }
        }
        for (let frame = first; frame < frames.length && count < TRAIL_POINTS; frame++) {
          const pose = frames[frame];
          if (pose === undefined || pose.time > time) break;
          bladeOf(pose[key], bottom, top);
          array[count * 3] = top.x;
          array[count * 3 + 1] = top.y;
          array[count * 3 + 2] = top.z;
          count++;
        }
        hand.positions.needsUpdate = true;
        hand.trail.geometry.setDrawRange(0, count);
      }
    }
  }

  private clearFigures() {
    for (const entry of this.entries) {
      this.root.remove(entry.root);
      for (const hand of entry.hands) hand.trail.geometry.dispose();
    }
    for (const surface of this.materials) surface.dispose();
    this.materials.length = 0;
    this.entries = [];
  }

  dispose() {
    this.clearFigures();
    for (const geometry of [this.headGeometry, this.hiltGeometry, this.tipGeometry, ...this.axisGeometries])
      geometry.dispose();
    for (const surface of this.axisMaterials) surface.dispose();
  }
}
