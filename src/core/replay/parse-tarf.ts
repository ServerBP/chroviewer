import { fromBinary } from '@bufbuild/protobuf';
import { inflateSync } from 'fflate';

import {
  type Color,
  type ControllerOffset,
  type Event,
  type Footer,
  type Header,
  type MotionBlock,
  type MotionEncoding,
  type Quaternion,
  type Vector3,
  Completion,
  Difficulty,
  EventBatchSchema,
  FooterSchema,
  HeaderSchema,
  HsvPlatform,
  MotionBlockSchema,
  ReplaySource,
} from './generated/proto/tarf/v1/tarf_pb';
import { simulateReplayScoring } from './parse-beatleader';
import type {
  Replay,
  ReplayColor,
  ReplayComboEvent,
  ReplayControllerOffset,
  ReplayEnergyEvent,
  ReplayHeightEvent,
  ReplayMetadata,
  ReplayMultiplierEvent,
  ReplayNoteEvent,
  ReplayNoteEventType,
  ReplayPauseEvent,
  ReplayPose,
  ReplayQuaternion,
  ReplayScoreEvent,
  ReplayTransform,
  ReplayVector3,
  ReplayWallEvent,
} from './types';

// TARF, the TournamentAssistant Replay Format. The container and the motion
// block packing are described in TARF/README.md in the TournamentAssistant
// repository, the record payloads in tarf.proto.

const fileHeaderLength = 8;
const recordHeaderLength = 16;
const supportedMajorVersion = 1;
const maxDecodedRecordLength = 256 * 1024 * 1024;

const recordTypes = { header: 1, motionBlock: 2, eventBatch: 3, footer: 4 };
const recordCodecs = { none: 0, deflate: 1 };

// Time and fps, then position xyz and rotation xyzw for the head, left hand and right hand.
const poseValueCount = 7;
const valuesPerFrame = 2 + 3 * poseValueCount;

const sourceNames = new Map([
  [ReplaySource.TOURNAMENT_ASSISTANT, 'TournamentAssistant'],
  [ReplaySource.BSOR, 'BeatLeader'],
  [ReplaySource.SCORESABER, 'ScoreSaber'],
]);

// chroviewer uses ScoreSaber's difficulty numbers.
const difficultyRanks = new Map([
  [Difficulty.EASY, 1],
  [Difficulty.NORMAL, 3],
  [Difficulty.HARD, 5],
  [Difficulty.EXPERT, 7],
  [Difficulty.EXPERT_PLUS, 9],
]);

export function isTarfReplay(data: Uint8Array) {
  return data.byteLength >= fileHeaderLength && String.fromCharCode(...data.subarray(0, 4)) === 'TARF';
}

export function parseTarfReplay(data: Uint8Array): Replay {
  if (!isTarfReplay(data)) throw new Error('invalid TARF magic');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const majorVersion = view.getUint16(4, true);
  const minorVersion = view.getUint16(6, true);
  if (majorVersion !== supportedMajorVersion) throw new Error(`TARF version ${majorVersion} is not supported`);

  let header: Header | undefined;
  let footer: Footer | undefined;
  const poses: ReplayPose[] = [];
  const events: Event[] = [];

  for (const record of readRecords(data)) {
    if (header === undefined && record.type !== recordTypes.header) {
      throw new Error('TARF file does not start with a header');
    }
    if (record.type === recordTypes.header) {
      if (header !== undefined) throw new Error('TARF file has more than one header');
      header = fromBinary(HeaderSchema, record.payload);
    } else if (record.type === recordTypes.motionBlock && header !== undefined) {
      if (header.motionEncoding === undefined) throw new Error('TARF header has no motion encoding');
      poses.push(...unpackMotionBlock(fromBinary(MotionBlockSchema, record.payload), header.motionEncoding));
    } else if (record.type === recordTypes.eventBatch) {
      events.push(...fromBinary(EventBatchSchema, record.payload).events);
    } else if (record.type === recordTypes.footer) {
      footer = fromBinary(FooterSchema, record.payload);
    }
    // Record types from newer minor versions are skipped.
  }
  if (header === undefined) throw new Error('TARF file has no header');

  // Live recordings write events as they are known, so batches can overlap in time
  events.sort((left, right) => (left.timeUs < right.timeUs ? -1 : left.timeUs > right.timeUs ? 1 : 0));

  const replay: Replay = {
    metadata: replayMetadata(header, footer, `${majorVersion}.${minorVersion}`),
    poses,
    ...replayEvents(events),
  };

  if (header.hsv !== undefined) {
    replay.hsvProfile = header.hsv.json;
    if (header.hsv.platform === HsvPlatform.PC) replay.hsvProfilePlatform = 'pc';
    if (header.hsv.platform === HsvPlatform.QUEST) replay.hsvProfilePlatform = 'quest';
  } else {
    const scoreSaberHsv = header.sourceExtensions.find(
      (extension) => extension.id === 'scoresaber.hsv-config' && extension.version === 1,
    );
    if (scoreSaberHsv !== undefined) replay.hsvConfig = scoreSaberHsv.payload;
  }

  if (header.map !== undefined && header.map.archive.byteLength > 0) replay.mapArchive = header.map.archive;

  return replay;
}

interface TarfRecord {
  type: number;
  payload: Uint8Array;
}

// A record that runs past the end of the file means the recording was cut
// off, so reading stops there and keeps everything before it.
function* readRecords(data: Uint8Array): Generator<TarfRecord> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = fileHeaderLength;

  while (data.byteLength - offset >= recordHeaderLength) {
    const type = view.getUint8(offset);
    const codec = view.getUint8(offset + 1);
    const storedLength = view.getUint32(offset + 4, true);
    const decodedLength = view.getUint32(offset + 8, true);
    const checksum = view.getUint32(offset + 12, true);
    if (decodedLength > maxDecodedRecordLength) throw new Error('TARF record is too large');

    const payloadStart = offset + recordHeaderLength;
    if (data.byteLength - payloadStart < storedLength) return;

    const stored = data.subarray(payloadStart, payloadStart + storedLength);
    const payload = decodeRecord(stored, codec, decodedLength);
    if (crc32(payload) !== checksum) throw new Error(`TARF record at offset ${offset} failed its checksum`);

    yield { type, payload };
    offset = payloadStart + storedLength;
  }
}

function decodeRecord(stored: Uint8Array, codec: number, decodedLength: number) {
  if (codec === recordCodecs.none) return stored;
  if (codec !== recordCodecs.deflate) throw new Error(`unknown TARF record codec ${codec}`);
  const decoded = inflateSync(stored, { out: new Uint8Array(decodedLength) });
  if (decoded.byteLength !== decodedLength) throw new Error('TARF record length does not match its header');
  return decoded;
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

// Every value in a block is stored as its difference from a prediction: 0 for
// the anchor frame, the previous value for the second frame, and the previous
// value moving at the same speed as in the last two frames after that.
function unpackMotionBlock(block: MotionBlock, encoding: MotionEncoding): ReplayPose[] {
  const reader = { bytes: block.frames, offset: 0 };
  const poses: ReplayPose[] = [];

  let previous: number[] | null = null;
  let beforePrevious: number[] | null = null;
  for (let frame = 0; frame < block.frameCount; frame++) {
    const current: number[] = [];
    for (let index = 0; index < valuesPerFrame; index++) {
      current.push(predict(previous, beforePrevious, index) + readZigZagVarint(reader));
    }
    poses.push(dequantizeFrame(current, encoding));
    beforePrevious = previous;
    previous = current;
  }

  if (reader.offset !== block.frames.byteLength) throw new Error('TARF motion block has trailing data');
  return poses;
}

function predict(previous: number[] | null, beforePrevious: number[] | null, index: number) {
  if (previous === null) return 0;
  const last = previous[index] ?? 0;
  if (beforePrevious === null) return last;
  return 2 * last - (beforePrevious[index] ?? 0);
}

// The same encoding protobuf uses for sint64. The values in a motion block stay
// far below 2^53, so plain numbers are enough.
function readZigZagVarint(reader: { bytes: Uint8Array; offset: number }) {
  let value = 0;
  let scale = 1;
  while (true) {
    if (reader.offset >= reader.bytes.byteLength) throw new Error('truncated TARF motion block');
    if (scale > 2 ** 49) throw new Error('TARF motion value is too large');
    const byte = reader.bytes[reader.offset++] ?? 0;
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) break;
    scale *= 128;
  }
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function dequantizeFrame(values: number[], encoding: MotionEncoding): ReplayPose {
  return {
    time: (values[0] ?? 0) / 1_000_000,
    fps: values[1] ?? 0,
    head: dequantizePose(values, 2, encoding),
    leftHand: dequantizePose(values, 2 + poseValueCount, encoding),
    rightHand: dequantizePose(values, 2 + 2 * poseValueCount, encoding),
  };
}

function dequantizePose(values: number[], start: number, encoding: MotionEncoding): ReplayTransform {
  const positionStep = encoding.positionStepNm / 1e9;
  const rotationStep = encoding.rotationStepNano / 1e9;
  const value = (offset: number) => values[start + offset] ?? 0;

  const rotation = {
    x: value(3) * rotationStep,
    y: value(4) * rotationStep,
    z: value(5) * rotationStep,
    w: value(6) * rotationStep,
  };
  // Quantized quaternions are close to unit length but not exactly.
  const length = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
  if (length > 0) {
    rotation.x /= length;
    rotation.y /= length;
    rotation.z /= length;
    rotation.w /= length;
  }

  return {
    position: { x: value(0) * positionStep, y: value(1) * positionStep, z: value(2) * positionStep },
    rotation,
  };
}

function replayEvents(events: Event[]) {
  const notes: ReplayNoteEvent[] = [];
  const walls: ReplayWallEvent[] = [];
  const heights: ReplayHeightEvent[] = [];
  const pauses: ReplayPauseEvent[] = [];
  let scores: ReplayScoreEvent[] = [];
  let combos: ReplayComboEvent[] = [];
  let multipliers: ReplayMultiplierEvent[] = [];
  let energies: ReplayEnergyEvent[] = [];

  for (const event of events) {
    const time = Number(event.timeUs) / 1_000_000;
    const { payload } = event;
    switch (payload.case) {
      case 'note': {
        const note = payload.value;
        const identity = note.note;
        const cut = note.cut;
        notes.push({
          noteId: {
            time: identity?.time ?? 0,
            lineLayer: identity?.lineLayer ?? 0,
            lineIndex: identity?.lineIndex ?? 0,
            colorType: identity?.colorType ?? 0,
            cutDirection: identity?.cutDirection ?? 0,
            gameplayType: identity?.gameplayType,
            scoringType: identity?.scoringType,
            cutDirectionAngleOffset: identity?.cutDirectionAngleOffset,
          },
          // TARF numbers note event kinds the same way chroviewer does.
          eventType: note.kind as ReplayNoteEventType,
          cutPoint: vector3(cut?.cutPoint),
          cutNormal: vector3(cut?.cutNormal),
          saberDirection: vector3(cut?.saberDirection),
          saberType: cut?.saberType ?? 0,
          directionOk: cut?.directionOk ?? false,
          saberSpeed: cut?.saberSpeed ?? 0,
          cutAngle: cut?.cutAngle ?? 0,
          cutDistanceToCenter: cut?.cutDistanceToCenter ?? 0,
          cutDirectionDeviation: cut?.cutDirectionDeviation ?? 0,
          beforeCutRating: cut?.beforeCutRating ?? 0,
          afterCutRating: cut?.afterCutRating ?? 0,
          time,
          unityTimescale: note.unityTimescale ?? 1,
          timeSyncTimescale: note.timeSyncTimescale ?? 1,
          timeDeviation: cut?.timeDeviation,
          worldRotation: optionalQuaternion(note.worldRotation),
          inverseWorldRotation: optionalQuaternion(note.inverseWorldRotation),
          noteRotation: optionalQuaternion(note.noteRotation),
          notePosition: note.notePosition === undefined ? undefined : vector3(note.notePosition),
        });
        break;
      }
      case 'wall': {
        const wall = payload.value.wall;
        const exitTimeUs = payload.value.exitTimeUs;
        walls.push({
          time,
          exitTime: exitTimeUs === undefined ? time : Number(exitTimeUs) / 1_000_000,
          energy: payload.value.energy,
          obstacleTime: wall?.time ?? 0,
          obstacleDuration: wall?.duration ?? 0,
          lineIndex: wall?.lineIndex ?? 0,
          // Like the BeatLeader parser, BSOR walls use the obstacle type digit of their id as the layer.
          lineLayer: wall?.lineLayer ?? (wall?.bsorWallId === undefined ? 0 : Math.floor((wall.bsorWallId % 100) / 10)),
          width: wall?.width ?? 0,
          height: wall?.height ?? 0,
        });
        break;
      }
      case 'height':
        heights.push({ time, height: payload.value.height });
        break;
      case 'pause': {
        const pause = payload.value;
        const unixStartTime = pause.startedAtUnixMs ?? 0n;
        pauses.push({
          time,
          duration: pause.durationMs,
          unixStartTime,
          unixEndTime: pause.endedAtUnixMs ?? unixStartTime + pause.durationMs,
        });
        break;
      }
      case 'score':
        scores.push({
          time,
          score: payload.value.score,
          immediateMaxPossibleScore: payload.value.immediateMaxPossibleScore,
        });
        break;
      case 'combo':
        combos.push({ time, combo: payload.value.combo });
        break;
      case 'multiplier':
        multipliers.push({
          time,
          multiplier: payload.value.multiplier,
          nextMultiplierProgress: payload.value.nextMultiplierProgress,
        });
        break;
      case 'energy':
        energies.push({ time, energy: payload.value.energy });
        break;
      default:
        // Mid-play modifier events and payloads from newer versions aren't shown yet.
        break;
    }
  }

  // Replays converted from BSOR have no score events, so they are worked out like for a BSOR replay.
  if (scores.length === 0 && combos.length === 0 && multipliers.length === 0 && energies.length === 0) {
    ({ scores, combos, multipliers, energies } = simulateReplayScoring(notes, walls));
  }

  return {
    heights,
    notes,
    scores,
    combos,
    multipliers,
    energies,
    pauses,
    walls,
  };
}

function replayMetadata(header: Header, footer: Footer | undefined, formatVersion: string): ReplayMetadata {
  const { map, player, settings, colors, recorder } = header;
  const hash = map?.hash ?? '';
  const sourceName = sourceNames.get(recorder?.source ?? ReplaySource.UNSPECIFIED);
  const failed = footer?.completion === Completion.FAILED && footer.endTimeUs !== undefined;

  return {
    // Other parts of the viewer look for "BeatLeader" in the version to pick the leaderboard.
    version: sourceName === undefined ? `TARF ${formatVersion}` : `TARF ${formatVersion} (${sourceName})`,
    levelId: map?.levelId || (hash === '' ? '' : `custom_level_${hash}`),
    difficulty: difficultyRanks.get(map?.difficulty ?? Difficulty.UNSPECIFIED) ?? 1,
    characteristic: map?.characteristic ?? '',
    environment: map?.environment ?? '',
    modifiers: settings?.modifiers ?? [],
    noteSpawnOffset: settings?.noteSpawnOffset ?? 0,
    leftHanded: settings?.leftHanded ?? false,
    initialHeight: settings?.playerHeight ?? 0,
    roomRotation: settings?.roomRotation ?? 0,
    roomCenter: vector3(settings?.roomCenter),
    failTime: failed ? Number(footer.endTimeUs) / 1_000_000 : 0,
    gameVersion: player?.gameVersion,
    pluginVersion: recorder?.sourceVersion,
    platform: player?.platform,
    hasPlaySettings: true,
    songSpeed: settings?.songSpeed ?? settings?.practice?.songSpeed,
    jumpDistance: settings?.jumpDistance,
    leftSaberColor: optionalColor(colors?.saberA),
    rightSaberColor: optionalColor(colors?.saberB),
    obstacleColor: optionalColor(colors?.obstacle),
    environmentColor0: optionalColor(colors?.environment0),
    environmentColor1: optionalColor(colors?.environment1),
    environmentColorW: optionalColor(colors?.environmentWhite),
    environmentColor0Boost: optionalColor(colors?.environment0Boost),
    environmentColor1Boost: optionalColor(colors?.environment1Boost),
    environmentColorWBoost: optionalColor(colors?.environmentWhiteBoost),
    supportsEnvironmentColorBoost: colors?.supportsEnvironmentBoost,
    environmentEffectsFilterDefaultPreset: settings?.environmentEffectsFilterDefaultPreset,
    environmentEffectsFilterExpertPlusPreset: settings?.environmentEffectsFilterExpertPlusPreset,
    environmentEffectsFilterPreset: settings?.environmentEffectsFilterPreset,
    noTextsAndHuds: settings?.noTextsAndHuds,
    saberTrailIntensity: settings?.saberTrailIntensity,
    hideNoteSpawnEffect: settings?.hideNoteSpawnEffect,
    arcsHapticFeedback: settings?.arcsHapticFeedback,
    arcVisibility: settings?.arcVisibility,
    controllerOffsets:
      header.controllerOffsets === undefined
        ? undefined
        : {
            shared: controllerOffset(header.controllerOffsets.shared),
            left: controllerOffset(header.controllerOffsets.left),
            right: controllerOffset(header.controllerOffsets.right),
          },
    player: player !== undefined && player.id !== '' ? { id: player.id, name: player.name } : undefined,
  };
}

function vector3(vector: Vector3 | undefined): ReplayVector3 {
  return { x: vector?.x ?? 0, y: vector?.y ?? 0, z: vector?.z ?? 0 };
}

function optionalQuaternion(rotation: Quaternion | undefined): ReplayQuaternion | undefined {
  return rotation === undefined ? undefined : { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
}

function optionalColor(color: Color | undefined): ReplayColor | undefined {
  return color === undefined ? undefined : { x: color.r, y: color.g, z: color.b, a: color.a };
}

// BSOR records controller rotations as quaternions and ScoreSaber as Euler angles. Like
// the BeatLeader parser, quaternions are passed on as they are.
function controllerOffset(offset: ControllerOffset | undefined): ReplayControllerOffset | undefined {
  if (offset === undefined) return undefined;
  const rotation =
    offset.rotation.case === 'quaternion'
      ? optionalQuaternion(offset.rotation.value)
      : offset.rotation.case === 'eulerDegrees'
        ? vector3(offset.rotation.value)
        : undefined;
  return { position: vector3(offset.position), rotation: rotation ?? { x: 0, y: 0, z: 0 } };
}
