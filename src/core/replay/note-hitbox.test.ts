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
  boxScale,
  cutBox,
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

  test("the game's cut box runs along this frame's blade back to the previous blade's middle", () => {
    const previous = blade(0.4, 1.4, 0);
    const current = blade(0, 1.0, 0);
    const box = cutBox(previous, current);
    // One metre along the blade, 0.4 m back towards the previous middle, flat across the swing
    expect(box.extents[0]).toBeCloseTo(0.5);
    expect(box.extents[1]).toBeCloseTo(Math.hypot(0.4, 0.4) / 2);
    expect(box.extents[2]).toBe(0);
    expect(box.center.x).toBeCloseTo(0.2);
    expect(box.center.y).toBeCloseTo(1.2);
    expect(box.center.z).toBeCloseTo(-0.5);
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

  test("boxes follow the game's note prefabs, with old dots, chains, Small Notes and Pro Mode's bad-cut box", () => {
    expect(goodCutBox('dot')).toEqual({ center: [0, 0, 0.25], size: [0.8, 0.8, 1] });
    expect(goodCutBox('dot', hitboxRules(['OD']))).toEqual({ center: [0, 0, 0.25], size: [0.8, 0.5, 1] });
    expect(goodCutBox('dot', hitboxRules([], 'Standard', '1.19.1')).size).toEqual([0.8, 0.5, 1]);
    expect(goodCutBox('chain').size).toEqual([0.8, 0.2, 1]);
    // The game's own good-cut verdicts keep the standard good-cut box under Pro Mode
    expect(goodCutBox('arrow', hitboxRules(['PM']))).toEqual(goodCutBox('arrow'));
    expect(badCutBox('arrow', hitboxRules(['PM'])).size).toEqual([0.5, 0.5, 0.5]);
    expect(badCutBox('arrow').size).toEqual([0.35, 0.35, 0.35]);
    expect(badCutBox('chain').size).toEqual([0.35, 0.1, 0.35]);
    expect(noteScale(['SC'])).toBe(0.5);
    expect(noteScale(['SC']) * boxScale(noteScale(['SC']))).toBe(0.75);
  });

  test('strict angles narrow the tolerance', () => {
    expect(directionTolerance([])).toBe(60);
    expect(directionTolerance(['SA'])).toBe(40);
  });
});
