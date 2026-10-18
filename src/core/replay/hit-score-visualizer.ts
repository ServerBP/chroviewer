import type { CutScore } from './scoring';
import { parseRichText } from './tmp-rich-text';
import type { ReplayNoteEvent } from './types';

/**
 * A flying score's TMP rich text and base colour. `vanilla` marks text Beat Saber draws
 * itself (no HSV, or HSV leaving that note type alone), which keeps the game's own styling.
 */
export interface HitScoreDisplay {
  text: string;
  color: string;
  vanilla: boolean;
  /** False when the text has no visible characters, so nothing needs to be drawn. */
  visible: boolean;
}

interface ColoredText {
  text: string;
  color: string;
}

interface Judgment extends ColoredText {
  threshold: number;
  fade: boolean;
}

interface Segment {
  threshold: number;
  text: string;
}

interface BadCutDisplay extends ColoredText {
  type: number;
}

/**
 * Which HitScoreVisualizer interpreted the profile. PC (ErisApps) and Quest (Metalit)
 * differ in a few visible details: Quest ignores displayMode, leaves notes it has no chain
 * judgments for to the game, and does not format %t inside %T segments.
 */
export type HitScoreVisualizerPlatform = 'pc' | 'quest';

export interface HitScoreVisualizerConfig {
  platform: HitScoreVisualizerPlatform;
  fixedPosition?: readonly [number, number, number];
  targetPositionOffset?: readonly [number, number, number];
  displayMode: number;
  /** Highest threshold first. */
  judgments: Judgment[];
  /** Highest threshold first; empty means the game's own text (Quest only). */
  chainHeadJudgments: Judgment[];
  /** Undefined means the game's own text on Quest and HSV's default on PC. */
  chainLinkDisplay?: ColoredText;
  beforeSegments: Segment[];
  accuracySegments: Segment[];
  afterSegments: Segment[];
  timeSegments: Segment[];
  badCuts: BadCutDisplay[];
  misses: ColoredText[];
  timePrecision: number;
  timeOffset: number;
}

export const DISPLAY_MODE = { none: 0, format: 1, textOnly: 2, numeric: 3, scoreOnTop: 4, directions: 5 } as const;
export const BAD_CUT_TYPE = { all: 0, wrongDirection: 1, wrongColor: 2, bomb: 3 } as const;

/** HSV PC's `ChainHeadJudgment.Default`, added by its 3.4 migration when a profile has none. */
export const DEFAULT_CHAIN_HEAD_JUDGMENT: Judgment = { threshold: 0, text: '%s', color: '#ffffff', fade: false };
/** HSV PC's `ChainLinkDisplay.Default`. */
const defaultChainLinkDisplay: ColoredText = { text: '<u>20</u>', color: '#ffffff' };
/** HSV PC's `NormalJudgment.Default`, used when no threshold matches. */
const defaultJudgment: Judgment = { threshold: 0, text: '%s', color: '#ffffff', fade: false };

function display(text: string, color: string, vanilla = false): HitScoreDisplay {
  return { text, color, vanilla, visible: parseRichText(text, 1).plain.trim() !== '' };
}

function vanillaFailureDisplay(note: ReplayNoteEvent) {
  if (note.eventType === 3) return display('MISS', '#ff0000', true);
  if (note.eventType === 2 || note.eventType === 4) return display('X', '#ff0000', true);
  return display('', '#cccccc', true);
}

class PayloadReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly payload: Uint8Array) {
    this.view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  }

  byte() {
    this.require(1);
    return this.view.getUint8(this.offset++);
  }

  ushort() {
    this.require(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  float() {
    this.require(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  vector(): readonly [number, number, number] {
    return [this.float(), this.float(), this.float()];
  }

  string() {
    const length = this.ushort();
    this.require(length);
    const value = new TextDecoder().decode(this.payload.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  color() {
    const channels: [number, number, number] = [this.byte(), this.byte(), this.byte()];
    this.byte();
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  }

  list<T>(read: () => T) {
    return Array.from({ length: this.byte() }, read);
  }

  finished() {
    return this.offset === this.payload.length;
  }

  private require(length: number) {
    if (length > this.payload.length - this.offset) throw new Error('HSV payload is truncated');
  }
}

export function byThresholdDescending<T extends { threshold: number }>(values: T[]) {
  // Stable, so the first of several equal thresholds keeps winning as in both HSVs.
  return [...values].sort((left, right) => right.threshold - left.threshold);
}

/** ScoreSaber PC's `scoresaber.hsv-config` replay extension. */
export function decodeHitScoreVisualizer(payload: Uint8Array | undefined): HitScoreVisualizerConfig | null {
  if (payload === undefined || payload.length === 0 || payload.length > 1024 * 1024) return null;
  try {
    const reader = new PayloadReader(payload);
    const major = reader.byte();
    reader.byte();
    reader.byte();
    if (major !== 3) return null;
    const displayMode = reader.byte();
    if (displayMode > 5) return null;
    const flags = reader.byte();
    const fixedPosition = (flags & 1) !== 0 ? reader.vector() : undefined;
    const targetPositionOffset = (flags & 2) !== 0 ? reader.vector() : undefined;
    const timePrecision = reader.byte();
    const timeOffset = reader.byte();
    const judgment = () => ({
      threshold: reader.ushort(),
      text: reader.string(),
      color: reader.color(),
      fade: reader.byte() !== 0,
    });
    const judgments = reader.list(judgment);
    const chainHeadJudgments = reader.list(judgment);
    const chainLinkDisplay = (flags & 16) !== 0 ? { text: reader.string(), color: reader.color() } : undefined;
    const segments = () => reader.list(() => ({ threshold: reader.ushort(), text: reader.string() }));
    const beforeSegments = segments();
    const accuracySegments = segments();
    const afterSegments = segments();
    const timeSegments = reader.list(() => ({ threshold: reader.float(), text: reader.string() }));
    const badCuts = reader.list(() => ({ text: reader.string(), color: reader.color(), type: reader.byte() }));
    const misses = reader.list(() => ({ text: reader.string(), color: reader.color() }));
    if (!reader.finished() || judgments.length === 0) return null;
    return {
      platform: 'pc',
      displayMode,
      fixedPosition,
      targetPositionOffset,
      judgments: byThresholdDescending(judgments),
      chainHeadJudgments:
        chainHeadJudgments.length === 0 ? [DEFAULT_CHAIN_HEAD_JUDGMENT] : byThresholdDescending(chainHeadJudgments),
      chainLinkDisplay,
      beforeSegments: byThresholdDescending(beforeSegments),
      accuracySegments: byThresholdDescending(accuracySegments),
      afterSegments: byThresholdDescending(afterSegments),
      timeSegments: byThresholdDescending(timeSegments),
      badCuts,
      misses,
      timePrecision,
      timeOffset,
    };
  } catch {
    return null;
  }
}

function segmentText(segments: Segment[], score: number) {
  return segments.find((segment) => score >= segment.threshold)?.text ?? '';
}

function directionArrow(note: ReplayNoteEvent) {
  const diagonal = Math.SQRT1_2;
  const bases: readonly (readonly [number, number])[] = [
    [0, -1],
    [-diagonal, -diagonal],
    [-1, 0],
    [-diagonal, diagonal],
  ];
  let closest = 0;
  let closestDot = Number.NEGATIVE_INFINITY;
  let closestSignedDot = 0;
  for (let index = 0; index < bases.length; index++) {
    const base = bases[index];
    if (base === undefined) continue;
    const dot = note.cutNormal.x * base[0] + note.cutNormal.y * base[1];
    if (Math.abs(dot) <= closestDot) continue;
    closest = index + 4;
    closestDot = Math.abs(dot);
    closestSignedDot = dot;
  }
  const base = bases[closest - 4];
  const notePosition = note.notePosition;
  const towardNote =
    base !== undefined && notePosition !== undefined
      ? base[0] * (notePosition.x - note.cutPoint.x) + base[1] * (notePosition.y - note.cutPoint.y)
      : closestSignedDot;
  if (towardNote <= 0) closest -= 4;
  return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][closest] ?? '';
}

function fadeColor(from: string, to: string, amount: number) {
  const t = Math.min(Math.max(Number.isFinite(amount) ? amount : 0, 0), 1);
  const channel = (color: string, offset: number) => Number.parseInt(color.slice(offset, offset + 2), 16);
  const result = [1, 3, 5].map((offset) =>
    Math.round(channel(from, offset) + (channel(to, offset) - channel(from, offset)) * t),
  );
  return `#${result.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * HSV's left-to-right `%` substitution. Inserted values are not scanned again, unknown
 * specifiers stay as written, and a trailing `%` is kept by PC (with a space) but dropped by Quest.
 */
function substitute(
  template: string,
  platform: HitScoreVisualizerPlatform,
  value: (specifier: string) => string | undefined,
) {
  let output = '';
  let offset = 0;
  while (offset < template.length) {
    const percent = template.indexOf('%', offset);
    if (percent === -1) break;
    output += template.slice(offset, percent);
    if (percent === template.length - 1) {
      if (platform === 'pc') output += '% ';
      offset = template.length;
      break;
    }
    const specifier = template.charAt(percent + 1);
    output += specifier === '%' ? '%' : specifier === 'n' ? '\n' : (value(specifier) ?? `%${specifier}`);
    offset = percent + 2;
  }
  return output + template.slice(offset);
}

function timeDependenceText(config: HitScoreVisualizerConfig, timeDependence: number) {
  const value = timeDependence * 10 ** config.timeOffset;
  const digits = Math.min(config.timePrecision, 100);
  if (config.platform === 'quest') return value.toFixed(digits);
  // .NET's "n" format groups thousands.
  try {
    return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    return value.toFixed(digits);
  }
}

function formatJudgmentText(template: string, config: HitScoreVisualizerConfig, cut: CutScore, note: ReplayNoteEvent) {
  const timeDependence = Math.abs(note.cutNormal.z);
  return substitute(template, config.platform, (specifier) => {
    switch (specifier) {
      case 'b':
        return String(cut.before);
      case 'c':
        return String(cut.accuracy);
      case 'a':
        return String(cut.after);
      case 't':
        return timeDependenceText(config, timeDependence);
      case 'B':
        return segmentText(config.beforeSegments, cut.before);
      case 'C':
        return segmentText(config.accuracySegments, cut.accuracy);
      case 'A':
        return segmentText(config.afterSegments, cut.after);
      case 'T': {
        const text = segmentText(config.timeSegments, timeDependence);
        return config.platform === 'quest'
          ? text
          : substitute(text, 'pc', (inner) => (inner === 't' ? timeDependenceText(config, timeDependence) : undefined));
      }
      case 'd':
        return directionArrow(note);
      case 's':
        return String(cut.total);
      case 'p': {
        const percent = Math.round((cut.total / cut.maximum) * 100);
        // Quest HSV prints the rounded float with std::to_string.
        return config.platform === 'quest' ? percent.toFixed(6) : String(percent);
      }
      default:
        return undefined;
    }
  });
}

function textForMode(template: string, config: HitScoreVisualizerConfig, cut: CutScore, note: ReplayNoteEvent) {
  if (config.platform === 'quest') return formatJudgmentText(template, config, cut, note);
  switch (config.displayMode) {
    case DISPLAY_MODE.format:
      return formatJudgmentText(template, config, cut, note);
    case DISPLAY_MODE.textOnly:
      return template;
    case DISPLAY_MODE.numeric:
      return String(cut.total);
    case DISPLAY_MODE.scoreOnTop:
      return `${String(cut.total)}\n${template}\n`;
    case DISPLAY_MODE.directions:
      return `${template}\n${directionArrow(note)}\n`;
    default:
      return `${template}\n${String(cut.total)}\n`;
  }
}

function judgedDisplay(judgments: Judgment[], config: HitScoreVisualizerConfig, cut: CutScore, note: ReplayNoteEvent) {
  let index = judgments.findIndex((judgment) => cut.total >= judgment.threshold);
  // No match: PC falls back to a plain white score, Quest to its last judgment.
  if (index === -1 && config.platform === 'quest') index = judgments.length - 1;
  const judgment = judgments[index] ?? defaultJudgment;
  const higher = index > 0 ? judgments[index - 1] : undefined;
  const color =
    judgment.fade && higher !== undefined
      ? fadeColor(
          judgment.color,
          higher.color,
          (cut.total - judgment.threshold) / (higher.threshold - judgment.threshold),
        )
      : judgment.color;
  return display(textForMode(judgment.text, config, cut, note), color);
}

function vanillaScoreDisplay(cut: CutScore) {
  return display(String(cut.total), '#cccccc', true);
}

function judgmentDisplay(config: HitScoreVisualizerConfig, cut: CutScore, note: ReplayNoteEvent) {
  if (note.noteId.gameplayType === 3) {
    const link = config.chainLinkDisplay ?? (config.platform === 'quest' ? undefined : defaultChainLinkDisplay);
    return link === undefined
      ? vanillaScoreDisplay(cut)
      : display(textForMode(link.text, config, cut, note), link.color);
  }
  if (note.noteId.gameplayType === 2) {
    return config.chainHeadJudgments.length === 0
      ? vanillaScoreDisplay(cut)
      : judgedDisplay(config.chainHeadJudgments, config, cut, note);
  }
  return judgedDisplay(config.judgments, config, cut, note);
}

function badCutType(note: ReplayNoteEvent) {
  if (note.eventType === 4) return BAD_CUT_TYPE.bomb;
  // Both HSVs treat a cut with the wrong saber as a colour error, whatever the direction.
  return note.saberType === note.noteId.colorType ? BAD_CUT_TYPE.wrongDirection : BAD_CUT_TYPE.wrongColor;
}

export function hitScoreDisplay(
  config: HitScoreVisualizerConfig | null,
  note: ReplayNoteEvent,
  cut: CutScore | undefined,
  eventIndex: number,
): HitScoreDisplay {
  if (cut !== undefined) return config === null ? vanillaScoreDisplay(cut) : judgmentDisplay(config, cut, note);
  if (config === null) return vanillaFailureDisplay(note);
  let candidates: ColoredText[];
  if (note.eventType === 3) candidates = config.misses;
  else {
    const type = badCutType(note);
    candidates = config.badCuts.filter((badCut) => badCut.type === BAD_CUT_TYPE.all || badCut.type === type);
  }
  // HSV picks these randomly by default; a stable pick keeps scrubbing deterministic.
  const candidate = candidates[eventIndex % Math.max(candidates.length, 1)];
  return candidate === undefined ? vanillaFailureDisplay(note) : display(candidate.text, candidate.color);
}
