import { Result, TaggedError } from 'better-result';
import * as z from 'zod/mini';

import {
  byThresholdDescending,
  DEFAULT_CHAIN_HEAD_JUDGMENT,
  type HitScoreVisualizerConfig,
  type HitScoreVisualizerPlatform,
} from './hit-score-visualizer';

// Profiles with a judgment per score and per-letter colour tags run to tens of kilobytes.
export const MAX_HSV_PROFILE_BYTES = 256 * 1024;

const maxListItems = 1024;
const maxStringBytes = 16 * 1024;
const utf8Encoder = new TextEncoder();
const displayModes = ['none', 'format', 'textonly', 'numeric', 'scoreontop', 'directions'];
const badCutTypes = ['all', 'wrongdirection', 'wrongcolor', 'bomb'];

const colorSchema = z.union([
  z.array(z.number()).check(z.minLength(3)),
  z.object({
    r: z.optional(z.number()),
    g: z.optional(z.number()),
    b: z.optional(z.number()),
    a: z.optional(z.number()),
    R: z.optional(z.number()),
    G: z.optional(z.number()),
    B: z.optional(z.number()),
    A: z.optional(z.number()),
  }),
]);
const vectorSchema = z.union([
  z.array(z.number()).check(z.minLength(3)),
  z.object({
    x: z.optional(z.number()),
    y: z.optional(z.number()),
    z: z.optional(z.number()),
    X: z.optional(z.number()),
    Y: z.optional(z.number()),
    Z: z.optional(z.number()),
  }),
]);
const displayModeSchema = z.union([z.number(), z.string()]);
const judgmentSchema = z.object({
  threshold: z.optional(z.number()),
  text: z.optional(z.string()),
  color: z.optional(z.nullable(colorSchema)),
  fade: z.optional(z.nullable(z.boolean())),
});
const segmentSchema = z.object({
  threshold: z.optional(z.number()),
  text: z.optional(z.nullable(z.string())),
});
const coloredTextSchema = z.object({
  text: z.optional(z.string()),
  color: z.optional(z.nullable(colorSchema)),
});
const badCutDisplaySchema = z.object({
  text: z.optional(z.string()),
  color: z.optional(z.nullable(colorSchema)),
  type: z.optional(z.nullable(z.union([z.number(), z.string()]))),
});
const segmentsSchema = z.optional(z.nullable(z.array(segmentSchema)));
const profileFields = {
  displayMode: z.optional(z.nullable(displayModeSchema)),
  fixedPosition: z.optional(z.nullable(vectorSchema)),
  targetPositionOffset: z.optional(z.nullable(vectorSchema)),
  useFixedPos: z.optional(z.nullable(z.boolean())),
  fixedPosX: z.optional(z.nullable(z.number())),
  fixedPosY: z.optional(z.nullable(z.number())),
  fixedPosZ: z.optional(z.nullable(z.number())),
  judgments: z.array(judgmentSchema),
  chainHeadJudgments: z.optional(z.nullable(z.array(judgmentSchema))),
  chainLinkDisplay: z.optional(z.nullable(coloredTextSchema)),
  beforeCutAngleJudgments: segmentsSchema,
  accuracyJudgments: segmentsSchema,
  afterCutAngleJudgments: segmentsSchema,
  badCutDisplays: z.optional(z.nullable(z.array(badCutDisplaySchema))),
  missDisplays: z.optional(z.nullable(z.array(coloredTextSchema))),
  timeDependenceDecimalPrecision: z.optional(z.nullable(z.number())),
  timeDependenceDecimalOffset: z.optional(z.nullable(z.number())),
  timeDependenceJudgments: segmentsSchema,
  timeDependencyDecimalPrecision: z.optional(z.nullable(z.number())),
  timeDependencyDecimalOffset: z.optional(z.nullable(z.number())),
  timeDependencyJudgments: segmentsSchema,
};
const profileSchema = z.object({
  ...profileFields,
  majorVersion: z.optional(z.nullable(z.number())),
  minorVersion: z.optional(z.nullable(z.number())),
  patchVersion: z.optional(z.nullable(z.number())),
});

type Profile = z.infer<typeof profileSchema>;
type Judgment = z.infer<typeof judgmentSchema>;
type Segment = z.infer<typeof segmentSchema>;
type ColoredText = z.infer<typeof coloredTextSchema>;
type BadCutDisplay = z.infer<typeof badCutDisplaySchema>;
type Color = z.infer<typeof colorSchema>;
type Vector = z.infer<typeof vectorSchema>;

export class InvalidHsvProfile extends TaggedError('InvalidHsvProfile')<{
  message: string;
}>() {}

function invalid(message: string) {
  return new InvalidHsvProfile({ message });
}

/**
 * JSON as Newtonsoft (HSV PC) reads it: a byte order mark, comments and trailing commas
 * are accepted. Several published profiles rely on this (e.g. a comma after the last judgment).
 */
export function parseLenientJson(text: string): unknown {
  const source = text.replace(/^﻿/, '');
  try {
    return JSON.parse(source);
  } catch {
    let output = '';
    let index = 0;
    while (index < source.length) {
      const character = source.charAt(index);
      if (character === '"') {
        const start = index;
        index++;
        while (index < source.length && source.charAt(index) !== '"') index += source.charAt(index) === '\\' ? 2 : 1;
        output += source.slice(start, ++index);
      } else if (character === '/' && source.charAt(index + 1) === '/') {
        while (index < source.length && source.charAt(index) !== '\n') index++;
      } else if (character === '/' && source.charAt(index + 1) === '*') {
        const end = source.indexOf('*/', index + 2);
        index = end === -1 ? source.length : end + 2;
      } else if (character === ',') {
        let next = index + 1;
        while (next < source.length && /\s/.test(source.charAt(next))) next++;
        if (source.charAt(next) !== ']' && source.charAt(next) !== '}') output += ',';
        index++;
      } else {
        output += character;
        index++;
      }
    }
    return JSON.parse(output);
  }
}

function validateList(values: readonly unknown[] | null | undefined, name: string) {
  return (values?.length ?? 0) <= maxListItems
    ? Result.ok(undefined)
    : Result.err(invalid(`${name} contains more than ${String(maxListItems)} entries`));
}

function validateText(value: string, name: string) {
  return utf8Encoder.encode(value).length <= maxStringBytes
    ? Result.ok(undefined)
    : Result.err(invalid(`${name} contains text longer than ${String(maxStringBytes / 1024)} KB`));
}

function readDisplayMode(value: string | number | null | undefined, legacy: boolean) {
  if (value === undefined || value === null) return legacy ? 4 : 0;
  if (typeof value === 'number')
    return Number.isInteger(value) && value >= 0 && value < displayModes.length ? value : 1;
  const index = displayModes.indexOf(value.replaceAll('_', '').toLowerCase());
  return index === -1 ? 1 : index;
}

function readBadCutType(value: string | number | null | undefined) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value < badCutTypes.length ? value : 0;
  const index = badCutTypes.indexOf(value.replaceAll('_', '').toLowerCase());
  return index === -1 ? 0 : index;
}

/** Text is drawn through 8-bit vertex colours, so HDR values clamp to full brightness. */
function colorChannel(value: number) {
  return Math.round(Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1) * 255);
}

function colorHex(value: Color | null | undefined) {
  const channels = Array.isArray(value)
    ? value
    : [value?.r ?? value?.R ?? 1, value?.g ?? value?.G ?? 1, value?.b ?? value?.B ?? 1];
  return `#${channels
    .slice(0, 3)
    .map((channel) => colorChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function vectorTuple(value: Vector | null | undefined): readonly [number, number, number] | undefined {
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value)
    ? [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0]
    : [value.x ?? value.X ?? 0, value.y ?? value.Y ?? 0, value.z ?? value.Z ?? 0];
}

// Duplicate thresholds and a fading first judgment are rejected by HSV PC's validation but
// shown by Quest HSV; both behave the same once sorted (the first duplicate wins, and the
// top judgment has nothing to fade towards), so they are accepted here.
function readJudgments(source: Judgment[] | null | undefined, name: string) {
  const list = validateList(source, name);
  if (list.isErr()) return Result.err(list.error);
  const values = (source ?? []).map((value) => ({
    threshold: value.threshold ?? 0,
    text: value.text ?? '',
    color: colorHex(value.color),
    fade: value.fade ?? false,
  }));
  for (const value of values) {
    const text = validateText(value.text, name);
    if (text.isErr()) return Result.err(text.error);
  }
  return Result.ok(byThresholdDescending(values));
}

function readSegments(source: Segment[] | null | undefined, name: string) {
  const list = validateList(source, name);
  if (list.isErr()) return Result.err(list.error);
  const values = (source ?? []).map((value) => ({ threshold: value.threshold ?? 0, text: value.text ?? '' }));
  for (const value of values) {
    const text = validateText(value.text, name);
    if (text.isErr()) return Result.err(text.error);
  }
  return Result.ok(byThresholdDescending(values));
}

function readColoredText(value: ColoredText | null | undefined, name: string) {
  if (value === undefined || value === null) return Result.ok(undefined);
  const text = value.text ?? '';
  const validText = validateText(text, name);
  return validText.isErr() ? Result.err(validText.error) : Result.ok({ text, color: colorHex(value.color) });
}

function readColoredTexts(source: ColoredText[] | null | undefined, name: string) {
  const list = validateList(source, name);
  if (list.isErr()) return Result.err(list.error);
  const values: { text: string; color: string }[] = [];
  for (const value of source ?? []) {
    const entry = readColoredText(value, name);
    if (entry.isErr()) return Result.err(entry.error);
    if (entry.value !== undefined) values.push(entry.value);
  }
  return Result.ok(values);
}

function readBadCutDisplays(source: BadCutDisplay[] | null | undefined) {
  const list = validateList(source, 'bad cut displays');
  if (list.isErr()) return Result.err(list.error);
  const values: { text: string; color: string; type: number }[] = [];
  for (const value of source ?? []) {
    const text = value.text ?? '';
    const validText = validateText(text, 'bad cut displays');
    if (validText.isErr()) return Result.err(validText.error);
    values.push({ text, color: colorHex(value.color), type: readBadCutType(value.type) });
  }
  return Result.ok(values);
}

function readProfile(profile: Profile, platform: HitScoreVisualizerPlatform) {
  const legacy = profile.majorVersion === undefined || profile.majorVersion === null;
  // Quest HSV does not check versions; PC migrates 2.x and loads 3.x.
  if (platform === 'pc' && !legacy && profile.majorVersion !== 2 && profile.majorVersion !== 3)
    return Result.err(invalid('only Hit Score Visualizer 2.x and 3.x profiles are supported'));
  if (profile.judgments.length === 0) return Result.err(invalid('judgments is empty'));
  const judgments = readJudgments(profile.judgments, 'judgments');
  if (judgments.isErr()) return Result.err(judgments.error);
  const chainHeadJudgments = readJudgments(profile.chainHeadJudgments, 'chain head judgments');
  if (chainHeadJudgments.isErr()) return Result.err(chainHeadJudgments.error);
  const chainLinkDisplay = readColoredText(profile.chainLinkDisplay, 'chain link display');
  if (chainLinkDisplay.isErr()) return Result.err(chainLinkDisplay.error);
  const beforeSegments = readSegments(profile.beforeCutAngleJudgments, 'before cut angle judgments');
  if (beforeSegments.isErr()) return Result.err(beforeSegments.error);
  const accuracySegments = readSegments(profile.accuracyJudgments, 'accuracy judgments');
  if (accuracySegments.isErr()) return Result.err(accuracySegments.error);
  const afterSegments = readSegments(profile.afterCutAngleJudgments, 'after cut angle judgments');
  if (afterSegments.isErr()) return Result.err(afterSegments.error);
  // Quest reads the original "timeDependency" keys, PC its renamed "timeDependence" ones.
  const quest = platform === 'quest';
  const timeSegments = readSegments(
    quest
      ? (profile.timeDependencyJudgments ?? profile.timeDependenceJudgments)
      : (profile.timeDependenceJudgments ?? profile.timeDependencyJudgments),
    'time dependence judgments',
  );
  if (timeSegments.isErr()) return Result.err(timeSegments.error);
  const badCuts = readBadCutDisplays(profile.badCutDisplays);
  if (badCuts.isErr()) return Result.err(badCuts.error);
  const misses = readColoredTexts(profile.missDisplays, 'miss displays');
  if (misses.isErr()) return Result.err(misses.error);
  const timePrecision =
    (quest
      ? (profile.timeDependencyDecimalPrecision ?? profile.timeDependenceDecimalPrecision)
      : (profile.timeDependenceDecimalPrecision ?? profile.timeDependencyDecimalPrecision)) ?? (legacy ? 0 : 1);
  const timeOffset =
    (quest
      ? (profile.timeDependencyDecimalOffset ?? profile.timeDependenceDecimalOffset)
      : (profile.timeDependenceDecimalOffset ?? profile.timeDependencyDecimalOffset)) ?? (legacy ? 0 : 2);
  if (!Number.isInteger(timePrecision) || timePrecision < 0 || timePrecision > 99)
    return Result.err(invalid('time dependence decimal precision is out of range'));
  if (!Number.isInteger(timeOffset) || timeOffset < 0 || timeOffset > 38)
    return Result.err(invalid('time dependence decimal offset is out of range'));
  const fixedPosition =
    profile.useFixedPos === true
      ? ([profile.fixedPosX ?? 0, profile.fixedPosY ?? 0, profile.fixedPosZ ?? 0] as const)
      : vectorTuple(profile.fixedPosition);
  const config: HitScoreVisualizerConfig = {
    platform,
    displayMode: readDisplayMode(profile.displayMode, legacy),
    fixedPosition,
    targetPositionOffset: vectorTuple(profile.targetPositionOffset),
    judgments: judgments.value,
    // PC's 3.4 migration adds a plain score; Quest leaves chain heads to the game.
    chainHeadJudgments:
      chainHeadJudgments.value.length === 0 && !quest ? [DEFAULT_CHAIN_HEAD_JUDGMENT] : chainHeadJudgments.value,
    chainLinkDisplay: chainLinkDisplay.value,
    beforeSegments: beforeSegments.value,
    accuracySegments: accuracySegments.value,
    afterSegments: afterSegments.value,
    timeSegments: timeSegments.value,
    badCuts: badCuts.value,
    misses: misses.value,
    timePrecision,
    timeOffset,
  };
  return Result.ok(config);
}

export function parseHitScoreVisualizerProfile(text: string, platform: HitScoreVisualizerPlatform = 'pc') {
  if (utf8Encoder.encode(text).length > MAX_HSV_PROFILE_BYTES)
    return Result.err(invalid(`profile is larger than ${String(MAX_HSV_PROFILE_BYTES / 1024)} KB`));
  const parsed = Result.try({
    try: () => profileSchema.safeParse(parseLenientJson(text)),
    catch: () => invalid('profile is not valid JSON'),
  });
  if (parsed.isErr()) return Result.err(parsed.error);
  return parsed.value.success
    ? readProfile(parsed.value.data, platform)
    : Result.err(invalid('profile format is not supported'));
}
