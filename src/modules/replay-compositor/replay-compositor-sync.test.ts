import { describe, expect, it } from 'vite-plus/test';

import { planTileSync, transportTimeAt } from './replay-compositor-sync';

const tile = { ready: true, time: 10, duration: 120, playing: true, playbackRate: 1 };
const playing = { playing: true, rate: 1 };

describe('transportTimeAt', () => {
  it('advances a playing transport by its rate', () => {
    expect(transportTimeAt({ playing: true, time: 10, rate: 2, at: 1000 }, 1500)).toBe(11);
    expect(transportTimeAt({ playing: false, time: 10, rate: 2, at: 1000 }, 1500)).toBe(10);
  });
});

describe('planTileSync', () => {
  it('leaves a tile that keeps up alone', () => {
    expect(planTileSync(tile, 10.03, playing)).toEqual({});
  });

  it('corrects small drift and seeks after a jump', () => {
    expect(planTileSync(tile, 10.3, playing)).toEqual({ correct: 10.3 });
    expect(planTileSync(tile, 60, playing)).toEqual({ seek: 60 });
  });

  it('starts a paused tile where the transport is', () => {
    expect(planTileSync({ ...tile, playing: false }, 42, playing)).toEqual({ seek: 42, play: true });
  });

  it('pauses with the transport and follows its seeks', () => {
    expect(planTileSync(tile, 10, { playing: false, rate: 1 })).toEqual({ pause: true });
    expect(planTileSync({ ...tile, playing: false }, 30, { playing: false, rate: 1 })).toEqual({ seek: 30 });
  });

  it('waits on the first or last frame outside the song', () => {
    expect(planTileSync(tile, -3, playing)).toEqual({ pause: true, seek: 0 });
    expect(planTileSync({ ...tile, playing: false, time: 120 }, 150, playing)).toEqual({});
  });

  it('follows the playback rate', () => {
    expect(planTileSync(tile, 10, { playing: true, rate: 1.5 })).toEqual({ rate: 1.5 });
  });

  it('does nothing until the replay is loaded', () => {
    expect(planTileSync({ ...tile, ready: false }, 50, playing)).toEqual({});
  });
});
