import { describe, expect, test } from 'vite-plus/test';

import { MultiviewTimeline, multiviewAudioOwner } from './multiview-timeline';

const base = {
  beat: 20,
  bpm: 120,
  duration: 100,
  mapHash: 'ABC',
  mapTitle: 'Map',
  playbackRate: 1,
  playing: true,
  time: 10,
};

describe('multiview timeline', () => {
  test('assigns audio to exactly one highest-volume player', () => {
    expect(
      multiviewAudioOwner([
        { id: 'one', masterVolume: 0.4 },
        { id: 'two', masterVolume: 0.8 },
        { id: 'three', masterVolume: 0.8 },
      ]),
    ).toBe('two');
    expect(multiviewAudioOwner([{ id: 'muted', masterVolume: 0 }])).toBeNull();
  });

  test('extrapolates one primary timeline for players on the same map', () => {
    const timeline = new MultiviewTimeline();
    timeline.configure([
      { id: 'one', masterVolume: 0.25 },
      { id: 'two', masterVolume: 0.75 },
    ]);
    timeline.update('one', { ...base, beat: 18, time: 9 }, 1_000);
    timeline.update('two', base, 1_000);

    expect(timeline.sampleFor('one', 1_500)).toMatchObject({ id: 'two', time: 10.5, beat: 21 });
    expect(timeline.primary(1_500)).toMatchObject({ id: 'two', time: 10.5, beat: 21 });
  });

  test('does not apply a different map timeline to a player', () => {
    const timeline = new MultiviewTimeline();
    timeline.configure([
      { id: 'one', masterVolume: 0 },
      { id: 'two', masterVolume: 1 },
    ]);
    timeline.update('one', { ...base, mapHash: 'OTHER', time: 4, beat: 8 }, 1_000);
    timeline.update('two', base, 1_000);

    expect(timeline.sampleFor('one', 1_500)).toMatchObject({ id: 'one', time: 4.5, beat: 9 });
  });
});
