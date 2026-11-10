import { describe, expect, test } from 'vite-plus/test';

import { liveReplayScoreAt } from '../../core/replay/scoring';
import type { Replay } from '../../core/replay/types';
import { multiviewReplayScore, multiviewScoreHistory, multiviewScoreRate } from './multiview-replay-scores';

function note(time: number, eventType: number) {
  return { time, eventType, noteId: { scoringType: 1 }, beforeCutRating: 1, afterCutRating: 1, cutDistanceToCenter: 0 };
}

function liveReplay(): Replay {
  return {
    notes: [note(61, 1), note(62, 3), note(63, 2)],
    walls: [{ time: 63.5 }],
    scores: [
      { time: 61, score: 115, immediateMaxPossibleScore: 115 },
      { time: 63, score: 115, immediateMaxPossibleScore: 345 },
    ],
    combos: [
      { time: 61, combo: 41 },
      { time: 62, combo: 0 },
    ],
    multipliers: [],
    energies: [{ time: 62, energy: 0.4 }],
    heights: [],
    pauses: [],
    poses: [{ time: 60 }],
    liveStartTime: 60,
  } as unknown as Replay;
}

describe('multiview replay scores', () => {
  test('reads a growing live replay at the tile time', () => {
    const replay = liveReplay();
    expect(liveReplayScoreAt(replay, 61.5)).toMatchObject({ score: 115, misses: 0, combo: 41, maxCombo: 41 });
    replay.notes.push(note(64, 3) as unknown as Replay['notes'][number]);
    expect(liveReplayScoreAt(replay, 64)).toMatchObject({ misses: 2, badCuts: 1, wallsHit: 1, combo: 0 });
  });

  test('adds what a stream joined mid-song missed and reports realtime score names', () => {
    const replay = liveReplay();
    const history = multiviewScoreHistory(replay, { notesMissed: 3, badCuts: 1, maxCombo: 120, wallHits: '2' });
    expect(multiviewReplayScore(liveReplayScoreAt(replay, 63.6), 63.6, history)).toEqual({
      scoreWithModifiers: 115,
      maxScoreWithModifiers: 345,
      accuracy: 115 / 345,
      combo: 0,
      maxCombo: 120,
      notesMissed: 4,
      badCuts: 2,
      bombHits: 0,
      wallHits: 3,
      playerHealth: 0.4,
      songPosition: 63.6,
    });
  });

  test('accepts only sensible rates', () => {
    expect(multiviewScoreRate(undefined)).toBe(0);
    expect(multiviewScoreRate(0)).toBe(0);
    expect(multiviewScoreRate(10)).toBe(10);
    expect(multiviewScoreRate(500)).toBe(60);
  });
});
