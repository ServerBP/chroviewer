import { crc32, deflateRawSync } from 'node:zlib';

import { describe, expect, test } from 'vite-plus/test';

import { anticheatFileKind, parseAnticheatFile, sameNote, type AnticheatReport } from './anticheat';

function record(type: number, payload: Uint8Array, deflate: boolean) {
  const stored = deflate ? new Uint8Array(deflateRawSync(payload)) : payload;
  const header = new Uint8Array(16);
  const view = new DataView(header.buffer);
  view.setUint8(0, type);
  view.setUint8(1, deflate ? 1 : 0);
  view.setUint32(4, stored.byteLength, true);
  view.setUint32(8, payload.byteLength, true);
  view.setUint32(12, crc32(payload), true);
  return [header, stored];
}

function file(magic: string, document: object, replays: Uint8Array[], extra: Uint8Array[][] = []) {
  const header = new Uint8Array(8);
  header.set(new TextEncoder().encode(magic), 0);
  new DataView(header.buffer).setUint16(4, 1, true);
  const parts = [
    header,
    ...record(1, new TextEncoder().encode(JSON.stringify(document)), true),
    ...extra.flat(),
    ...replays.flatMap((replay) => record(2, replay, false)),
  ];
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

const report: AnticheatReport = {
  kind: 'replay-report',
  replay: {
    source: 'beatleader',
    scoreId: '1',
    playerId: '2',
    playerName: 'alice',
    song: 'Song',
    difficulty: 'ExpertPlus',
    mode: 'Standard',
    accuracy: 0.95,
    playedAt: null,
    hmd: 'Quest 3',
    platform: 'oculus',
    fps: 90,
    humanity: 100,
  },
  player: { name: 'alice', label: 'human' },
  summary: 'Nothing out of the ordinary.',
  findings: [
    {
      id: 'overswing',
      severity: 'notice',
      category: 'Swings',
      title: 'Overswing',
      detail: 'Why',
      marks: [
        {
          kind: 'note',
          time: 12.3,
          end: 12.3,
          hand: 1,
          note: { time: 12.312, line: 2, layer: 0, color: 1, direction: 1 },
          value: 41,
          expected: 0,
          label: 'Rated 41° more',
        },
      ],
      series: null,
    },
  ],
};

describe('BeatKhana anticheat files', () => {
  test('a .bkacr holds the report and its replay', () => {
    const tarf = new TextEncoder().encode('TARF replay bytes');
    const bytes = file('BKAC', report, [tarf]);
    expect(anticheatFileKind(bytes)).toBe('bkacr');
    const parsed = parseAnticheatFile(bytes);
    expect(parsed.kind).toBe('bkacr');
    expect(parsed.document).toEqual(report);
    expect(new TextDecoder().decode(parsed.replays[0])).toBe('TARF replay bytes');
  });

  test('a .bkaccmp needs one replay per player and skips unknown records', () => {
    const comparison = { kind: 'comparison', players: [{ index: 0 }, { index: 1 }] };
    const unknown = record(9, new Uint8Array([1, 2, 3]), true);
    const bytes = file('BKCM', comparison, [new Uint8Array([1]), new Uint8Array([2])], [unknown]);
    expect(anticheatFileKind(bytes)).toBe('bkaccmp');
    expect(parseAnticheatFile(bytes).replays.map((replay) => replay[0])).toEqual([1, 2]);
    expect(() => parseAnticheatFile(file('BKCM', comparison, [new Uint8Array([1])]))).toThrow(/does not match/);
  });

  test('damaged files are refused', () => {
    const bytes = file('BKAC', report, [new Uint8Array([1, 2, 3])]);
    const damaged = bytes.slice();
    damaged[30] = (damaged[30] ?? 0) ^ 0xff;
    expect(() => parseAnticheatFile(damaged)).toThrow();
    expect(() => parseAnticheatFile(bytes.subarray(0, bytes.byteLength - 1))).toThrow(/cut off/);
    expect(anticheatFileKind(new TextEncoder().encode('TARF....'))).toBeNull();
  });

  test('note marks find their note by map time, grid place, colour and arrow', () => {
    const mark = report.findings[0]?.marks[0]?.note;
    if (!mark) throw new Error('missing mark');
    const note = { time: 12.3121, lineIndex: 2, lineLayer: 0, colorType: 1, cutDirection: 1 };
    expect(sameNote(mark, note)).toBe(true);
    expect(sameNote(mark, { ...note, lineIndex: 1 })).toBe(false);
    expect(sameNote(mark, { ...note, cutDirection: 0 })).toBe(false);
    expect(sameNote(mark, { ...note, time: 12.315 })).toBe(false);
  });
});
