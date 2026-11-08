import { describe, expect, test } from 'vite-plus/test';

import { unpackJson } from './packed-json';

// Packed by the TournamentAssistant writer from
// {"version":"3.3.0","basicBeatmapEvents":[{"b":4.0,"et":2,"f":0.600000024},...],
// "colorNotes":[...],"customData":{"rotation":[0.5,9.4693004200235,12345678901234567890],...}}
// The lights are stored grouped by their type and the notes only have some of
// the custom data keys, which covers every part of the format.
const packed = Uint8Array.from(
  [
    '12016202657401660a637573746f6d44617461017801630776657273696f6e05332e332e30126261736963426561746d',
    '61704576656e74730a636f6c6f724e6f7465730b636f6f7264696e6174657305636f6c6f7208726f746174696f6e0466',
    '6c6167076d697373696e67056d697865640374776f04666f757203000406000107080002002401030101000100000406',
    '080406080406080406080406080406080200000004000020222426282a20222426282a20222426282a02000005000006',
    '020a06020a06020a06020a06020a06020a09000200040103000400000002000012140400000100000204050000010000',
    '000203000300020a010102000401000400000b020b010202000801000400000804020803000300040c00020006010090',
    '4e0100000200904ecac70be1639d31956ae5430d0004020e0004000f0002000801050102030401100200020100010000',
    '06030001110000010000080401',
  ]
    .join('')
    .match(/../g) ?? [],
  (byte) => Number.parseInt(byte, 16),
);

function lights(type: number) {
  return [0.6, 0.2, 1, 0.6, 0.2, 1].map((brightness, index) => ({
    b: 4 + index * 0.25,
    et: type,
    f: Math.fround(brightness),
  }));
}

describe('unpackJson', () => {
  test('gives back the values Beat Saber reads', () => {
    const json = unpackJson(packed) as Record<string, unknown>;
    expect(json.version).toBe('3.3.0');

    const events = json.basicBeatmapEvents as { b: number; et: number; f: number }[];
    const original = [0, 1, 2, 3, 4, 5].flatMap((index) => [2, 3, 4].map((type) => lights(type)[index]));
    expect(events).toEqual(original);

    expect(json.colorNotes).toEqual([
      { b: 4.5, x: 1, c: 0, customData: { coordinates: [-1.5, 0.25] } },
      { b: 5, x: 2, c: 1, customData: { color: [1, 0.5, 0.25, 1] } },
    ]);
    expect(json.customData).toEqual({
      rotation: [0.5, Math.fround(9.4693004200235), Number(12345678901234567890n)],
      flag: true,
      missing: null,
      mixed: ['two', [3], { four: 4 }, false],
    });
  });

  test('rejects truncated data', () => {
    expect(() => unpackJson(packed.subarray(0, packed.byteLength - 1))).toThrow('truncated');
  });
});
