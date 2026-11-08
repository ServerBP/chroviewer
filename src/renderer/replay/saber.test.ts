import { MeshBasicMaterial, ShaderMaterial, Vector3 } from 'three';
import { describe, expect, test } from 'vite-plus/test';

import { DEFAULT_REPLAY_SABER_SETTINGS, DEFAULT_REPLAY_TRAIL_SETTINGS } from '../../core/viewer-settings';
import {
  addReplaySaberTrailNode,
  clearReplaySaberTrail,
  createReplaySaber,
  createReplaySaberTrail,
  setReplaySaberSettings,
  setReplaySaberTrailMaterial,
  setReplaySaberTrailSettings,
  updateReplaySaberTrail,
} from './saber';

const point = (x: number, y: number) => new Vector3(x, y, 0);

function curvedTrail() {
  const trail = createReplaySaberTrail(new ShaderMaterial(), {
    ...DEFAULT_REPLAY_TRAIL_SETTINGS,
    saberTrailDuration: 0.3,
    replayTrailSamples: 32,
  });
  addReplaySaberTrailNode(trail, 0, point(0, 0), point(0, 1));
  addReplaySaberTrailNode(trail, 0.1, point(0.4, 0), point(0.4, 1));
  addReplaySaberTrailNode(trail, 0.2, point(0.4, 0.4), point(0.4, 1.4));
  updateReplaySaberTrail(trail, 0.3, point(0.4, 0.8), point(0.4, 1.8));
  return trail;
}

describe('replay saber trails', () => {
  test('keeps custom texture orientation from the live saber edge to the oldest edge', () => {
    const trail = curvedTrail();
    const uv = trail.mesh.geometry.getAttribute('trailUv');
    const last = uv.count - 2;
    expect([uv.getX(0), uv.getY(0), uv.getX(1), uv.getY(1)]).toEqual([0, 1, 0, 0]);
    expect([uv.getX(last), uv.getY(last), uv.getX(last + 1), uv.getY(last + 1)]).toEqual([1, 1, 1, 0]);
    expect(trail.mesh.geometry.getAttribute('trailAlpha').getX(0)).toBe(1);
    expect(trail.mesh.geometry.getAttribute('trailAlpha').getX(last)).toBe(0);
  });

  test('smooths curved frame gaps and can toggle back to linear sampling without losing history', () => {
    const trail = curvedTrail();
    const position = trail.mesh.geometry.getAttribute('position');
    expect(DEFAULT_REPLAY_TRAIL_SETTINGS.replayTrailSmoothing).toBe(true);
    expect(Array.from({ length: position.count }, (_, i) => position.getX(i)).some((x) => x > 0.4 + 1e-5)).toBe(true);

    setReplaySaberTrailSettings(trail, { ...trail.settings, replayTrailSmoothing: false });
    updateReplaySaberTrail(trail, 0.3, point(0.4, 0.8), point(0.4, 1.8));
    const linear = trail.mesh.geometry.getAttribute('position');
    expect(Array.from({ length: linear.count }, (_, i) => linear.getX(i)).every((x) => x <= 0.4 + 1e-5)).toBe(true);
    expect(trail.nodes).toHaveLength(3);

    setReplaySaberTrailSettings(trail, { ...trail.settings, replayTrailSmoothing: true });
    updateReplaySaberTrail(trail, 0.3, point(0.4, 0.8), point(0.4, 1.8));
    expect(trail.nodes).toHaveLength(3);
    expect(trail.mesh.geometry.getAttribute('position').count).toBe(320);
  });

  test('retains a duration of recorded poses and bounds render geometry independently of frame rate', () => {
    const trail = createReplaySaberTrail(new ShaderMaterial(), {
      ...DEFAULT_REPLAY_TRAIL_SETTINGS,
      replayTrailSamples: 6,
    });
    for (let index = 0; index < 1_000; index++) {
      const time = index / 100;
      addReplaySaberTrailNode(trail, time, point(index, 0), point(index, 1));
      updateReplaySaberTrail(trail, time + 0.001, point(index, 0), point(index, 1));
    }
    expect(trail.nodes.length).toBeLessThanOrEqual(31);
    expect(trail.nodes[0]?.time).toBeLessThanOrEqual(9.991 - trail.settings.saberTrailDuration);
    const position = trail.mesh.geometry.getAttribute('position');
    expect(position.count).toBe(60);
    expect(position.getX(0)).toBe(999);
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
  });

  test('handles duplicate timestamps, stationary sabers, and explicit trail clears', () => {
    const trail = curvedTrail();
    addReplaySaberTrailNode(trail, 0.2, point(1, 1), point(1, 2));
    expect(trail.nodes).toHaveLength(3);
    updateReplaySaberTrail(trail, 0.2, point(0.4, 0.4), point(0.4, 1.4));
    expect(Array.from(trail.mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
    clearReplaySaberTrail(trail);
    expect(trail.nodes).toHaveLength(0);
    expect(trail.mesh.geometry.drawRange.count).toBe(0);
  });

  test('preserves rectangular and thin trails and reapplies settings when custom materials load', () => {
    const trail = createReplaySaberTrail(new ShaderMaterial(), {
      ...DEFAULT_REPLAY_TRAIL_SETTINGS,
      replayTrailStyle: 'rectangle',
      replayTrailThinness: 0.5,
      replayTrailOpacity: 0.4,
      saberTrailBrightness: 1.5,
    });
    addReplaySaberTrailNode(trail, 0, point(0, 0), point(0, 2));
    updateReplaySaberTrail(trail, 0.1, point(1, 0), point(1, 2));
    const position = trail.mesh.geometry.getAttribute('position');
    expect(position.getY(0)).toBeCloseTo(0.5);
    expect(position.getY(1)).toBeCloseTo(1.5);
    const material = new ShaderMaterial({ uniforms: { _Brightness: { value: 0 }, _Duration: { value: 0 } } });
    setReplaySaberTrailMaterial(trail, material);
    expect(trail.mesh.material).toBe(material);
    expect(material.uniforms._Brightness?.value).toBeCloseTo(0.6);
    expect(material.uniforms._Duration?.value).toBe(DEFAULT_REPLAY_TRAIL_SETTINGS.saberTrailDuration);
    expect(trail.nodes).toHaveLength(1);
  });
});

test('combines upstream blade and hilt controls with the fork width and detailed hilt controls', () => {
  const material = new MeshBasicMaterial();
  const saber = createReplaySaber({ blade: material, core: material, metal: material, grip: material });
  setReplaySaberSettings(saber, {
    ...DEFAULT_REPLAY_SABER_SETTINGS,
    saberWidth: 2,
    saberBladeWidth: 1.5,
    saberTipWidth: 0.5,
    saberBladeThickness: DEFAULT_REPLAY_SABER_SETTINGS.saberBladeThickness * 2,
    saberGripLength: DEFAULT_REPLAY_SABER_SETTINGS.saberGripLength * 2,
  });
  expect(saber.root.scale.toArray()).toEqual([2, 2, 1]);
  expect(saber.blade.scale.x).toBeCloseTo(3);
  expect(saber.tipWidth).toBe(0.5);
  expect(saber.grip.scale.z).toBe(2);
  for (const geometry of saber.geometries) geometry.dispose();
  material.dispose();
});
