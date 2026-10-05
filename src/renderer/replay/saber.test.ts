import { ShaderMaterial, Vector3 } from 'three';
import { describe, expect, test } from 'vite-plus/test';

import { DEFAULT_REPLAY_TRAIL_SETTINGS } from '../../core/viewer-settings';
import { createReplaySaberTrail, setReplaySaberTrailSettings, updateReplaySaberTrail } from './saber';

function point(x: number, y: number) {
  return new Vector3(x, y, 0);
}

function updateAt(trail: ReturnType<typeof createReplaySaberTrail>, x: number, y: number) {
  const tip = point(x, y);
  updateReplaySaberTrail(trail, tip, tip);
}

describe('replay saber trail smoothing', () => {
  test('is enabled by default and predicts curved points across large frame gaps', () => {
    const trail = createReplaySaberTrail(new ShaderMaterial(), {
      ...DEFAULT_REPLAY_TRAIL_SETTINGS,
      replayTrailSamples: 32,
    });

    updateAt(trail, 0, 0);
    updateAt(trail, 0.4, 0);
    updateAt(trail, 0.4, 0.4);

    expect(DEFAULT_REPLAY_TRAIL_SETTINGS.replayTrailSmoothing).toBe(true);
    expect(trail.samples).toHaveLength(9);
    expect(trail.samples.slice(5, 8).some((sample) => sample.tip.x > 0.4)).toBe(true);
    expect(trail.samples.at(-1)?.tip).toEqual(point(0.4, 0.4));
  });

  test('can be disabled without changing the recorded saber positions', () => {
    const trail = createReplaySaberTrail(new ShaderMaterial(), {
      ...DEFAULT_REPLAY_TRAIL_SETTINGS,
      replayTrailSamples: 32,
      replayTrailSmoothing: false,
    });

    updateAt(trail, 0, 0);
    updateAt(trail, 0.4, 0);
    updateAt(trail, 0.4, 0.4);

    expect(trail.samples.map((sample) => sample.tip)).toEqual([point(0, 0), point(0.4, 0), point(0.4, 0.4)]);
  });

  test('rebuilds the same source history when smoothing is toggled live', () => {
    const trail = createReplaySaberTrail(new ShaderMaterial(), {
      ...DEFAULT_REPLAY_TRAIL_SETTINGS,
      replayTrailSamples: 32,
    });
    updateAt(trail, 0, 0);
    updateAt(trail, 0.4, 0);
    updateAt(trail, 0.4, 0.4);

    setReplaySaberTrailSettings(trail, { ...trail.settings, replayTrailSmoothing: false });
    expect(trail.samples.map((sample) => sample.tip)).toEqual([point(0, 0), point(0.4, 0), point(0.4, 0.4)]);

    setReplaySaberTrailSettings(trail, { ...trail.settings, replayTrailSmoothing: true });
    expect(trail.samples).toHaveLength(9);
    expect(trail.sourceSamples).toHaveLength(3);
  });

  test('keeps the configured source history while bounding the expanded render buffer', () => {
    const trail = createReplaySaberTrail(new ShaderMaterial(), {
      ...DEFAULT_REPLAY_TRAIL_SETTINGS,
      replayTrailSamples: 6,
    });

    for (let index = 0; index < 10; index++) updateAt(trail, index, index % 2);

    expect(trail.sourceSamples).toHaveLength(6);
    expect(trail.samples.length).toBeLessThanOrEqual(30);
    expect(trail.samples.at(-1)?.tip).toEqual(point(9, 1));
  });
});
