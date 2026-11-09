import { describe, expect, it } from 'vite-plus/test';

import { layoutReplayTiles } from './replay-compositor-layout';

function players(perSide: number[]) {
  return perSide.flatMap((count, side) =>
    Array.from({ length: count }, (_, index) => ({ id: `${side}-${index}`, side })),
  );
}

describe('layoutReplayTiles', () => {
  it('puts the two players of a 1v1 left and right', () => {
    const tiles = layoutReplayTiles(players([1, 1]), 1920, 1080, { gap: 0 });
    expect(tiles.get('0-0')).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
    expect(tiles.get('1-0')).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
  });

  it('stacks each side of a 2v2 in its half', () => {
    const tiles = layoutReplayTiles(players([2, 2]), 1920, 1080, { gap: 0 });
    expect(tiles.get('0-0')).toEqual({ x: 0, y: 0, width: 960, height: 540 });
    expect(tiles.get('0-1')).toEqual({ x: 0, y: 540, width: 960, height: 540 });
    expect(tiles.get('1-1')).toEqual({ x: 960, y: 540, width: 960, height: 540 });
  });

  it('puts each side of a 3v3 in a row, one above the other', () => {
    const tiles = layoutReplayTiles(players([3, 3]), 1920, 1080, { gap: 0 });
    expect(tiles.get('0-2')).toEqual({ x: 1280, y: 0, width: 640, height: 540 });
    expect(tiles.get('1-0')).toEqual({ x: 0, y: 540, width: 640, height: 540 });
  });

  it('gives each side of a 4v4 a 2x2 grid', () => {
    const tiles = layoutReplayTiles(players([4, 4]), 1920, 1080, { gap: 0 });
    expect(tiles.get('0-3')).toEqual({ x: 480, y: 540, width: 480, height: 540 });
    expect(tiles.get('1-0')).toEqual({ x: 960, y: 0, width: 480, height: 540 });
  });

  it('follows a requested layout', () => {
    const tiles = layoutReplayTiles(players([3, 3]), 1920, 1080, { gap: 0, layout: 'columns' });
    expect(tiles.get('0-2')).toEqual({ x: 0, y: 720, width: 960, height: 360 });
    expect(tiles.get('1-0')).toEqual({ x: 960, y: 0, width: 960, height: 360 });
  });

  it('centres a short last row', () => {
    const tiles = layoutReplayTiles(players([3]), 1920, 1080, { gap: 0 });
    expect(tiles.get('0-1')).toEqual({ x: 960, y: 0, width: 960, height: 540 });
    expect(tiles.get('0-2')).toEqual({ x: 480, y: 540, width: 960, height: 540 });
  });

  it('fills the view with a focused player and keeps gaps between tiles', () => {
    expect(layoutReplayTiles(players([2, 2]), 1280, 720, { focus: '1-1' })).toEqual(
      new Map([['1-1', { x: 0, y: 0, width: 1280, height: 720 }]]),
    );
    const tiles = layoutReplayTiles(players([1, 1]), 1000, 500, { gap: 4 });
    expect(tiles.get('0-0')).toEqual({ x: 0, y: 0, width: 498, height: 500 });
    expect(tiles.get('1-0')).toEqual({ x: 502, y: 0, width: 498, height: 500 });
  });

  it('shares the whole view between players of a single side', () => {
    const tiles = layoutReplayTiles(players([2]), 1920, 1080, { gap: 0 });
    expect(tiles.get('0-1')).toEqual({ x: 0, y: 540, width: 1920, height: 540 });
  });
});
