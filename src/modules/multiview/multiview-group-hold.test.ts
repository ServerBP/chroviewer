import { describe, expect, test } from 'vite-plus/test';

import { advanceGroupHold, createGroupHoldState, type GroupHoldTile } from './multiview-group-hold';

const tile = (id: string, status: string, time: number, changes: Partial<GroupHoldTile> = {}): GroupHoldTile => ({
  id,
  status,
  playing: status === 'watching',
  mapHash: 'map',
  time,
  ...changes,
});

describe('wait-for-all group holds', () => {
  test('a paused POV holds the others, which continue from its time when it plays again', () => {
    const state = createGroupHoldState();
    expect(
      advanceGroupHold(state, [tile('a', 'watching', 10), tile('b', 'watching', 10)], 'map', 0, 30_000).held.size,
    ).toBe(0);
    const paused = advanceGroupHold(state, [tile('a', 'paused', 12), tile('b', 'watching', 12.1)], 'map', 100, 30_000);
    expect([...paused.held]).toEqual(['b']);
    // A pause of any length keeps the hold.
    expect([
      ...advanceGroupHold(
        state,
        [tile('a', 'paused', 12), tile('b', 'watching', 12.2, { playing: false })],
        'map',
        600_000,
        30_000,
      ).held,
    ]).toEqual(['b']);
    const resumed = advanceGroupHold(
      state,
      [tile('a', 'watching', 12.05), tile('b', 'watching', 12.2, { playing: false })],
      'map',
      600_100,
      30_000,
    );
    expect(resumed.held.size).toBe(0);
    expect(resumed.resumeAt).toBe(12.05);
    expect(resumed.resume).toEqual(['b']);
  });

  test('a tile that never played, finished or quit does not hold the group', () => {
    const state = createGroupHoldState();
    expect(
      advanceGroupHold(state, [tile('a', 'watching', 10), tile('b', 'paused', 0)], 'map', 0, 30_000).held.size,
    ).toBe(0);
    advanceGroupHold(state, [tile('a', 'watching', 11), tile('b', 'watching', 11)], 'map', 100, 30_000);
    expect(
      advanceGroupHold(state, [tile('a', 'watching', 12), tile('b', 'waiting', 12)], 'map', 200, 30_000).held.size,
    ).toBe(0);
    expect(
      advanceGroupHold(
        state,
        [tile('a', 'watching', 12), tile('b', 'paused', 12, { mapHash: 'next' })],
        'map',
        300,
        30_000,
      ).held.size,
    ).toBe(0);
  });

  test('a reconnecting POV holds the group only for the wait limit', () => {
    const state = createGroupHoldState();
    advanceGroupHold(state, [tile('a', 'watching', 10), tile('b', 'watching', 10)], 'map', 0, 30_000);
    expect([
      ...advanceGroupHold(state, [tile('a', 'watching', 11), tile('b', 'reconnecting', 11)], 'map', 1_000, 30_000).held,
    ]).toEqual(['a']);
    const expired = advanceGroupHold(
      state,
      [tile('a', 'watching', 11, { playing: false }), tile('b', 'reconnecting', 11)],
      'map',
      31_000,
      30_000,
    );
    expect(expired.held.size).toBe(0);
    expect(expired.resume).toEqual(['a']);
    expect(expired.resumeAt).toBeNull();
  });
});
