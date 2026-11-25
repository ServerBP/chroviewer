import { describe, expect, test } from 'vite-plus/test';

import { attachCutReview, isCutFileName } from './cut-file';
import type { Replay } from './types';

function clip(): Replay {
  const transform = { position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  const vector = (x: number, y: number, z: number) => ({ x, y, z });
  return {
    metadata: { modifiers: ['SA'], characteristic: 'Standard' },
    poses: [9, 10, 10.6].map((time) => ({ time, fps: 90, head: transform, leftHand: transform, rightHand: transform })),
    notes: [
      {
        noteId: { time: 10, lineLayer: 0, lineIndex: 1, colorType: 1, cutDirection: 1 },
        eventType: 1,
        cutPoint: vector(0, 1, 0),
        cutNormal: vector(1, 0, 0),
        saberDirection: vector(0, -1, 0),
        saberType: 1,
        directionOk: true,
        saberSpeed: 6,
        cutAngle: 0,
        cutDistanceToCenter: 0.05,
        cutDirectionDeviation: 72,
        beforeCutRating: 1,
        afterCutRating: 1,
        time: 10.01,
        unityTimescale: 1,
        timeSyncTimescale: 1,
      },
    ],
  } as unknown as Replay;
}

describe('cut files', () => {
  test('are named .bkacf', () => {
    expect(isCutFileName('cut-12.34s-abcd.bkacf')).toBe(true);
    expect(isCutFileName('replay.tarf')).toBe(false);
  });

  test('loop the clip and focus their one cut with the play rules', () => {
    const replay = clip();
    attachCutReview(replay);
    expect(replay.cutReview).toEqual({ time: 10.01, start: 9, end: 10.6 });
    const report = replay.anticheat?.kind === 'report' ? replay.anticheat.report : null;
    expect(report?.findings[0]?.marks).toHaveLength(1);
    expect(report?.findings[0]?.marks[0]?.cut?.deviation).toBe(72);
    expect(report?.rules?.directionTolerance).toBe(40);
  });
});

describe('a .bkacf written by the anticheat', () => {
  test('parses as a TARF with one note event and a map of one note', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseTarfReplay } = await import('./parse-tarf');
    const bytes = new Uint8Array(readFileSync(new URL('./testdata/flagged-cut.bkacf', import.meta.url)));
    const replay = parseTarfReplay(bytes);
    expect(replay.notes).toHaveLength(1);
    const files = replay.mapFiles ?? {};
    expect(Object.keys(files)).toContain('Info.dat');
    const difficulty = Object.entries(files).find(([name]) => name !== 'Info.dat');
    const map = JSON.parse(new TextDecoder().decode(difficulty?.[1])) as { _notes?: unknown[]; colorNotes?: unknown[] };
    expect((map._notes ?? map.colorNotes)?.length).toBe(1);
    attachCutReview(replay);
    expect(replay.cutReview?.end).toBeGreaterThan(replay.cutReview?.time ?? Infinity);
    expect(replay.cutReview?.start).toBeLessThan(replay.cutReview?.time ?? -Infinity);
  });
});
