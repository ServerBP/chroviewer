import { Group, Mesh, PlaneGeometry, Quaternion, Vector3, type MeshBasicMaterial } from 'three';

import { flyingScoresAt, type FlyingScore, type ReplayTimeline } from '../../../core/replay/replay-display';
import type { ReplayNoteEvent } from '../../../core/replay/types';
import { MAIN_ONLY_LAYER } from '../../mirror/planar-mirror';
import { flyingScoreBloomAlpha, flyingScoreMaterial } from './primitives';
import { acquireRichTextTexture, releaseRichTextTexture, type RichTextTexture } from './rich-text-texture';

/** A textured quad, reused between flying scores with the same bloom setting. */
interface TextQuad {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  bloomAlpha: number;
}

interface FlyingText {
  root: Group;
  quad?: TextQuad;
  texture?: RichTextTexture;
  indicator?: Mesh<PlaneGeometry, MeshBasicMaterial>;
  start: Vector3;
  target: Vector3;
  rotation: Quaternion;
  failure: boolean;
}

const flyingScoreFontSize = 0.26;
const flyingFailureFontSize = 0.46;
const quadGeometry = new PlaneGeometry(1, 1);
const indicatorGeometry = new PlaneGeometry(0.32, 0.04);

function hermite(from: number, to: number, fromSlope: number, toSlope: number, amount: number) {
  const squared = amount * amount;
  const cubed = squared * amount;
  return (
    (2 * cubed - 3 * squared + 1) * from +
    (cubed - 2 * squared + amount) * fromSlope +
    (-2 * cubed + 3 * squared) * to +
    (cubed - squared) * toSlope
  );
}

function flyingMovement(amount: number) {
  const split = 0.18576352;
  if (amount <= split) return hermite(0, 0.62048507, 3.3401878 * split, 1.5404444 * split, amount / split);
  const length = 1 - split;
  return hermite(0.62048507, 1, 1.5404444 * length, 0, (amount - split) / length);
}

function flyingFade(amount: number) {
  if (amount < 0.2) return 3 * (amount / 0.2) ** 2 - 2 * (amount / 0.2) ** 3;
  if (amount <= 0.40029904) return 1;
  const fade = (amount - 0.40029904) / (1 - 0.40029904);
  return 1 - (3 * fade ** 2 - 2 * fade ** 3);
}

function failureMovement(amount: number) {
  const split = 0.15881044;
  if (amount <= split) return hermite(0, 0.7196346, 4.5314064 * split, 1.0496378 * split, amount / split);
  const length = 1 - split;
  return hermite(0.7196346, 1, 1.0496378 * length, 0, (amount - split) / length);
}

function failureFade(amount: number) {
  const split = 0.15138501;
  if (amount <= split) return hermite(0, 1, 0, 0.024424182 * split, amount / split);
  const length = 1 - split;
  return Math.max(0, hermite(1, 0, 0.024424182 * length, 0, (amount - split) / length));
}

export class FlyingScoreHud {
  readonly root = new Group();

  private readonly flying = new Map<number, FlyingText>();
  private readonly activeIds = new Set<number>();
  private readonly quads: TextQuad[] = [];
  private readonly start = new Vector3();
  private readonly target = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly inverseRotation = new Quaternion();

  update(timeline: ReplayTimeline, time: number) {
    const active = flyingScoresAt(timeline, time, 0.7);
    this.activeIds.clear();
    for (const score of active) this.activeIds.add(score.id);
    for (const [id, flying] of this.flying) {
      if (this.activeIds.has(id)) continue;
      this.disposeFlyingText(flying);
      this.flying.delete(id);
    }
    for (const score of active) {
      const note = timeline.events[score.id]?.note;
      if (note === undefined) continue;
      let flying = this.flying.get(score.id);
      if (flying === undefined) {
        flying = this.createFlyingText(score, note, timeline);
        // Text drawing is over budget this frame; it appears on a following one.
        if (flying === undefined) continue;
        this.flying.set(score.id, flying);
        this.root.add(flying.root);
      }
      flying.root.position.lerpVectors(
        flying.start,
        flying.target,
        flying.failure ? failureMovement(score.age) : flyingMovement(score.age),
      );
      flying.root.quaternion.copy(flying.rotation);
      const opacity = (flying.failure ? failureFade(score.age) : flyingFade(score.age)) * score.opacity;
      if (flying.quad !== undefined) flying.quad.mesh.material.opacity = opacity;
      if (flying.indicator !== undefined) flying.indicator.material.opacity = opacity;
    }
  }

  clear() {
    for (const flying of this.flying.values()) this.disposeFlyingText(flying);
    this.flying.clear();
  }

  private takeQuad(bloomAlpha: number) {
    const index = this.quads.findIndex((quad) => quad.bloomAlpha === bloomAlpha);
    if (index !== -1) return this.quads.splice(index, 1)[0];
    const mesh = new Mesh(quadGeometry, flyingScoreMaterial(0xffffff, bloomAlpha));
    mesh.renderOrder = 1000;
    mesh.frustumCulled = false;
    mesh.layers.set(MAIN_ONLY_LAYER);
    return { mesh, bloomAlpha };
  }

  private createFlyingText(
    score: FlyingScore,
    note: ReplayNoteEvent,
    timeline: ReplayTimeline,
  ): FlyingText | undefined {
    const failure = score.kind !== 'score';
    const acquired = acquireRichTextTexture(
      score.display.text,
      score.display.color,
      failure ? flyingFailureFontSize : flyingScoreFontSize,
    );
    if (acquired === 'deferred') return undefined;
    const texture = acquired ?? undefined;
    const root = new Group();
    const bloomAlpha = failure || score.display.vanilla ? flyingScoreBloomAlpha : 0;
    let quad: TextQuad | undefined;
    if (texture !== undefined) {
      quad = this.takeQuad(bloomAlpha);
      if (quad !== undefined) {
        quad.mesh.material.map = texture.texture;
        quad.mesh.scale.set(texture.width, texture.height, 1);
        root.add(quad.mesh);
      }
    }
    const indicator = score.showCenterIndicator
      ? new Mesh(indicatorGeometry, flyingScoreMaterial(score.display.color))
      : undefined;
    if (indicator !== undefined) {
      indicator.position.set(0, -0.15, 0.01);
      indicator.renderOrder = 1001;
      indicator.layers.set(MAIN_ONLY_LAYER);
      root.add(indicator);
    }
    const parts = { root, quad, texture, indicator };

    const fixedPosition = timeline.hitScoreVisualizer?.fixedPosition;
    const start =
      fixedPosition === undefined
        ? this.start.set(note.cutPoint.x, note.cutPoint.y, -note.cutPoint.z).clone()
        : this.start.set(fixedPosition[0], fixedPosition[1], -fixedPosition[2]).clone();
    const rotation =
      note.worldRotation === undefined
        ? new Quaternion()
        : this.rotation
            .set(-note.worldRotation.x, -note.worldRotation.y, note.worldRotation.z, note.worldRotation.w)
            .clone();
    if (failure) {
      this.inverseRotation.copy(rotation).invert();
      if (note.eventType === 3) {
        if (note.notePosition === undefined) {
          this.start
            .set((note.noteId.lineIndex - 1.5) * 0.6, note.noteId.lineLayer * 0.6 + 0.85, 0)
            .applyQuaternion(rotation);
        } else {
          this.start
            .set(note.notePosition.x, note.notePosition.y, -note.notePosition.z)
            .applyQuaternion(this.inverseRotation);
          this.start.z = 0;
          this.start.applyQuaternion(rotation);
        }
      }
      const failureStart =
        note.eventType === 3
          ? this.start.clone()
          : this.start.set(note.cutPoint.x, note.cutPoint.y, -note.cutPoint.z).clone();
      const local = this.target.copy(failureStart).applyQuaternion(this.inverseRotation);
      const target = this.target
        .set(local.x < 0 ? -2 : 2, 1.3, -15)
        .applyQuaternion(rotation)
        .clone();
      return { ...parts, start: failureStart, target, rotation, failure };
    }
    if (fixedPosition !== undefined) return { ...parts, start, target: start.clone(), rotation, failure };
    this.inverseRotation.copy(rotation).invert();
    const local = this.target.copy(start).applyQuaternion(this.inverseRotation);
    local.z = 0;
    local.y = -0.24;
    local.z -= 7.55;
    const target = local.applyQuaternion(rotation).clone();
    const offset = timeline.hitScoreVisualizer?.targetPositionOffset;
    if (offset !== undefined) target.add(this.start.set(offset[0], offset[1], -offset[2]));
    return { ...parts, start, target, rotation, failure };
  }

  private disposeFlyingText(flying: FlyingText) {
    this.root.remove(flying.root);
    if (flying.quad !== undefined) {
      flying.root.remove(flying.quad.mesh);
      flying.quad.mesh.material.map = null;
      this.quads.push(flying.quad);
    }
    if (flying.texture !== undefined) releaseRichTextTexture(flying.texture);
    flying.indicator?.material.dispose();
  }
}
