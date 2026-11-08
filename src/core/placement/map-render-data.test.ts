import { expect, test } from 'vite-plus/test';

import { createDifficulty, type Obstacle } from '../beatmap/types';
import { currentHalfJumpDurationInBeats, currentSpawnBeat } from './jump-path';
import { buildMapRenderData } from './map-render-data';

function obstacle(overrides: Partial<Obstacle> = {}): Obstacle {
  return {
    jsonTime: 1,
    songBpmTime: 1,
    rotation: 0,
    posX: 0,
    posY: 0,
    type: 0,
    duration: 1,
    durationSongBpmTime: 1,
    width: 1,
    height: 5,
    customFake: false,
    ...overrides,
  };
}

test('classifies only player-affecting obstacles as gameplay walls', () => {
  const difficulty = createDifficulty('3.0.0');
  difficulty.obstacles = [
    obstacle(),
    obstacle({ customFake: true }),
    obstacle({ customData: { uninteractable: true } }),
  ];

  const data = buildMapRenderData(difficulty, {
    noteJumpSpeed: 10,
    noteStartBeatOffset: 0,
    songBpm: 120,
  });

  expect(data.walls.map((wall) => wall.interactable)).toEqual([true, false, false]);
});

test('variable NJS updates global wall movement without changing per-object Noodle timing or decorative walls', () => {
  const difficulty = createDifficulty('3.0.0');
  difficulty.njsEvents = [{ jsonTime: 4, songBpmTime: 4, usePrevious: 0, relativeNjs: -5, easing: 0 }];
  difficulty.obstacles = [
    obstacle({ jsonTime: 8, songBpmTime: 8, customFake: true }),
    obstacle({ jsonTime: 8, songBpmTime: 8, customData: { noteJumpMovementSpeed: 12 } }),
  ];
  const data = buildMapRenderData(difficulty, { noteJumpSpeed: 10, noteStartBeatOffset: 0, songBpm: 120 });
  const [global, noodle] = data.walls;
  if (global === undefined || noodle === undefined) throw new Error('Missing wall render data');
  const before = data.movementStateAt(0);
  const after = data.movementStateAt(8);
  expect(global.interactable).toBe(false);
  expect(global.usesGlobalNjs).toBe(true);
  expect(currentHalfJumpDurationInBeats(global, after)).toBeGreaterThan(currentHalfJumpDurationInBeats(global, before));
  expect(currentSpawnBeat(global, after)).toBeLessThan(currentSpawnBeat(global, before));
  expect(noodle.usesGlobalNjs).toBe(false);
  expect(currentHalfJumpDurationInBeats(noodle, after)).toBe(currentHalfJumpDurationInBeats(noodle, before));
});
