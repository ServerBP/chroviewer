import { crc32, deflateRawSync } from 'node:zlib';

import { create, toBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf';
import { describe, expect, test } from 'vite-plus/test';

import {
  Completion,
  Difficulty,
  EventBatchSchema,
  FooterSchema,
  HeaderSchema,
  HsvPlatform,
  MotionBlockSchema,
  NoteEventKind,
  ReplaySource,
} from './generated/proto/tarf/v1/tarf_pb';
import { isTarfReplay, parseTarfReplay } from './parse-tarf';

const positionStepNm = 10_000;
const rotationStepNano = 1_000;

function record<Schema extends DescMessage>(
  type: number,
  schema: Schema,
  message: MessageShape<Schema>,
  deflate = true,
) {
  const payload = toBinary(schema, message);
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

function tarfFile(records: Uint8Array[][]) {
  const fileHeader = new Uint8Array([0x54, 0x41, 0x52, 0x46, 1, 0, 0, 0]);
  const parts = [fileHeader, ...records.flat()];
  const file = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    file.set(part, offset);
    offset += part.byteLength;
  }
  return file;
}

function zigZagVarint(value: number) {
  const bytes: number[] = [];
  let zigZag = value >= 0 ? value * 2 : -value * 2 - 1;
  while (zigZag >= 0x80) {
    bytes.push((zigZag % 0x80) | 0x80);
    zigZag = Math.floor(zigZag / 0x80);
  }
  bytes.push(zigZag);
  return bytes;
}

// Packs already quantized frames the way README.md describes it.
function packFrames(frames: number[][]) {
  const bytes: number[] = [];
  frames.forEach((frame, index) => {
    frame.forEach((value, valueIndex) => {
      const previous = frames[index - 1]?.[valueIndex];
      const beforePrevious = frames[index - 2]?.[valueIndex];
      const prediction =
        previous === undefined ? 0 : beforePrevious === undefined ? previous : 2 * previous - beforePrevious;
      bytes.push(...zigZagVarint(value - prediction));
    });
  });
  return new Uint8Array(bytes);
}

function quantizedFrame(timeUs: number, headX: number) {
  const identity = [0, 0, 0, 1_000_000];
  return [
    timeUs,
    90,
    headX,
    170_000,
    0,
    ...identity,
    -20_000,
    100_000,
    30_000,
    ...identity,
    20_000,
    100_000,
    30_000,
    ...identity,
  ];
}

const header = create(HeaderSchema, {
  recorder: { source: ReplaySource.BSOR, sourceVersion: '0.9.33', writer: 'test' },
  player: { id: '76561198000000000', name: 'Player', platform: 'steam' },
  map: {
    hash: 'DEE2EF2FC976487AFCE124AE05403DB9135DB731',
    characteristic: 'Standard',
    difficulty: Difficulty.EXPERT_PLUS,
    environment: 'BigMirrorEnvironment',
  },
  settings: { modifiers: ['NF'], leftHanded: false, playerHeight: 1.8 },
  colors: { saberA: { r: 1, g: 0, b: 0, a: 1 }, saberB: { r: 0, g: 0, b: 1, a: 1 } },
  hsv: { json: '{"majorVersion":3,"judgments":[]}', platform: HsvPlatform.PC },
  motionEncoding: { positionStepNm, rotationStepNano, anchorInterval: 60 },
});

const motionBlock = create(MotionBlockSchema, {
  firstFrameIndex: 0,
  frameCount: 3,
  frames: packFrames([quantizedFrame(0, 1_000), quantizedFrame(11_111, 1_500), quantizedFrame(22_222, 2_500)]),
});

const events = create(EventBatchSchema, {
  events: [
    {
      timeUs: 1_250_000n,
      payload: {
        case: 'note',
        value: {
          kind: NoteEventKind.GOOD_CUT,
          note: { time: 1.3, lineIndex: 1, lineLayer: 0, colorType: 0, cutDirection: 1, scoringType: 1 },
          cut: { directionOk: true, saberSpeed: 4, beforeCutRating: 1, afterCutRating: 1, saberType: 0 },
        },
      },
    },
    { timeUs: 2_000_000n, payload: { case: 'pause', value: { durationMs: 3_000n } } },
  ],
});

const footer = create(FooterSchema, { completion: Completion.FAILED, endTimeUs: 2_500_000n, finalScore: 115 });

describe('parseTarfReplay', () => {
  test('decodes the header, motion blocks, events and footer', () => {
    const file = tarfFile([
      record(1, HeaderSchema, header),
      record(2, MotionBlockSchema, motionBlock),
      record(3, EventBatchSchema, events, false),
      record(4, FooterSchema, footer),
    ]);
    expect(isTarfReplay(file)).toBe(true);

    const replay = parseTarfReplay(file);
    expect(replay.metadata.levelId).toBe('custom_level_DEE2EF2FC976487AFCE124AE05403DB9135DB731');
    expect(replay.metadata.difficulty).toBe(9);
    expect(replay.metadata.version).toContain('BeatLeader');
    expect(replay.metadata.failTime).toBe(2.5);
    expect(replay.metadata.leftSaberColor).toEqual({ x: 1, y: 0, z: 0, a: 1 });
    expect(replay.hsvProfile).toBe(header.hsv?.json);
    expect(replay.hsvProfilePlatform).toBe('pc');

    expect(replay.poses.map((pose) => pose.time)).toEqual([0, 0.011111, 0.022222]);
    expect(replay.poses.map((pose) => pose.head.position.x)).toEqual([
      expect.closeTo(0.01),
      expect.closeTo(0.015),
      expect.closeTo(0.025),
    ]);
    expect(replay.poses[2]?.leftHand.position).toEqual({
      x: expect.closeTo(-0.2),
      y: expect.closeTo(1),
      z: expect.closeTo(0.3),
    });
    expect(replay.poses[2]?.rightHand.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });

    expect(replay.notes).toHaveLength(1);
    expect(replay.notes[0]?.time).toBe(1.25);
    expect(replay.notes[0]?.eventType).toBe(1);
    expect(replay.pauses[0]?.duration).toBe(3_000n);
    // Without score events, scores are worked out from the notes.
    expect(replay.scores).toHaveLength(1);
  });

  test('keeps everything before a record that was cut off', () => {
    const file = tarfFile([record(1, HeaderSchema, header), record(2, MotionBlockSchema, motionBlock)]);
    const truncated = file.subarray(0, file.byteLength - 4);
    const replay = parseTarfReplay(truncated);
    expect(replay.poses).toHaveLength(0);
    expect(replay.metadata.failTime).toBe(0);
  });

  test('rejects a record whose checksum does not match', () => {
    const [recordHeader, payload] = record(1, HeaderSchema, header, false);
    if (recordHeader === undefined || payload === undefined) throw new Error('record was not built');
    const corrupted = payload.slice();
    corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
    expect(() => parseTarfReplay(tarfFile([[recordHeader, corrupted]]))).toThrow('checksum');
  });
});
