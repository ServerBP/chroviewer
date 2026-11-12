import { inflateSync } from 'fflate';

import type { Replay } from './types';

// BeatKhana anticheat files. A .bkacr is one replay with the anticheat's report on it, a .bkaccmp several players'
// replays of one map with a comparison of them. Both use TARF's record framing under their own magic:
//
//   file header   "BKAC" (.bkacr) or "BKCM" (.bkaccmp), u16 major (1), u16 minor, little endian
//   record header u8 type, u8 codec (0 stored, 1 raw deflate), u16 reserved, u32 stored length, u32 decoded length,
//                 u32 CRC-32 of the decoded payload
//   type 1        the report or comparison as UTF-8 JSON, first and exactly once
//   type 2        an embedded .tarf file; in a .bkaccmp the n-th belongs to the n-th entry of `players`

export type AnticheatSeverity = 'critical' | 'warning' | 'notice' | 'info';

export interface AnticheatNoteRef {
  /** The note's time in the map, in seconds */
  time: number;
  line: number;
  layer: number;
  color: number;
  direction: number;
}

export interface AnticheatMark {
  kind: 'note' | 'swing' | 'turn' | 'frame' | 'stretch';
  /** Song seconds */
  time: number;
  end: number;
  /** 0 left hand, 1 right hand, 2 head */
  hand: number | null;
  note: AnticheatNoteRef | null;
  value: number | null;
  expected: number | null;
  label: string;
}

export interface AnticheatSeries {
  key: string;
  label: string;
  unit: string;
  /** [song seconds, hand (0 left, 1 right, 2 head or both), value] */
  points: [number, number, number][];
  ordinary: [number, number] | null;
}

export interface AnticheatFinding {
  id: string;
  severity: AnticheatSeverity;
  category: string;
  title: string;
  detail: string;
  marks: AnticheatMark[];
  series: AnticheatSeries | null;
}

export interface AnticheatReplayInfo {
  source: string;
  scoreId: string;
  playerId: string;
  playerName: string;
  song: string;
  difficulty: string;
  mode: string;
  accuracy: number | null;
  playedAt: string | null;
  hmd: string | null;
  platform: string | null;
  fps: number | null;
  humanity: number | null;
}

export interface AnticheatReport {
  kind: 'replay-report';
  replay: AnticheatReplayInfo;
  player: { name: string; label: string } | null;
  summary: string | null;
  findings: AnticheatFinding[];
}

export interface AnticheatComparisonPlayer extends AnticheatReplayInfo {
  index: number;
  player: { name: string; label: string } | null;
  summary: string | null;
  findings: AnticheatFinding[];
}

export interface AnticheatComparison {
  kind: 'comparison';
  title: string;
  map: { hash: string; difficulty: string; mode: string; song: string };
  players: AnticheatComparisonPlayer[];
  measures: {
    key: string;
    label: string;
    unit: string;
    group: string;
    kind: string;
    explanation: string;
    ordinary: [number, number] | null;
    values: (number | null)[];
  }[];
  pairs: {
    a: number;
    b: number;
    distance: number | null;
    closerThan: number | null;
    usualPairs: number;
    timingCorrelation: number | null;
    sharedNotes: number;
  }[];
  noteMeasures: string[];
  notes: { note: AnticheatNoteRef; times: (number | null)[]; values: ((number | null)[] | null)[] }[];
}

/** What a replay loaded from an anticheat file carries besides its motion */
export type AnticheatAttachment =
  | { kind: 'report'; report: AnticheatReport }
  | {
      kind: 'comparison';
      comparison: AnticheatComparison;
      /** The other players' replays, in `players` order after the first */ others: Replay[];
    };

export interface AnticheatFile {
  kind: 'bkacr' | 'bkaccmp';
  document: AnticheatReport | AnticheatComparison;
  replays: Uint8Array[];
}

const fileHeaderLength = 8;
const recordHeaderLength = 16;
const supportedMajorVersion = 1;
const recordTypes = { document: 1, replay: 2 };

const magicOf = (data: Uint8Array) =>
  data.byteLength >= fileHeaderLength ? String.fromCharCode(...data.subarray(0, 4)) : '';

export function anticheatFileKind(data: Uint8Array): AnticheatFile['kind'] | null {
  const magic = magicOf(data);
  return magic === 'BKAC' ? 'bkacr' : magic === 'BKCM' ? 'bkaccmp' : null;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function parseAnticheatFile(data: Uint8Array): AnticheatFile {
  const kind = anticheatFileKind(data);
  if (kind === null) throw new Error('not a BeatKhana anticheat file');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const major = view.getUint16(4, true);
  if (major !== supportedMajorVersion) throw new Error(`anticheat file version ${String(major)} is not supported`);
  let document: AnticheatReport | AnticheatComparison | undefined;
  const replays: Uint8Array[] = [];
  let offset = fileHeaderLength;
  while (data.byteLength - offset >= recordHeaderLength) {
    const type = view.getUint8(offset);
    const codec = view.getUint8(offset + 1);
    const storedLength = view.getUint32(offset + 4, true);
    const decodedLength = view.getUint32(offset + 8, true);
    const checksum = view.getUint32(offset + 12, true);
    const start = offset + recordHeaderLength;
    if (data.byteLength - start < storedLength) throw new Error('anticheat file is cut off');
    const stored = data.subarray(start, start + storedLength);
    if (codec !== 0 && codec !== 1) throw new Error(`unknown anticheat record codec ${String(codec)}`);
    const payload = codec === 1 ? inflateSync(stored, { out: new Uint8Array(decodedLength) }) : stored;
    if (payload.byteLength !== decodedLength) throw new Error('anticheat record length does not match its header');
    if (crc32(payload) !== checksum)
      throw new Error(`anticheat record at offset ${String(offset)} failed its checksum`);
    if (type === recordTypes.document) {
      if (document !== undefined) throw new Error('anticheat file has more than one report');
      document = JSON.parse(new TextDecoder().decode(payload)) as AnticheatReport | AnticheatComparison;
    } else if (type === recordTypes.replay) {
      replays.push(payload);
    }
    // Record types from newer minor versions are skipped.
    offset = start + storedLength;
  }
  if (document === undefined) throw new Error('anticheat file has no report');
  if (replays.length === 0) throw new Error('anticheat file holds no replay');
  if (kind === 'bkaccmp' && (document.kind !== 'comparison' || document.players.length !== replays.length)) {
    throw new Error('anticheat comparison does not match its replays');
  }
  return { kind, document, replays };
}

/** Whether a report's note mark names this note of the replay (the same map time, place on the grid, colour and arrow) */
export function sameNote(
  mark: AnticheatNoteRef,
  note: { time: number; lineIndex: number; lineLayer: number; colorType: number; cutDirection: number },
) {
  // The report keeps note times to the millisecond
  return (
    Math.abs(mark.time - note.time) < 0.0015 &&
    mark.line === note.lineIndex &&
    mark.layer === note.lineLayer &&
    mark.color === note.colorType &&
    mark.direction === note.cutDirection
  );
}
