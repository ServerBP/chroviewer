import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, test } from 'vite-plus/test';

import {
  ARROW_GOOD_CUT_BOX,
  badCutBox,
  bladeOf,
  checkCut,
  cutAngleOnNote,
  directionTolerance,
  goodCutBox,
  hitboxRules,
  noteScale,
  sweepBox,
} from './note-hitbox';

const note = new Matrix4().makeTranslation(0, 1, -1);
const blade = (x: number, y: number, z: number) => ({ bottom: new Vector3(x, y, z), top: new Vector3(x, y, z - 1) });

describe('note hitboxes', () => {
  test('a blade swept through the note touches its box', () => {
    // Down through the middle of the note, the blade pointing away from the player
    const result = checkCut(note, ARROW_GOOD_CUT_BOX, blade(0, 1.5, -0.2), blade(0, 0.5, -0.2));
    expect(result.box.hits).toBe(true);
    expect(result.sweep.hits).toBe(true);
    expect(result.box.scaleNeeded).toBeLessThan(0.2);
  });

  test('a blade swept beside the note needs a larger box, and how much larger', () => {
    // The arrow box reaches 0.4 m to each side; a sweep 0.8 m to the side needs it twice as wide
    const result = checkCut(note, ARROW_GOOD_CUT_BOX, blade(0.8, 1.5, -0.2), blade(0.8, 0.5, -0.2));
    expect(result.box.hits).toBe(false);
    expect(result.box.scaleNeeded).toBeCloseTo(2, 1);
  });

  test('the box around a sweep holds all four blade ends', () => {
    const previous = blade(0.1, 1.4, 0);
    const current = blade(-0.3, 0.6, 0.2);
    const box = sweepBox(previous, current);
    for (const point of [previous.bottom, previous.top, current.bottom, current.top]) {
      const offset = point.clone().sub(box.center);
      box.axes.forEach((axis, index) => {
        expect(Math.abs(offset.dot(axis))).toBeLessThanOrEqual((box.extents[index] ?? 0) + 1e-6);
      });
    }
  });

  test('a replay transform becomes a one metre blade along the saber', () => {
    const { bottom, top } = bladeOf({ position: { x: 0.2, y: 1, z: 0.3 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
    expect(bottom.toArray()).toEqual([0.2, 1, -0.3]);
    expect(top.z).toBeCloseTo(-1.3);
  });

  test('a cut straight down a down arrow is on the arrow; across it is 90° off', () => {
    expect(cutAngleOnNote(note, [0, -1, 0])?.degrees).toBeCloseTo(0);
    expect(Math.abs(cutAngleOnNote(note, [1, 0, 0])?.degrees ?? 0)).toBeCloseTo(90);
    const upArrow = new Matrix4().compose(
      new Vector3(),
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
      new Vector3(1, 1, 1),
    );
    expect(Math.abs(cutAngleOnNote(upArrow, [0, -1, 0])?.degrees ?? 0)).toBeCloseTo(180);
  });

  test("boxes follow BeatLeader's measurements of the game, with old dots, chains and Pro Mode's bad-cut box", () => {
    expect(goodCutBox('dot')).toEqual({ center: [0, 0, 0.25], size: [0.8, 0.8, 1] });
    expect(goodCutBox('dot', hitboxRules(['OD']))).toEqual({ center: [0, 0, 0.25], size: [0.8, 0.5, 1] });
    expect(goodCutBox('dot', hitboxRules([], 'Standard', '1.19.1')).size).toEqual([0.8, 0.5, 1]);
    expect(goodCutBox('chain').size).toEqual([0.8, 0.2, 1]);
    // The game's own good-cut verdicts keep the standard good-cut box under Pro Mode
    expect(goodCutBox('arrow', hitboxRules(['PM']))).toEqual(goodCutBox('arrow'));
    expect(badCutBox('arrow', hitboxRules(['PM'])).size).toEqual([0.5, 0.5, 0.5]);
    expect(badCutBox('chain').size).toEqual([0.35, 0.1, 0.35]);
    expect(noteScale(['SC'])).toBe(0.5);
  });

  test('strict angles narrow the tolerance', () => {
    expect(directionTolerance([])).toBe(60);
    expect(directionTolerance(['SA'])).toBe(40);
  });
});
