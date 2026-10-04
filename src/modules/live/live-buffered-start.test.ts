import { create } from '@bufbuild/protobuf';
import { describe, expect, test, vi } from 'vite-plus/test';

import { createClock } from '../../core/clock/song-clock';
import type { ReplayPose } from '../../core/replay/types';
import { ReplayStreamStartSchema } from './generated/proto/scoresaber/live/v1/replay_stream_pb';
import { tickLivePlayback } from './live-playback';
import { createLiveReplay } from './live-replay';
import { createLiveRuntime, pruneLiveReplay, resetLiveStream } from './live-runtime';

vi.mock('lzma-web/dist/lzma.js', () => ({ LZMA: () => ({ decompress: vi.fn() }) }));

function fixture(source: 'ta' | 'scoresaber' = 'ta') {
  const runtime = createLiveRuntime({ source, playerId: 'player' });
  const replay = createLiveReplay(create(ReplayStreamStartSchema));
  runtime.replay = replay;
  const clock = createClock(180, 120, { now: () => 0 });
  const transform = { position: { x: 0, y: 1.7, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  const pose = (time: number): ReplayPose => ({
    time,
    fps: 144,
    head: transform,
    leftHand: transform,
    rightHand: transform,
  });
  return { runtime, replay, clock, pose };
}

describe('buffered group playback', () => {
  test('eight waiting streams keep a minute of 144 Hz poses, then prune behind their delayed playhead', () => {
    for (let player = 0; player < 8; player++) {
      const { runtime, replay, clock, pose } = fixture();
      runtime.compositorBufferSeconds = 60;
      for (let second = 0; second <= 60; second++) {
        for (let frame = 0; frame < 144; frame++) replay.poses.push(pose(second + frame / 144));
        runtime.latestFrameTime = replay.poses.at(-1)?.time ?? 0;
        pruneLiveReplay(runtime, runtime.latestFrameTime);
      }
      expect(replay.poses[0]?.time).toBe(0);
      expect(replay.poses.length).toBeGreaterThan(8_000);
      runtime.playbackClock = clock;
      clock.seek(30);
      runtime.latestFrameTime = 90;
      pruneLiveReplay(runtime, 90);
      expect(replay.poses[0]?.time).toBeGreaterThanOrEqual(14.98);
      expect(replay.poses[0]?.time).toBeLessThan(15);
      expect(replay.poses.some((frame) => frame.time === 30)).toBe(true);
    }
  });

  test('a minute of accelerated 240 Hz playback remains buffered in song time', () => {
    const { runtime, replay, pose } = fixture();
    runtime.compositorBufferSeconds = 60;
    runtime.playbackRate = 1.5;
    replay.poses = Array.from({ length: 60 * 240 }, (_, index) => pose((index / 240) * 1.5));
    runtime.latestFrameTime = 90;
    pruneLiveReplay(runtime, 90);
    expect(replay.poses[0]?.time).toBe(0);
    expect(replay.poses.length).toBe(60 * 240);
  });

  test('waiting history is bounded and ordinary playback keeps the original pose cap', () => {
    const { runtime, replay, pose } = fixture();
    runtime.compositorBufferSeconds = 60;
    replay.poses = Array.from({ length: 30_000 }, (_, index) => pose(index / 144));
    runtime.latestFrameTime = 30_000 / 144;
    pruneLiveReplay(runtime, runtime.latestFrameTime);
    expect(replay.poses.length).toBeLessThanOrEqual(80 * 240);
    runtime.compositorBufferSeconds = 0;
    pruneLiveReplay(runtime, runtime.latestFrameTime);
    expect(replay.poses.length).toBeLessThanOrEqual(1800);
    resetLiveStream(runtime);
    expect(runtime.compositorBufferSeconds).toBe(0);
    expect(runtime.compositorStartAligned).toBe(false);
  });

  test.each(['ta', 'scoresaber'] as const)(
    '%s preserves a coordinated start despite being 30 seconds behind the live edge',
    (source) => {
      const { runtime, replay, clock, pose } = fixture(source);
      replay.poses = [pose(0), pose(30)];
      runtime.latestFrameTime = 30;
      runtime.mapLoaded = true;
      runtime.playbackStarted = true;
      runtime.compositorStartAligned = true;
      runtime.compositorBufferSeconds = 30;
      runtime.playbackClock = clock;
      clock.play();
      const actions = { pause: vi.fn(), resume: vi.fn(() => true), seek: vi.fn(), updateStatus: vi.fn() };
      for (let tick = 0; tick < 300; tick++) {
        runtime.playbackAttemptPending = true;
        tickLivePlayback(runtime, clock, 'Standard:9', actions);
      }
      expect(actions.seek).not.toHaveBeenCalled();
      expect(actions.pause).not.toHaveBeenCalled();
      expect(clock.currentTime()).toBe(0);
    },
  );

  test('ordinary ScoreSaber playback still recovers excessive live delay', () => {
    const { runtime, replay, clock, pose } = fixture('scoresaber');
    replay.poses = [pose(0), pose(30)];
    runtime.latestFrameTime = 30;
    runtime.mapLoaded = true;
    runtime.playbackStarted = true;
    runtime.playbackAttemptPending = true;
    clock.play();
    const actions = { pause: vi.fn(), resume: vi.fn(() => true), seek: vi.fn(), updateStatus: vi.fn() };
    tickLivePlayback(runtime, clock, 'Standard:9', actions);
    expect(actions.seek).toHaveBeenCalledWith(29);
  });
});
