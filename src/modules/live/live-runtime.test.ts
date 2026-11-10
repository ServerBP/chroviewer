import { describe, expect, test } from 'vite-plus/test';

import type { Replay } from '../../core/replay/types';
import { createLiveRuntime, lateJoinedStream, liveStreamStale } from './live-runtime';

describe('live stream startup', () => {
  test('a start packet without frames is treated as an ended play after a few seconds', () => {
    const runtime = createLiveRuntime({ playerId: '76561198000000000', source: 'ta' });
    runtime.replay = {} as Replay;
    runtime.streamStartedAt = 1_000;
    expect(liveStreamStale(runtime, 5_900)).toBe(false);
    expect(liveStreamStale(runtime, 6_000)).toBe(true);
    runtime.receivedPoseFrameCount = 1;
    expect(liveStreamStale(runtime, 60_000)).toBe(false);
  });

  test('recognises a viewer that connected well into a play', () => {
    expect(lateJoinedStream(0n, 100_000)).toBe(false);
    expect(lateJoinedStream(95_000n, 100_000)).toBe(false);
    expect(lateJoinedStream(80_000n, 100_000)).toBe(true);
  });
});
